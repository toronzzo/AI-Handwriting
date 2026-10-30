/**
 * Mac speech helpers. Whisper for hearing, Piper for the voice.
 * Kokoro and the cloning models stay off this path: Piper's Ryan and Dmitri
 * voices are published Piper voices, not a recording of the show.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function whisperArgs(model, wavPath, outBase) {
  return ["-m", model, "-f", wavPath, "-l", "auto", "--no-timestamps", "-otxt", "-of", outBase];
}

export function piperScript() {
  return `
import sys
from piper import PiperVoice
voice_path, out_path, text, length_s, noise_s = sys.argv[1:6]
voice = PiperVoice.load(voice_path)
length_scale = float(length_s)
noise_scale = float(noise_s)
with open(out_path, "wb") as handle:
    import wave
    with wave.open(handle, "wb") as wav:
        config = None
        try:
            from piper import SynthesisConfig
            config = SynthesisConfig(length_scale=length_scale, noise_scale=noise_scale)
        except Exception:
            config = None
        if hasattr(voice, "synthesize_wav"):
            if config is not None:
                voice.synthesize_wav(text, wav, syn_config=config)
            else:
                voice.synthesize_wav(text, wav)
        else:
            voice.synthesize(text, wav)
`;
}

function run(cmd, args, timeoutMs = 20000, stdinText = "") {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, timeoutMs);
    if (stdinText) child.stdin.write(stdinText);
    child.stdin.end();
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: 1, stdout, stderr: String(error) });
    });
  });
}

function languageFrom(stderr) {
  const match = stderr.match(/language:\s*([a-z]{2})/i);
  return match ? match[1].toLowerCase() : "en";
}

export async function transcribeFile(wavPath, env = process.env) {
  if (env.WHISPER_URL) {
    try {
      const wav = fs.readFileSync(wavPath);
      const boundary = `preyas${Date.now()}`;
      const head = Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="in.wav"\r\nContent-Type: audio/wav\r\n\r\n`,
      );
      const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
      const body = Buffer.concat([head, wav, tail]);
      const res = await fetch(`${env.WHISPER_URL.replace(/\/$/, "")}/inference`, {
        method: "POST",
        headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
        body,
      });
      if (res.ok) {
        const json = await res.json();
        const text = String(json.text || "").trim();
        if (text) return { text, language: String(json.language || "en") };
      }
    } catch {
      /* fall through to the CLI */
    }
  }
  const model = env.WHISPER_MODEL || "";
  const bin = env.WHISPER_BIN || "whisper-cli";
  if (!model || !fs.existsSync(model)) return null;
  const base = wavPath.replace(/\.wav$/i, "");
  const result = await run(bin, whisperArgs(model, wavPath, base));
  const sidecar = `${base}.txt`;
  let text = "";
  if (fs.existsSync(sidecar)) {
    text = fs.readFileSync(sidecar, "utf8").trim();
    fs.rmSync(sidecar, { force: true });
  }
  if (!text) text = result.stdout.trim();
  if (!text) return null;
  return { text, language: languageFrom(result.stderr) };
}

export async function synthesizeFile(request, env = process.env) {
  const voiceId = request.voice || "am_puck";
  const root = env.BAKUGAN_DATA_DIR || "";
  const out = path.join(os.tmpdir(), `preyas-say-${process.pid}-${Date.now()}.wav`);
  const lengthScale = Number(request.lengthScale || 1);
  const kokoroSpeed = lengthScale > 0 ? 1 / lengthScale : 1;
  if (root && !String(voiceId).startsWith("ru_")) {
    const model = path.join(root, "models", "kokoro", "kokoro-v1.0.onnx");
    const voices = path.join(root, "models", "kokoro", "voices-v1.0.bin");
    const py = env.PIPER_PYTHON || "";
    if (py && fs.existsSync(py) && fs.existsSync(model) && fs.existsSync(voices)) {
      const script = `
import sys
from kokoro_onnx import Kokoro
import soundfile as sf
model, voices, out_path, text, voice, speed = sys.argv[1:7]
kokoro = Kokoro(model, voices)
samples, rate = kokoro.create(text, voice=voice, speed=float(speed), lang="en-us")
sf.write(out_path, samples, rate)
`;
      const result = await run(py, ["-c", script, model, voices, out, request.text, voiceId, String(kokoroSpeed)]);
      if (result.code === 0 && fs.existsSync(out)) {
        const bytes = fs.readFileSync(out);
        fs.rmSync(out, { force: true });
        return bytes;
      }
    }
  }
  const piperId = String(voiceId).startsWith("ru_") ? voiceId : "en_US-ryan-high";
  const voice = path.join(root, "models", "piper-voices", `${piperId}.onnx`);
  if (!root || !fs.existsSync(voice)) return null;
  const py = env.PIPER_PYTHON || "";
  const length = String(lengthScale || 1);
  const noiseScale = String(request.noiseScale || 0.6);
  let code = 1;
  if (py && fs.existsSync(py)) {
    const result = await run(py, ["-c", piperScript(), voice, out, request.text, length, noiseScale]);
    code = result.code;
  }
  if (code !== 0 || !fs.existsSync(out)) {
    const binary = path.join(root, "models", "piper", "piper");
    if (!fs.existsSync(binary)) return null;
    const result = await run(
      binary,
      ["--model", voice, "--output_file", out, "--length_scale", length, "--noise_scale", noiseScale],
      20000,
      request.text,
    );
    if (result.code !== 0 && !fs.existsSync(out)) return null;
  }
  if (!fs.existsSync(out)) return null;
  const bytes = fs.readFileSync(out);
  fs.rmSync(out, { force: true });
  return bytes;
}
