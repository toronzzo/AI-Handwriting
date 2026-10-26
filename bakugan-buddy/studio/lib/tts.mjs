import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadVoices, piperBin, piperVoice, which } from "./paths.mjs";

const voices = loadVoices();

export function ttsStatus() {
  const piper = piperBin();
  const espeak = which("espeak-ng") || which("espeak");
  const kokoro = Boolean(process.env.KOKORO_CMD);
  return {
    piper: Boolean(piper),
    espeak: Boolean(espeak),
    kokoro,
    ready: Boolean(piper || espeak || kokoro),
    engine: piper ? "piper" : kokoro ? "kokoro" : espeak ? "espeak" : null,
  };
}

export function voiceForMood(mood) {
  const key = mood === "angry" ? "fierce" : mood;
  const map = voices.moods || voices;
  return map[key] || map.idle || map.happy;
}

/**
 * Synthesize WAV bytes for { text, mood, engine? }.
 * Piper default; Kokoro if engine=kokoro and KOKORO_CMD set; espeak-ng fallback.
 */
export async function synthesize({ text, mood = "happy", engine } = {}) {
  const cfg = voiceForMood(mood);
  const want = engine || cfg.engine || "piper";
  const clean = String(text || "").replace(/\[([a-z]+)\]/gi, "").trim();
  if (!clean) throw new Error("empty_text");

  if (want === "piper" && piperBin()) {
    const wav = await runPiper(clean, cfg);
    if (wav) return { wav, engine: "piper", mood: cfg };
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

function runPiper(text, cfg) {
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
    if (cfg.noiseW != null) {
      args.push("--noise_w", String(cfg.noiseW));
    }
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
