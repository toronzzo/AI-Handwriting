/**
 * Screen questions for the Preyas Helper menu-bar app.
 *
 * POST /v1/vision/ask and GET /v1/vision sit under /v1, so the proxy pairing
 * gate applies: a caller needs X-Preyas-Token. This module never checks the
 * token itself.
 *
 * Route order: a free Groq vision model on the LiteLLM gateway, then Gemini
 * free on that same gateway, then a local vision GGUF plus its mmproj through
 * llama-mtmd-cli. The text Qwen model is not a vision model and is never sent
 * a picture. A picture is written to disk only for the local CLI, in a 0700
 * temp directory that is removed before we return. A cloud route is the only
 * path that sends the picture off this Mac, and the response says so.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn as defaultSpawn } from "node:child_process";
import { PREYAS_CHAT_PERSONA } from "../../packages/alive/src/persona.ts";
import { loadPersona } from "./os/persona.mjs";

export const GROQ_VISION_ALIAS = "groq-vision";
export const GEMINI_VISION_ALIAS = "gemini-flash";
export const VISION_BODY_LIMIT = 6_000_000;
export const MAX_IMAGE_BYTES = 4_000_000;
export const VISION_NOTE =
  "The partner is showing you one screenshot from their Mac. Answer that picture in your usual voice. Lead with the answer. If the picture does not show the thing they asked about, say so in plain words.";

const PREFERS = new Set(["auto", "groq", "gemini", "local", "cloud"]);
const TEXT_ONLY_RE = /qwen3|abliterated/i;
const VISION_NAME_RE = /vision|moondream|smolvlm|smol-vlm|llava|minicpm|qwen2\.?5?-?vl|gemma-?3|pixtral|internvl|nanollava/i;

function isTextOnlyName(name) {
  return TEXT_ONLY_RE.test(name) && !VISION_NAME_RE.test(name);
}
const LOG_LINE_RE = /^(llama_|ggml_|mtmd_|clip_|build\s*:|main\s*:|load_backend|print_info|system_info|warming up|gguf_init)/i;
const MIME_EXT = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

export class VisionInputError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "VisionInputError";
    this.status = status;
    this.code = code;
  }
}

function cleanText(value, max) {
  return String(value ?? "").replace(/\0/g, "").trim().slice(0, max);
}

export function stripThink(text) {
  return String(text || "").replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

/** Drop llama.cpp log lines. The answer itself is kept. */
export function cleanLocalAnswer(stdout) {
  const stripped = stripThink(stdout);
  const lines = stripped.split("\n").filter((line) => {
    const trimmed = line.trim();
    return trimmed && !LOG_LINE_RE.test(trimmed);
  });
  return lines.join("\n").trim();
}

function publicText(text) {
  return String(text || "")
    .replace(/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=\s]+/gi, "[image]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

export function isGroqVision(id) {
  const name = String(id || "").trim();
  if (!name || /embed/i.test(name)) return false;
  if (name === GROQ_VISION_ALIAS) return true;
  if (/llama-4-scout/i.test(name)) return true;
  if (/llama-3\.2-.*vision/i.test(name)) return true;
  return /^groq\/.*(?:vision|llama-4-scout)/i.test(name);
}

export function isGeminiVision(id) {
  const name = String(id || "").trim();
  if (!name || /embed/i.test(name)) return false;
  if (name === GEMINI_VISION_ALIAS) return true;
  return /gemini/i.test(name) && /flash|vision/i.test(name);
}

function preferId(ids, alias) {
  if (!ids.length) return "";
  return ids.find((id) => id === alias) || ids[0];
}

export function listVisionChoices(models) {
  const groq = [];
  const gemini = [];
  for (const id of models || []) {
    if (isGroqVision(id)) groq.push(id);
    else if (isGeminiVision(id)) gemini.push(id);
  }
  return {
    groq: preferId(groq, GROQ_VISION_ALIAS),
    gemini: preferId(gemini, GEMINI_VISION_ALIAS),
  };
}

/**
 * prefer: auto (Groq, then Gemini, then local), cloud (no local), or one route.
 * Returns { route, model, reason }. model is the gateway id; local files stay
 * on the discovery object.
 */
export function chooseVisionRoute(discovery, prefer = "auto") {
  const choices = listVisionChoices(discovery?.models || []);
  const localReady = Boolean(discovery?.local);
  if (prefer === "local") {
    return localReady
      ? { route: "local", model: null, reason: "" }
      : { route: "none", model: null, reason: "local" };
  }
  if (prefer === "groq") {
    return choices.groq
      ? { route: "groq", model: choices.groq, reason: "" }
      : { route: "none", model: null, reason: "groq" };
  }
  if (prefer === "gemini") {
    return choices.gemini
      ? { route: "gemini", model: choices.gemini, reason: "" }
      : { route: "none", model: null, reason: "gemini" };
  }
  if (choices.groq) return { route: "groq", model: choices.groq, reason: "" };
  if (choices.gemini) return { route: "gemini", model: choices.gemini, reason: "" };
  if (prefer === "auto" && localReady) return { route: "local", model: null, reason: "" };
  return { route: "none", model: null, reason: prefer === "cloud" ? "cloud" : "none" };
}

export function answerNotice(route, { fellBack = false } = {}) {
  if (fellBack && route === "local") {
    return "The gateway was not reachable, so this picture stayed on this Mac. A local vision model answered.";
  }
  if (route === "groq") {
    return "This picture was sent to Groq (free cloud) through the gateway. It left this Mac.";
  }
  if (route === "gemini") {
    return "This picture was sent to Gemini (free) through the gateway. It left this Mac.";
  }
  if (route === "local") {
    return "This picture stayed on this Mac. A local vision model answered.";
  }
  return "";
}

export function previewNotice(route) {
  if (route === "groq") {
    return "The next answer will use Groq (free cloud) through the gateway. The picture will leave this Mac.";
  }
  if (route === "gemini") {
    return "The next answer will use Gemini (free) through the gateway. The picture will leave this Mac.";
  }
  if (route === "local") {
    return "The next answer will use a local vision model. The picture will stay on this Mac.";
  }
  return "";
}

export function noneMessage(discovery = {}, reason = "none") {
  const stayed = "This picture stayed on this Mac.";
  if (reason === "groq") return `Groq vision is not on the gateway (port 4000). ${stayed}`;
  if (reason === "gemini") return `Gemini is not on the gateway (port 4000). ${stayed}`;
  if (reason === "cloud") return `No Groq or Gemini vision model is on the gateway (port 4000). ${stayed}`;
  if (reason === "local" && discovery.localFiles && !discovery.localBinFound) {
    return `A vision GGUF and mmproj are on this Mac, but llama-mtmd-cli was not found. ${stayed}`;
  }
  if (reason === "local") return `No local vision model is ready. ${stayed}`;
  if (discovery.localFiles && !discovery.localBinFound) {
    return `A vision GGUF and mmproj are on this Mac, but llama-mtmd-cli was not found next to llama-server. Add that binary, or add Groq or Gemini on the LiteLLM gateway (port 4000). The text model cannot see pictures. ${stayed}`;
  }
  return `No vision model is configured. Add a free Groq vision model or Gemini free on the LiteLLM gateway (port 4000), or place a small vision GGUF and its mmproj in the models/vision folder and install llama-mtmd-cli. The text model on this Mac cannot see pictures. ${stayed}`;
}

function sniffMime(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (bytes.length >= 6) {
    const head = bytes.toString("ascii", 0, 6);
    if (head === "GIF87a" || head === "GIF89a") return "image/gif";
  }
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") {
    return "image/webp";
  }
  return "";
}

/** Accept a base64 string or a data URL. The mime is taken from the bytes. */
export function decodeImage(image, mime) {
  void mime;
  const raw = String(image ?? "").trim();
  if (!raw) throw new VisionInputError(400, "bad_image", "Attach a picture first.");
  let b64 = raw;
  const dataUrl = /^data:image\/[a-z0-9.+-]+;base64,([a-z0-9+/=\s]+)$/i.exec(raw);
  if (dataUrl) b64 = dataUrl[1];
  b64 = b64.replace(/\s/g, "");
  if (!b64 || !/^[a-z0-9+/=]+$/i.test(b64)) {
    throw new VisionInputError(400, "bad_image", "The picture was not a PNG, JPEG, WEBP, or GIF.");
  }
  if (b64.length > Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 8) {
    throw new VisionInputError(400, "bad_image", "That picture is too large. Send a smaller JPEG.");
  }
  const bytes = Buffer.from(b64, "base64");
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) {
    throw new VisionInputError(400, "bad_image", "That picture is too large. Send a smaller JPEG.");
  }
  const sniffed = sniffMime(bytes);
  if (!sniffed) throw new VisionInputError(400, "bad_image", "The picture was not a PNG, JPEG, WEBP, or GIF.");
  return { bytes, mime: sniffed, ext: MIME_EXT[sniffed] };
}

function cleanQuestion(value) {
  const text = cleanText(value, 2000);
  if (!text) throw new VisionInputError(400, "bad_question", "Type a question about the picture.");
  return text;
}

function cleanHistory(value) {
  if (!Array.isArray(value)) return [];
  const turns = [];
  for (const row of value) {
    if (!row || (row.role !== "user" && row.role !== "assistant")) continue;
    if (typeof row.content !== "string") continue;
    const content = cleanText(row.content, 1500);
    if (!content) continue;
    turns.push({ role: row.role, content });
  }
  return turns.slice(-8);
}

export function buildCloudMessages({ persona, question, history, dataUrl }) {
  const messages = [{ role: "system", content: `${persona}\n\n${VISION_NOTE}` }];
  for (const turn of history) messages.push({ role: turn.role, content: turn.content });
  messages.push({
    role: "user",
    content: [
      { type: "text", text: question },
      { type: "image_url", image_url: { url: dataUrl } },
    ],
  });
  return messages;
}

export function buildLocalPrompt({ persona, question, history }) {
  const lines = [persona, "", VISION_NOTE, ""];
  for (const turn of history) {
    lines.push(turn.role === "assistant" ? `Preyas: ${turn.content}` : `Partner: ${turn.content}`);
  }
  lines.push(`Partner: ${question}`);
  lines.push("Preyas:");
  return lines.join("\n");
}

function answerText(json) {
  const content = json?.choices?.[0]?.message?.content;
  if (typeof content === "string") return stripThink(content);
  if (Array.isArray(content)) {
    return stripThink(content.map((part) => (typeof part?.text === "string" ? part.text : "")).join(""));
  }
  return "";
}

function netKind(error) {
  if (!error) return "failed";
  const code = error.code || "";
  const name = error.name || "";
  if (name === "TimeoutError" || name === "AbortError" || code === "ABORT_ERR") return "timeout";
  if (code === "ECONNREFUSED" || code === "ENOTFOUND" || code === "EHOSTUNREACH" || code === "ECONNRESET") {
    return "unreachable";
  }
  if (error.cause) return netKind(error.cause);
  return "failed";
}

function cloudFailureMessage(route, error) {
  const who = route === "groq" ? "Groq" : route === "gemini" ? "Gemini" : "The vision model";
  if (error.kind === "timeout") return `${who} timed out. This picture may have left this Mac.`;
  if (error.kind === "unreachable") return "The gateway on port 4000 was not reachable. This picture stayed on this Mac.";
  if (error.kind === "http") return `${who} did not answer (${error.status}). This picture was sent, so it left this Mac.`;
  return `${who} did not answer. This picture was sent, so it left this Mac.`;
}

function personaText(runtime) {
  try {
    const text = String(runtime.personaText?.() ?? "").trim();
    if (text) return text;
  } catch {
    /* the repo default still has Preyas's voice */
  }
  return PREYAS_CHAT_PERSONA;
}

function modelLabel(choice, discovery) {
  if (choice.route === "local") return `local:${path.basename(discovery.local.model)}`;
  return choice.model;
}

function okBody({ answer, route, model, leavesMac, fellBack = false }) {
  const notice = answerNotice(route, { fellBack });
  return {
    answer,
    route,
    model,
    leavesMac,
    notice,
    fellBack,
  };
}

async function runCloud({ gatewayUrl, model, messages, fetchImpl, timeoutMs }) {
  const url = `${String(gatewayUrl).replace(/\/$/, "")}/v1/chat/completions`;
  let res;
  try {
    res = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.4,
        max_tokens: 500,
        cache: { "no-cache": true, "no-store": true },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const kind = netKind(error);
    throw Object.assign(new Error(kind === "unreachable" ? "gateway unreachable" : "gateway failed"), { kind });
  }
  if (!res.ok) throw Object.assign(new Error("gateway http"), { kind: "http", status: res.status });
  let json;
  try {
    json = await res.json();
  } catch {
    throw Object.assign(new Error("gateway bad json"), { kind: "http", status: res.status });
  }
  const text = answerText(json);
  if (!text) throw Object.assign(new Error("empty answer"), { kind: "empty" });
  return text;
}

function runLocalProcess({ spawnImpl, bin, args, timeoutMs }) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnImpl(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      reject(Object.assign(error instanceof Error ? error : new Error(String(error)), { kind: "local" }));
      return;
    }
    if (!child || typeof child.on !== "function") {
      reject(Object.assign(new Error("vision runner failed"), { kind: "local" }));
      return;
    }
    const out = [];
    const err = [];
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        child.kill("SIGKILL");
      } catch {
        /* already gone */
      }
      reject(Object.assign(new Error("local vision model timed out"), { kind: "timeout" }));
    }, timeoutMs);
    child.stdout?.on("data", (chunk) => out.push(Buffer.from(chunk)));
    child.stderr?.on("data", (chunk) => err.push(Buffer.from(chunk)));
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(Object.assign(error instanceof Error ? error : new Error(String(error)), { kind: "local" }));
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout: Buffer.concat(out).toString("utf8"), stderr: Buffer.concat(err).toString("utf8") });
        return;
      }
      const detail = publicText(Buffer.concat(err).toString("utf8") || Buffer.concat(out).toString("utf8"));
      reject(Object.assign(new Error(detail || `llama-mtmd-cli exited ${code}`), { kind: "local" }));
    });
  });
}

async function withImageFile(bytes, ext, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "preyas-vision-"));
  try {
    fs.chmodSync(dir, 0o700);
  } catch {
    /* the directory is already private on a normal macOS temp */
  }
  const imagePath = path.join(dir, `shot.${ext}`);
  fs.writeFileSync(imagePath, bytes, { mode: 0o600 });
  try {
    return await fn(imagePath);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function runLocal({ discovery, persona, question, history, spawnImpl, timeoutMs }) {
  const prompt = buildLocalPrompt({ persona, question, history });
  const args = [
    "-m",
    discovery.local.model,
    "--mmproj",
    discovery.local.mmproj,
    "--image",
    "",
    "-p",
    prompt,
    "-n",
    "420",
    "--temp",
    "0.3",
    "-c",
    "2048",
    "-ngl",
    "99",
  ];
  return withImageFile(discovery.image.bytes, discovery.image.ext, async (imagePath) => {
    args[args.indexOf("--image") + 1] = imagePath;
    const result = await runLocalProcess({
      spawnImpl,
      bin: discovery.local.bin,
      args,
      timeoutMs,
    });
    const text = cleanLocalAnswer(result.stdout);
    if (!text) throw Object.assign(new Error("local vision model returned an empty answer"), { kind: "local" });
    return text;
  });
}

function localFailure(error) {
  const detail = publicText(error?.message || "");
  const message = detail
    ? `The local vision model did not answer (${detail}). This picture stayed on this Mac.`
    : "The local vision model did not answer. This picture stayed on this Mac.";
  return {
    status: 502,
    body: {
      error: "vision_failed",
      message,
      notice: "This picture stayed on this Mac.",
      leavesMac: false,
      route: "local",
    },
  };
}

export async function askVision(input, runtime) {
  const image = decodeImage(input?.image, input?.mime);
  const question = cleanQuestion(input?.question);
  const history = cleanHistory(input?.history);
  const prefer = String(input?.prefer || "auto");
  if (!PREFERS.has(prefer)) {
    throw new VisionInputError(400, "bad_prefer", "prefer must be auto, groq, gemini, local, or cloud.");
  }
  const discovery = runtime.discovery || (await runtime.discover());
  const choice = chooseVisionRoute(discovery, prefer);
  if (choice.route === "none") {
    const message = noneMessage(discovery, choice.reason);
    return {
      status: 503,
      body: {
        error: "no_vision_model",
        message,
        notice: message,
        leavesMac: false,
        route: "none",
        localReady: Boolean(discovery.local),
      },
    };
  }

  const persona = personaText(runtime);
  const timeoutMs = runtime.timeoutMs || 120_000;
  const spawnImpl = runtime.spawnImpl || defaultSpawn;
  if (choice.route === "local") {
    try {
      const answer = await runLocal({
        discovery: { ...discovery, image },
        persona,
        question,
        history,
        spawnImpl,
        timeoutMs,
      });
      return {
        status: 200,
        body: okBody({
          answer,
          route: "local",
          model: modelLabel(choice, discovery),
          leavesMac: false,
        }),
      };
    } catch (error) {
      return localFailure(error);
    }
  }

  const dataUrl = `data:${image.mime};base64,${image.bytes.toString("base64")}`;
  const messages = buildCloudMessages({ persona, question, history, dataUrl });
  try {
    const answer = await runCloud({
      gatewayUrl: runtime.gatewayUrl || "http://127.0.0.1:4000",
      model: choice.model,
      messages,
      fetchImpl: runtime.fetchImpl,
      timeoutMs,
    });
    return {
      status: 200,
      body: okBody({
        answer,
        route: choice.route,
        model: choice.model,
        leavesMac: true,
      }),
    };
  } catch (error) {
    if (error.kind === "unreachable" && prefer === "auto" && discovery.local) {
      try {
        const answer = await runLocal({
          discovery: { ...discovery, image },
          persona,
          question,
          history,
          spawnImpl,
          timeoutMs,
        });
        return {
          status: 200,
          body: okBody({
            answer,
            route: "local",
            model: modelLabel({ route: "local" }, discovery),
            leavesMac: false,
            fellBack: true,
          }),
        };
      } catch (localError) {
        return localFailure(localError);
      }
    }
    const leavesMac = error.kind !== "unreachable";
    const message = cloudFailureMessage(choice.route, error);
    return {
      status: 502,
      body: {
        error: "vision_failed",
        message,
        notice: leavesMac
          ? message
          : "This picture stayed on this Mac.",
        leavesMac,
        route: choice.route,
      },
    };
  }
}

/**
 * The HTTP body of GET /v1/vision and POST /v1/vision/ask, without the server.
 * rawBody is only read for the POST. A null return means this path is not ours.
 */
export async function handleVisionHttp({ method, pathname, rawBody, runtime }) {
  if (method === "GET" && pathname === "/v1/vision") return visionStatus(runtime);
  if (method === "POST" && pathname === "/v1/vision/ask") {
    let body;
    try {
      const text = Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : String(rawBody ?? "");
      body = JSON.parse(text || "{}");
    } catch {
      return { status: 400, body: { error: "bad_json", message: "bad json", leavesMac: false } };
    }
    try {
      return await askVision(body, runtime);
    } catch (err) {
      if (err && err.name === "VisionInputError") {
        return {
          status: err.status,
          body: {
            error: err.code,
            message: err.message,
            leavesMac: false,
            notice: "This picture stayed on this Mac.",
          },
        };
      }
      throw err;
    }
  }
  return null;
}

export async function visionStatus(runtime) {
  const discovery = runtime.discovery || (await runtime.discover());
  const choice = chooseVisionRoute(discovery, "auto");
  const choices = listVisionChoices(discovery.models || []);
  const notice = choice.route === "none" ? noneMessage(discovery, choice.reason) : previewNotice(choice.route);
  return {
    status: 200,
    body: {
      ok: choice.route !== "none",
      route: choice.route,
      model: choice.route === "none" ? null : modelLabel(choice, discovery),
      leavesMac: choice.route === "groq" || choice.route === "gemini",
      localReady: Boolean(discovery.local),
      groqReady: Boolean(choices.groq),
      geminiReady: Boolean(choices.gemini),
      notice,
      message: notice,
    },
  };
}

export function defaultModelDirs(env = process.env) {
  const dirs = [];
  const add = (dir) => {
    const text = String(dir || "").trim();
    if (text && !dirs.includes(text)) dirs.push(text);
  };
  add(env.PREYAS_VISION_DIR);
  add(env.PREYAS_MODELS_DIR);
  if (env.PREYAS_MODELS_DIR) add(path.join(env.PREYAS_MODELS_DIR, "vision"));
  if (env.BAKUGAN_DATA_DIR) {
    add(path.join(env.BAKUGAN_DATA_DIR, "models", "vision"));
    add(path.join(env.BAKUGAN_DATA_DIR, "models"));
  }
  add("/Volumes/Agent/BakuganBuddy/models/vision");
  add("/Volumes/Agent/BakuganBuddy/models");
  return dirs;
}

export function resolveVisionBin(env, pathExists) {
  const named = String(env.PREYAS_VISION_BIN || "").trim();
  if (named && pathExists(named)) return named;
  const llama = String(env.LLAMA_BIN || "").trim();
  if (llama) {
    const sibling = path.join(path.dirname(llama), "llama-mtmd-cli");
    if (pathExists(sibling)) return sibling;
  }
  const home = path.join(os.homedir(), ".local", "bin", "llama-mtmd-cli");
  if (pathExists(home)) return home;
  for (const dir of String(env.PATH || "").split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, "llama-mtmd-cli");
    if (pathExists(candidate)) return candidate;
  }
  return "";
}

function isMmproj(name) {
  return /mmproj/i.test(name);
}

function rankName(name) {
  const n = name.toLowerCase();
  if (n.includes("moondream")) return 0;
  if (n.includes("smolvlm") || n.includes("smol-vlm") || n.includes("256m") || n.includes("500m")) return 1;
  if (n.includes("1.8") || n.includes("2b")) return 2;
  return 4;
}

function tokenScore(model, proj) {
  const stop = new Set(["mmproj", "model", "gguf", "q4", "q5", "q6", "q8", "k", "m", "f16", "f32"]);
  const tokens = (name) =>
    name
      .toLowerCase()
      .replace(/\.gguf$/i, "")
      .split(/[^a-z0-9.]+/)
      .filter((part) => part && !stop.has(part));
  const modelTokens = new Set(tokens(model));
  return tokens(proj).filter((part) => modelTokens.has(part)).length;
}

function bestPair(names, folderIsVision) {
  const gguf = (names || []).filter((name) => String(name).toLowerCase().endsWith(".gguf"));
  const projs = gguf.filter(isMmproj);
  const models = gguf.filter((name) => !isMmproj(name) && !isTextOnlyName(name) && (folderIsVision || VISION_NAME_RE.test(name)));
  if (!projs.length || !models.length) return null;
  let best = null;
  for (const model of models) {
    for (const proj of projs) {
      const score = tokenScore(model, proj) * 10 - rankName(model);
      if (!best || score > best.score) best = { model, mmproj: proj, score };
    }
  }
  return best;
}

export function findLocalVision({ dirs = [], env = {}, pathExists = fs.existsSync, listDir = (dir) => fs.readdirSync(dir) } = {}) {
  const bin = resolveVisionBin(env, pathExists);
  const explicitModel = String(env.PREYAS_VISION_GGUF || "").trim();
  const explicitProj = String(env.PREYAS_VISION_MMPROJ || "").trim();
  let pair = null;
  const explicitOk =
    explicitModel &&
    explicitProj &&
    pathExists(explicitModel) &&
    pathExists(explicitProj) &&
    !isTextOnlyName(path.basename(explicitModel));
  if (explicitOk) {
    pair = { model: explicitModel, mmproj: explicitProj };
  } else {
    let best = null;
    for (const dir of dirs) {
      if (!dir || !pathExists(dir)) continue;
      let names = [];
      try {
        names = listDir(dir);
      } catch {
        continue;
      }
      const found = bestPair(names, path.basename(dir).toLowerCase() === "vision");
      if (!found) continue;
      if (!best || found.score > best.score) {
        best = {
          score: found.score,
          model: path.join(dir, found.model),
          mmproj: path.join(dir, found.mmproj),
        };
      }
    }
    if (best) pair = { model: best.model, mmproj: best.mmproj };
  }
  return {
    local: pair && bin ? { ...pair, bin } : null,
    localFiles: Boolean(pair),
    localBinFound: Boolean(bin),
  };
}

export async function gatewayModelIds(gatewayUrl, fetchImpl, timeoutMs = 2000) {
  const url = `${String(gatewayUrl || "").replace(/\/$/, "")}/v1/models`;
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res?.ok) return [];
    const json = await res.json();
    const rows = Array.isArray(json?.data) ? json.data : [];
    return rows.map((row) => String(row?.id || "")).filter(Boolean);
  } catch {
    return [];
  }
}

export function defaultVisionRuntime({ dataDir = "", env = process.env, fetchImpl = globalThis.fetch, spawnImpl = defaultSpawn } = {}) {
  const gatewayUrl = String(env.PAID_GATEWAY_URL || env.PREYAS_GATEWAY_URL || "http://127.0.0.1:4000").replace(/\/$/, "");
  return {
    fetchImpl,
    spawnImpl,
    gatewayUrl,
    timeoutMs: 120_000,
    personaText() {
      return loadPersona(dataDir, { defaultText: PREYAS_CHAT_PERSONA }).text;
    },
    discover() {
      return discoverVision({ gatewayUrl, fetchImpl, env });
    },
  };
}

export async function discoverVision({ gatewayUrl, fetchImpl, env = process.env, pathExists, listDir, timeoutMs = 2000 } = {}) {
  const models = await gatewayModelIds(gatewayUrl, fetchImpl, timeoutMs);
  const found = findLocalVision({
    dirs: defaultModelDirs(env),
    env,
    pathExists,
    listDir,
  });
  return { models, ...found };
}
