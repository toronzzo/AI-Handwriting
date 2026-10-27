/**
 * TTS — ONE warm Piper worker process; synthesize sentence-by-sentence.
 * Falls back to one-shot piper binary / espeak if the worker is unavailable.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  loadVoices,
  piperBin,
  piperPython,
  piperVoice,
  STUDIO_ROOT,
  which,
} from "./paths.mjs";

const voices = loadVoices();
const WORKER_PY = path.join(STUDIO_ROOT, "lib", "tts_worker.py");

let worker = null;
let workerReady = false;
let nextId = 1;
const pending = new Map();

export function ttsStatus() {
  const piper = Boolean(piperBin());
  const py = piperPython();
  const venvPy = path.join(STUDIO_ROOT, "models", "venv", "bin", "python");
  const pipVoice = fs.existsSync(venvPy);
  const espeak = which("espeak-ng") || which("espeak");
  const kokoro = Boolean(process.env.KOKORO_CMD);
  const warm = Boolean(worker && workerReady);
  const ready = Boolean(piper || (pipVoice && py) || espeak || kokoro);
  return {
    piper,
    piperPip: pipVoice,
    piperPython: Boolean(py),
    warmWorker: warm,
    espeak: Boolean(espeak),
    kokoro,
    ready,
    engine: warm
      ? "piper-warm"
      : piper
        ? "piper"
        : pipVoice
          ? "piper-pip"
          : kokoro
            ? "kokoro"
            : espeak
              ? "espeak"
              : null,
  };
}

const MOOD_ALIASES = {
  fierce: "angry",
  calm: "neutral",
  idle: "neutral",
  mysterious: "neutral",
  curious: "thinking",
  determined: "battle",
  amused: "happy",
  mad: "angry",
  rage: "angry",
};

export function normalizeMoodKey(mood) {
  const x = String(mood || "neutral").toLowerCase().trim();
  return MOOD_ALIASES[x] || x;
}

export function voiceForMood(mood) {
  const key = normalizeMoodKey(mood);
  const map = voices.moods || voices;
  return map[key] || map.neutral || map.happy;
}

export function cleanSpeakable(text) {
  return String(text || "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<think>[\s\S]*$/i, "")
    .replace(/\[([a-z]+)\]/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Split into speakable sentences (body never waits — caller streams each). */
export function splitSentences(text) {
  const cleaned = cleanSpeakable(text);
  if (!cleaned) return [];
  const parts = cleaned.match(/[^.!?]+[.!?]+|[^.!?]+$/g);
  return (parts ?? [cleaned]).map((s) => s.trim()).filter(Boolean);
}

function ensureWorker() {
  if (worker && workerReady) return worker;
  const py = piperPython();
  if (!py || !fs.existsSync(WORKER_PY)) return null;

  worker = spawn(py, [WORKER_PY], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, PYTHONUNBUFFERED: "1" },
  });
  workerReady = true;
  let buf = "";
  worker.stdout.on("data", (chunk) => {
    buf += chunk.toString();
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        const wait = pending.get(msg.id);
        if (wait) {
          pending.delete(msg.id);
          wait.resolve(msg);
        }
      } catch {
        /* ignore */
      }
    }
  });
  worker.stderr.on("data", (d) => {
    const s = d.toString().trim();
    if (s) console.warn("[tts-worker]", s);
  });
  worker.on("exit", () => {
    worker = null;
    workerReady = false;
    for (const [, wait] of pending) wait.reject(new Error("tts_worker_exit"));
    pending.clear();
  });
  return worker;
}

function workerRequest(payload, timeoutMs = 30000) {
  const w = ensureWorker();
  if (!w) return Promise.reject(new Error("no_worker"));
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("tts_worker_timeout"));
    }, timeoutMs);
    pending.set(id, {
      resolve: (msg) => {
        clearTimeout(timer);
        resolve(msg);
      },
      reject: (err) => {
        clearTimeout(timer);
        reject(err);
      },
    });
    w.stdin.write(JSON.stringify({ ...payload, id }) + "\n");
  });
}

async function synthViaWorker(text, cfg) {
  const model = piperVoice(cfg.voice || "en_US-lessac-medium");
  if (!model) return null;
  const tmp = path.join(os.tmpdir(), `buddy-tts-${process.pid}-${nextId}.wav`);
  try {
    const msg = await workerRequest({
      cmd: "synth",
      text,
      model,
      out: tmp,
      length_scale: cfg.lengthScale ?? 1,
      noise_w: cfg.noiseW,
    });
    if (!msg.ok || !fs.existsSync(tmp)) {
      throw new Error(msg.error || "worker_synth_failed");
    }
    const wav = fs.readFileSync(tmp);
    fs.unlink(tmp, () => {});
    return { wav, engine: "piper-warm", ms: msg.ms };
  } catch (err) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    throw err;
  }
}

/**
 * Synthesize one utterance. Prefers the warm worker (model stays loaded).
 */
export async function synthesize({ text, mood = "happy", engine } = {}) {
  const cfg = voiceForMood(mood);
  const want = engine || cfg.engine || "piper";
  const clean = cleanSpeakable(text);
  if (!clean) throw new Error("empty_text");

  if (want === "piper" || want === "piper-warm") {
    try {
      const warm = await synthViaWorker(clean, cfg);
      if (warm) return warm;
    } catch (err) {
      console.warn("[tts] warm worker miss:", err.message);
    }
    if (piperBin()) {
      const wav = await runPiperBinary(clean, cfg);
      if (wav) return { wav, engine: "piper" };
    }
  }
  if (want === "kokoro" || process.env.KOKORO_CMD) {
    const wav = await runKokoro(clean, cfg);
    if (wav) return { wav, engine: "kokoro", mood: cfg };
  }
  if (which("espeak-ng") || which("espeak")) {
    const wav = await runEspeak(clean, cfg);
    if (wav) return { wav, engine: "espeak", mood: cfg };
  }
  throw new Error("tts_unavailable");
}

/**
 * Stream sentence WAVs through the ONE warm process.
 * Yields { index, sentence, wav, engine, ms }.
 */
export async function* synthesizeSentences({ text, mood = "happy" } = {}) {
  const sentences = splitSentences(text);
  for (let i = 0; i < sentences.length; i++) {
    const t0 = performance.now();
    const { wav, engine, ms } = await synthesize({ text: sentences[i], mood });
    yield {
      index: i,
      sentence: sentences[i],
      wav,
      engine,
      ms: ms ?? performance.now() - t0,
    };
  }
}

export async function shutdownTtsWorker() {
  if (!worker) return;
  try {
    await workerRequest({ cmd: "quit" }, 2000);
  } catch {
    worker.kill("SIGTERM");
  }
  worker = null;
  workerReady = false;
}

function runPiperBinary(text, cfg) {
  const bin = piperBin();
  const model = piperVoice(cfg.voice || "en_US-lessac-medium");
  if (!bin || !model) return Promise.resolve(null);
  const tmp = path.join(os.tmpdir(), `buddy-tts-${Date.now()}.wav`);
  return new Promise((resolve, reject) => {
    const args = [
      "--model",
      model,
      "--output_file",
      tmp,
      "--length_scale",
      String(cfg.lengthScale ?? 1),
    ];
    if (cfg.noiseW != null) args.push("--noise_w", String(cfg.noiseW));
    const child = spawn(bin, args, { stdio: ["pipe", "pipe", "pipe"] });
    let err = "";
    child.stderr.on("data", (d) => {
      err += d.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0 || !fs.existsSync(tmp)) {
        reject(new Error(err || `piper_exit_${code}`));
        return;
      }
      const wav = fs.readFileSync(tmp);
      fs.unlink(tmp, () => {});
      resolve(wav);
    });
    child.stdin.write(text);
    child.stdin.end();
  });
}

function runEspeak(text, cfg) {
  const bin = which("espeak-ng") || which("espeak");
  const tmp = path.join(os.tmpdir(), `buddy-tts-${Date.now()}.wav`);
  return new Promise((resolve, reject) => {
    const args = [
      "-w",
      tmp,
      "-s",
      String(cfg.espeakRate ?? 160),
      "-p",
      String(cfg.espeakPitch ?? 45),
      text,
    ];
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let err = "";
    child.stderr.on("data", (d) => {
      err += d.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0 || !fs.existsSync(tmp)) {
        reject(new Error(err || `espeak_exit_${code}`));
        return;
      }
      const wav = fs.readFileSync(tmp);
      fs.unlink(tmp, () => {});
      resolve(wav);
    });
  });
}

function runKokoro(text, cfg) {
  const cmd = process.env.KOKORO_CMD;
  if (!cmd) return Promise.resolve(null);
  const tmp = path.join(os.tmpdir(), `buddy-tts-${Date.now()}.wav`);
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, [text, tmp, cfg.speaker || "af_bella", String(cfg.speed ?? 1)], {
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0 || !fs.existsSync(tmp)) {
        reject(new Error(`kokoro_exit_${code}`));
        return;
      }
      const wav = fs.readFileSync(tmp);
      fs.unlink(tmp, () => {});
      resolve(wav);
    });
  });
}

