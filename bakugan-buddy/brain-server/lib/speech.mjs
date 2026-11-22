/**
 * Mac speech helpers. Whisper for hearing, Piper for the voice.
 * Kokoro and the cloning models stay off this path: Piper's Ryan and Dmitri
 * voices are published Piper voices, not a recording of the show.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CONNECT_TIMEOUT_MS, connectWithTimeout } from "./netTimeout.mjs";

/** The bigger model this Mac already has; better at Russian and English. */
export const WHISPER_PREFERRED = "ggml-small.bin";
/** The model the brain shipped with; used when the bigger one is missing. */
export const WHISPER_FALLBACK = "ggml-base.bin";

/**
 * The preferred model the user set on purpose, or null when the setting is
 * unset or unreadable. Anything other than the fallback's own file name counts
 * as "on purpose" (for example a custom path or ggml-small.en.bin).
 */
export function explicitWhisperModel(env = process.env) {
  const set = String(env.WHISPER_MODEL || "").trim();
  if (!set) return null;
  if (path.basename(set) === WHISPER_FALLBACK) return null;
  return set;
}

/**
 * Which whisper model to hear with. A model the user chose on purpose wins;
 * otherwise the bigger ggml-small.bin is preferred when it exists, and the
 * current ggml-base.bin is the fallback. Returns "" when nothing is findable.
 */
export function whisperModelFor(env = process.env, exists = (file) => fs.existsSync(file)) {
  const chosen = explicitWhisperModel(env);
  if (chosen) return chosen;
  const root = String(env.BAKUGAN_DATA_DIR || "").trim();
  if (root) {
    const preferred = path.join(root, "models", "whisper", WHISPER_PREFERRED);
    if (exists(preferred)) return preferred;
  }
  const set = String(env.WHISPER_MODEL || "").trim();
  if (set) return set;
  if (root) return path.join(root, "models", "whisper", WHISPER_FALLBACK);
  return "";
}

/**
 * The whisper.cpp CLI. WHISPER_BIN wins; otherwise the build setup-all.sh puts
 * on the drive (tools/whisper/whisper-cli), then plain "whisper-cli" on PATH.
 * scripts/preyas.sh starts the brain without brain.env, so the drive default
 * is what makes the mic work there.
 */
export function whisperBinFor(env = process.env, exists = (file) => fs.existsSync(file)) {
  const set = String(env.WHISPER_BIN || "").trim();
  if (set) return set;
  const root = String(env.BAKUGAN_DATA_DIR || "").trim();
  if (root) {
    const onDrive = path.join(root, "tools", "whisper", "whisper-cli");
    if (exists(onDrive)) return onDrive;
  }
  return "whisper-cli";
}

/**
 * The Python that has kokoro_onnx and piper. PIPER_PYTHON wins; otherwise the
 * venv setup-all.sh makes on the drive (venvs/tts). "" when neither exists.
 */
export function voicePythonFor(env = process.env, exists = (file) => fs.existsSync(file)) {
  const set = String(env.PIPER_PYTHON || "").trim();
  if (set && exists(set)) return set;
  const root = String(env.BAKUGAN_DATA_DIR || "").trim();
  if (root) {
    const onDrive = path.join(root, "venvs", "tts", "bin", "python");
    if (exists(onDrive)) return onDrive;
  }
  return "";
}

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

/**
 * Ask a whisper.cpp server. The connect probe is about 3s so a sleeping
 * laptop cannot hold the mic; once the handshake succeeds, transcription
 * itself is allowed to finish. Null means "try the local CLI".
 */
async function transcribeRemote(wavPath, remote, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const connect = options.connect || connectWithTimeout;
  const connectTimeoutMs = options.connectTimeoutMs ?? CONNECT_TIMEOUT_MS;
  const base = String(remote || "").trim().replace(/\/$/, "");
  if (!base) return null;
  try {
    let open = false;
    try {
      open = await connect(`${base}/inference`, connectTimeoutMs);
    } catch {
      open = false;
    }
    if (!open) return null;
    const wav = fs.readFileSync(wavPath);
    const boundary = `preyas${Date.now()}`;
    const head = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="in.wav"\r\nContent-Type: audio/wav\r\n\r\n`,
    );
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
    const body = Buffer.concat([head, wav, tail]);
    const res = await fetchImpl(`${base}/inference`, {
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
  return null;
}

export async function transcribeFile(wavPath, env = process.env, options = {}) {
  const remote = String((env && env.WHISPER_URL) || "").trim();
  if (remote) {
    const heard = await transcribeRemote(wavPath, remote, options);
    if (heard) return heard;
  }
  const model = whisperModelFor(env);
  const bin = whisperBinFor(env);
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
    const py = voicePythonFor(env);
    if (py && fs.existsSync(model) && fs.existsSync(voices)) {
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
  const py = voicePythonFor(env);
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
