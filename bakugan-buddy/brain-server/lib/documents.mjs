/**
 * Read the user's documents from the inbox and turn them into plain text.
 *
 * The inbox is read-only: files are never written, moved or deleted. Text is
 * extracted with the tools macOS already has (textutil, then pdftotext when it
 * exists, then a small in-process PDF reader) and cached by path + mtime so a
 * long file is parsed once.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { execFile } from "node:child_process";

export const INBOX_PATH = "/Volumes/Agent/BakuganBuddy/documents";
export const CACHE_ROOT = "/Volumes/Agent/BakuganBuddy/cache/docs";
export const MAX_TEXT_BYTES = 200 * 1024;
export const CHUNK_CHARS = 12_000;
export const EXEC_TIMEOUT_MS = 20_000;
export const TEXT_TYPES = [".txt", ".md", ".markdown", ".pdf", ".docx", ".doc", ".rtf"];

const NAME_RE = /^[^/\0]+$/;

/** A name from the client is only ever a file name inside the inbox. */
export function safeDocumentName(raw) {
  const name = String(raw ?? "").trim();
  if (!name) throw new Error("empty document name");
  if (name.includes("\0")) throw new Error("bad document name");
  if (name.includes("/") || name.includes("\\")) throw new Error("document name must not contain a path");
  if (name === "." || name === ".." || name.includes("..")) throw new Error("document name must not contain ..");
  if (!NAME_RE.test(name)) throw new Error("bad document name");
  const resolved = path.resolve(INBOX_PATH, name);
  if (path.dirname(resolved) !== path.resolve(INBOX_PATH)) throw new Error("document is outside the inbox");
  return name;
}

export function documentPath(name) {
  return path.join(INBOX_PATH, safeDocumentName(name));
}

export function documentKind(name) {
  const ext = path.extname(String(name ?? "")).toLowerCase();
  if (ext === ".pdf") return "pdf";
  if (ext === ".docx" || ext === ".doc" || ext === ".rtf") return "word";
  if (ext === ".md" || ext === ".markdown") return "markdown";
  return ext === ".txt" ? "text" : "other";
}

export function listDocuments(inbox = INBOX_PATH) {
  let names;
  try {
    names = fs.readdirSync(inbox);
  } catch {
    return [];
  }
  const files = [];
  for (const name of names) {
    if (name.startsWith(".")) continue;
    const ext = path.extname(name).toLowerCase();
    if (!TEXT_TYPES.includes(ext)) continue;
    try {
      const stat = fs.statSync(path.join(inbox, name));
      if (!stat.isFile()) continue;
      files.push({
        name,
        size: stat.size,
        type: ext.replace(".", ""),
        modified: Math.round(stat.mtimeMs),
      });
    } catch {
      /* a file that vanished between readdir and stat */
    }
  }
  return files.sort((left, right) => right.modified - left.modified);
}

function runTool(command, args, timeoutMs = EXEC_TIMEOUT_MS) {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: timeoutMs, maxBuffer: MAX_TEXT_BYTES * 4 }, (error, stdout) => {
      resolve({ ok: !error, text: typeof stdout === "string" ? stdout : "" });
    });
  });
}

/** Decode the literal and hex strings a PDF content stream uses for text. */
function decodePdfString(literal) {
  return String(literal)
    .replace(/\\([nrtbf()\\])/g, (_, ch) => ({ n: "\n", r: "", t: "\t", b: "", f: "" })[ch] ?? ch)
    .replace(/\\([0-7]{1,3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)))
    .replace(/\s+/g, " ");
}

/**
 * A small PDF text reader: inflate the streams we can, then collect the text
 * show operators. It is deliberately simple and never throws.
 */
export function pdfTextFromBuffer(buffer) {
  const latin = Buffer.from(buffer).toString("latin1");
  const pieces = [];
  const streamRe = /stream\r?\n?([\s\S]*?)endstream/g;
  for (const match of latin.matchAll(streamRe)) {
    let body = match[1] || "";
    const raw = Buffer.from(body, "latin1");
    let text = "";
    if (raw.length && raw[0] === 0x78) {
      try {
        text = zlib.inflateSync(raw).toString("latin1");
      } catch {
        try {
          text = zlib.inflateRawSync(raw).toString("latin1");
        } catch {
          text = body;
        }
      }
    } else {
      text = body;
    }
    for (const show of text.matchAll(/\(((?:\\.|[^\\()])*)\)\s*Tj/g)) {
      pieces.push(decodePdfString(show[1] || ""));
    }
    for (const arrayShow of text.matchAll(/\[((?:[^\]\\]|\\.)*)\]\s*TJ/g)) {
      const inner = arrayShow[1] || "";
      const parts = [...inner.matchAll(/\(((?:\\.|[^\\()])*)\)/g)].map((row) => decodePdfString(row[1] || ""));
      if (parts.length) pieces.push(parts.join(""));
    }
  }
  return pieces.join(" ").replace(/\s+/g, " ").trim();
}

async function pdfToText(filePath, buffer) {
  const viaPdfToText = await runTool("pdftotext", ["-layout", "-enc", "UTF-8", filePath, "-"]);
  if (viaPdfToText.ok && viaPdfToText.text.trim()) return viaPdfToText.text;
  // textutil does not convert PDFs: it echoes the raw bytes, so it is skipped here.
  const viaMdls = await runTool("mdls", ["-raw", "-name", "kMDItemTextContent", filePath]);
  const mdlsText = viaMdls.text.trim();
  if (viaMdls.ok && mdlsText && mdlsText !== "(null)") return mdlsText;
  return pdfTextFromBuffer(buffer);
}

/** Guard against a converter that echoes the file instead of reading it. */
function looksLikeSource(text) {
  const head = String(text ?? "").trimStart().slice(0, 8);
  return head.startsWith("%PDF-") || head.startsWith("PK\u0003\u0004");
}

/** Extract plain text for one inbox file. Never writes to the inbox. */
export async function extractDocumentText(name, options = {}) {
  const { inbox = INBOX_PATH } = options;
  const file = path.join(inbox, safeDocumentName(name));
  const stat = fs.statSync(file);
  if (stat.size > MAX_TEXT_BYTES * 20) throw new Error("document is too large to read");
  const kind = documentKind(name);

  let text = "";
  if (kind === "text" || kind === "markdown") {
    text = fs.readFileSync(file, "utf8");
  } else if (kind === "pdf") {
    text = await pdfToText(file, fs.readFileSync(file));
  } else if (kind === "word") {
    const converted = await runTool("textutil", ["-convert", "txt", "-stdout", file]);
    if (!converted.ok || !converted.text.trim() || looksLikeSource(converted.text)) {
      throw new Error("could not read this document with textutil");
    }
    text = converted.text;
  } else {
    throw new Error(`unsupported document type: ${path.extname(name) || name}`);
  }

  if (looksLikeSource(text)) throw new Error("the document could not be converted to text");
  const clean = String(text).replace(/\u0000/g, "").replace(/[ \t]+\n/g, "\n").trim();
  if (!clean) throw new Error("no readable text in this document");
  return clean.length > MAX_TEXT_BYTES ? `${clean.slice(0, MAX_TEXT_BYTES)}…` : clean;
}

export function cachePath(name, mtime) {
  const base = path.basename(name, path.extname(name)).replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 80);
  return path.join(CACHE_ROOT, `${base}-${Math.round(mtime)}.json`);
}

/** Cached extraction keyed by path + mtime; a rewritten file misses the cache. */
export async function readDocumentText(name, options = {}) {
  const { inbox = INBOX_PATH, cacheRoot = CACHE_ROOT, useCache = true, extract = extractDocumentText } = options;
  const file = path.join(inbox, safeDocumentName(name));
  const stat = fs.statSync(file);
  const mtime = Math.round(stat.mtimeMs);
  const cacheFile = cachePath(name, mtime);
  if (useCache) {
    try {
      const cached = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
      if (cached && cached.name === name && cached.mtime === mtime && typeof cached.text === "string") {
        return { text: cached.text, cached: true, mtime, size: stat.size };
      }
    } catch {
      /* a miss is fine */
    }
  }
  const text = await extract(name, { inbox });
  if (useCache) {
    try {
      fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
      fs.writeFileSync(cacheFile, JSON.stringify({ name, mtime, size: stat.size, text }));
    } catch {
      /* caching is an optimisation */
    }
  }
  return { text, cached: false, mtime, size: stat.size };
}

/** Split text into context-sized chunks, preferring paragraph breaks. */
export function chunkText(text, size = CHUNK_CHARS) {
  const clean = String(text ?? "").trim();
  if (!clean) return [];
  if (clean.length <= size) return [clean];
  const chunks = [];
  let rest = clean;
  while (rest.length > size) {
    let cut = rest.lastIndexOf("\n\n", size);
    if (cut < size * 0.5) cut = rest.lastIndexOf("\n", size);
    if (cut < size * 0.5) cut = rest.lastIndexOf(" ", size);
    if (cut < size * 0.5) cut = size;
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

/** Score = how many query words a chunk shares, so a question can skip the rest. */
export function pickRelevantChunks(chunks, query, limit = 3) {
  const words = String(query ?? "")
    .toLowerCase()
    .split(/[^a-z0-9\u0400-\u04ff]+/)
    .filter((word) => word.length > 2);
  if (!words.length) return chunks.slice(0, limit);
  const scored = chunks.map((chunk, index) => {
    const lower = chunk.toLowerCase();
    const score = words.reduce((total, word) => total + (lower.includes(word) ? 1 : 0), 0);
    return { chunk, index, score };
  });
  scored.sort((left, right) => right.score - left.score || left.index - right.index);
  return scored.slice(0, limit).map((row) => row.chunk);
}
