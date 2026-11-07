/**
 * The vault on disk: export Preyas's data as Markdown, import the user's edits.
 *
 * Rules kept here:
 *  - writes are atomic (temp file, then rename) and only happen when the text
 *    actually changed;
 *  - a file Preyas generated is skipped on import unless the user edited it;
 *  - a file the user is still typing in is left alone until it settles;
 *  - nothing outside the vault is ever written or deleted.
 */
import fs from "node:fs";
import path from "node:path";
import { buildVault, contentHash, hashMatches, parseMarkdown, withHash } from "../../packages/alive/src/vault.ts";

export const VAULT_DIR = "/Volumes/Agent/BakuganBuddy/vault";
export const SETTLE_MS = 5000;

export function vaultPath(root = VAULT_DIR) {
  return root;
}

function writeAtomic(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, content);
  fs.renameSync(temp, file);
}

/** Write every file, skipping ones whose text is unchanged. */
export function exportVault(input, options = {}) {
  const { root = VAULT_DIR } = options;
  const files = buildVault(input).map(withHash);
  let written = 0;
  let skipped = 0;
  for (const file of files) {
    const target = path.join(root, file.path);
    try {
      if (fs.existsSync(target) && fs.readFileSync(target, "utf8") === file.content) {
        skipped += 1;
        continue;
      }
      writeAtomic(target, file.content);
      written += 1;
    } catch {
      /* one unwritable file must not stop the rest */
    }
  }
  return { written, skipped, total: files.length };
}

/** Every .md in the vault, relative to its root. */
export function listMarkdown(root = VAULT_DIR) {
  const found = [];
  const walk = (dir, prefix = "") => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, rel);
      else if (entry.name.endsWith(".md")) found.push(rel);
    }
  };
  walk(root);
  return found.sort();
}

/**
 * Files the user wrote or edited since Preyas last saw them.
 * `known` maps relative path -> hash Preyas last wrote.
 */
export function collectUserNotes(options = {}) {
  const { root = VAULT_DIR, known = {}, settleMs = SETTLE_MS, now = Date.now() } = options;
  const notes = [];
  for (const rel of listMarkdown(root)) {
    const full = path.join(root, rel);
    let stat;
    let raw;
    try {
      stat = fs.statSync(full);
      raw = fs.readFileSync(full, "utf8");
    } catch {
      continue;
    }
    // Still being edited: wait for it to settle.
    if (now - stat.mtimeMs < settleMs) continue;

    const parsed = parseMarkdown(raw, path.basename(rel, ".md"));
    // Untouched output: the body still hashes to what Preyas stamped.
    if (parsed.hash && hashMatches(parsed, raw)) continue;
    // Declares itself ours but carries no hash: treat as generated too.
    if (parsed.generated && !parsed.hash) continue;
    // Already imported at this exact content: do not import it again.
    const fingerprint = contentHash(`${rel}\n${raw}`);
    if (known[rel] && known[rel] === fingerprint) continue;
    notes.push({
      path: rel,
      title: parsed.title,
      text: parsed.body,
      tasks: parsed.tasks,
      tags: parsed.tags,
      fingerprint,
    });
  }
  return notes;
}

/** Minimal Obsidian config, only when the folder has none. */
export function ensureObsidianConfig(root = VAULT_DIR) {
  const dir = path.join(root, ".obsidian");
  const appFile = path.join(dir, "app.json");
  if (fs.existsSync(appFile)) return { created: false };
  try {
    fs.mkdirSync(dir, { recursive: true });
    writeAtomic(appFile, `${JSON.stringify({ alwaysUpdateLinks: true, newLinkFormat: "shortest" }, null, 2)}\n`);
    const appearance = path.join(dir, "appearance.json");
    if (!fs.existsSync(appearance)) writeAtomic(appearance, `${JSON.stringify({ theme: "obsidian" }, null, 2)}\n`);
    return { created: true };
  } catch {
    return { created: false };
  }
}

/** A gentle search over the vault for the chat commands. */
export function searchVault(query, options = {}) {
  const { root = VAULT_DIR, limit = 5 } = options;
  const words = String(query ?? "")
    .toLowerCase()
    .split(/[^a-z0-9\u0400-\u04ff]+/)
    .filter((word) => word.length > 2);
  if (!words.length) return [];
  const hits = [];
  for (const rel of listMarkdown(root)) {
    let raw;
    try {
      raw = fs.readFileSync(path.join(root, rel), "utf8");
    } catch {
      continue;
    }
    const parsed = parseMarkdown(raw, path.basename(rel, ".md"));
    const haystack = `${parsed.title}\n${parsed.body}`.toLowerCase();
    let score = 0;
    for (const word of words) {
      if (haystack.includes(word)) score += 1;
      if (parsed.title.toLowerCase().includes(word)) score += 2;
    }
    if (score > 0) hits.push({ path: rel, title: parsed.title, score, excerpt: parsed.body.slice(0, 200) });
  }
  return hits.sort((left, right) => right.score - left.score).slice(0, limit);
}

/** Save a chat line as a new note file, never overwriting the user's text. */
export function saveToVault(title, text, options = {}) {
  const { root = VAULT_DIR, now = Date.now() } = options;
  const safe = String(title || "Chat note")
    .replace(/[\\/:*?"<>|#^[\]]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "Chat note";
  const dir = path.join(root, "Notes");
  let target = path.join(dir, `${safe}.md`);
  let counter = 2;
  while (fs.existsSync(target)) {
    target = path.join(dir, `${safe} ${counter}.md`);
    counter += 1;
  }
  const body = [
    "---",
    "type: note",
    `created: ${new Date(now).toISOString().slice(0, 10)}`,
    "tags: [chat]",
    "---",
    "",
    `# ${safe}`,
    "",
    String(text || "").trim(),
    "",
  ].join("\n");
  writeAtomic(target, body);
  return { path: path.relative(root, target) };
}
