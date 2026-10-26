import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const STUDIO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const MODELS_DIR = path.join(STUDIO_ROOT, "models");
export const VOICES_PATH = path.join(STUDIO_ROOT, "voices.json");

export function exists(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

export function which(bin) {
  const paths = (process.env.PATH || "").split(path.delimiter);
  for (const dir of paths) {
    const full = path.join(dir, bin);
    if (exists(full)) return full;
  }
  return null;
}

export function loadVoices() {
  const pack = path.join(
    STUDIO_ROOT,
    "..",
    "packages",
    "character-packs",
    "ripple.voices.json",
  );
  const src = exists(VOICES_PATH) ? VOICES_PATH : pack;
  return JSON.parse(fs.readFileSync(src, "utf8"));
}

export function ggufPath() {
  const named = path.join(MODELS_DIR, "qwen2.5-3b-instruct-q4_k_m.gguf");
  if (exists(named)) return named;
  if (!exists(MODELS_DIR)) return null;
  const hit = fs.readdirSync(MODELS_DIR).find((f) => f.endsWith(".gguf"));
  return hit ? path.join(MODELS_DIR, hit) : null;
}

export function piperBin() {
  const local = path.join(MODELS_DIR, "piper", "piper");
  return exists(local) ? local : which("piper");
}

export function piperVoice(id) {
  const onnx = path.join(MODELS_DIR, "piper-voices", `${id}.onnx`);
  return exists(onnx) ? onnx : null;
}

export function sherpaEncoder() {
  const dir = path.join(MODELS_DIR, "sherpa-zipformer");
  const tokens = path.join(dir, "tokens.txt");
  if (!exists(tokens)) return null;
  return dir;
}

export const LLAMA_URL = process.env.LLAMA_SERVER_URL || "http://127.0.0.1:8080";
export const STUDIO_PORT = Number(process.env.STUDIO_PORT || 8787);
