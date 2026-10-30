/**
 * Turn-taking for Preyas's voice. Pure functions: the frame loop only
 * reads numbers that these helpers already computed.
 */

export type VadOptions = {
  /** RMS above this starts a turn. */
  start: number;
  /** RMS below this counts as silence. */
  stop: number;
  /** Silence after speech that ends the turn. */
  silenceMs: number;
  /** Ignore blips shorter than this. */
  minSpeechMs: number;
};

export const DEFAULT_VAD: VadOptions = {
  start: 0.04,
  stop: 0.025,
  silenceMs: 420,
  minSpeechMs: 280,
};

export type VadState = {
  speaking: boolean;
  speechMs: number;
  silenceMs: number;
};

export function freshVad(): VadState {
  return { speaking: false, speechMs: 0, silenceMs: 0 };
}

export type VadStep = {
  state: VadState;
  /** User just started, so stop Preyas if he is talking. */
  bargeIn: boolean;
  /** User finished a phrase. */
  endpoint: boolean;
};

export function stepVad(state: VadState, rms: number, dtMs: number, opts: VadOptions = DEFAULT_VAD): VadStep {
  const dt = dtMs > 0 ? dtMs : 0;
  if (!state.speaking) {
    if (rms >= opts.start) {
      return {
        state: { speaking: true, speechMs: dt, silenceMs: 0 },
        bargeIn: true,
        endpoint: false,
      };
    }
    return { state, bargeIn: false, endpoint: false };
  }
  const speechMs = state.speechMs + dt;
  if (rms >= opts.stop) {
    return { state: { speaking: true, speechMs, silenceMs: 0 }, bargeIn: false, endpoint: false };
  }
  const silenceMs = state.silenceMs + dt;
  if (silenceMs >= opts.silenceMs && speechMs >= opts.minSpeechMs) {
    return { state: freshVad(), bargeIn: false, endpoint: true };
  }
  return { state: { speaking: true, speechMs, silenceMs }, bargeIn: false, endpoint: false };
}

/** Completed sentences, plus the unfinished tail. Handles English and Russian punctuation. */
export function takeSentences(buffer: string): { ready: string[]; rest: string } {
  const ready: string[] = [];
  let start = 0;
  for (let i = 0; i < buffer.length; i++) {
    const ch = buffer[i];
    if (ch !== "." && ch !== "!" && ch !== "?" && ch !== "…" && ch !== "。" && ch !== "！") continue;
    const sentence = buffer.slice(start, i + 1).trim();
    if (sentence.length > 1) ready.push(sentence);
    start = i + 1;
  }
  return { ready, rest: buffer.slice(start).trim() };
}

export type Prosody = {
  lengthScale: number;
  noiseScale: number;
  voiceId: string;
};

export type VoiceConfig = {
  en: string;
  ru: string;
  speed: number;
};

export const DEFAULT_VOICES: VoiceConfig = {
  en: "am_puck",
  ru: "ru_RU-dmitri-medium",
  speed: 1.05,
};

export function voiceForLanguage(language: string, voices: VoiceConfig = DEFAULT_VOICES): string {
  const tag = language.toLowerCase();
  if (tag.startsWith("ru")) return voices.ru;
  return voices.en;
}

/** Piper length_scale: lower is faster. Mood nudges delivery; speed is the user's knob. */
export function prosodyFor(mood: string, language: string, voices: VoiceConfig = DEFAULT_VOICES): Prosody {
  const speed = voices.speed > 0 ? voices.speed : 1;
  let length = 1 / speed;
  let noise = 0.6;
  switch (mood) {
    case "excited":
    case "battle":
      length *= 0.84;
      noise = 0.75;
      break;
    case "happy":
      length *= 0.92;
      noise = 0.68;
      break;
    case "angry":
      length *= 0.88;
      noise = 0.5;
      break;
    case "sad":
    case "sleepy":
    case "neutral":
      if (mood === "sad" || mood === "sleepy") {
        length *= 1.18;
        noise = 0.35;
      }
      break;
    default:
      break;
  }
  return {
    lengthScale: length,
    noiseScale: noise,
    voiceId: voiceForLanguage(language, voices),
  };
}

/** 0..1 envelope, one sample per hop. Used by the frame loop, not by React. */
export function envelopeFromPcm16(samples: Int16Array, hop = 320): number[] {
  const out: number[] = [];
  if (hop < 1) hop = 1;
  for (let i = 0; i < samples.length; i += hop) {
    let sum = 0;
    const end = i + hop < samples.length ? i + hop : samples.length;
    for (let j = i; j < end; j++) {
      const x = samples[j]! / 32768;
      sum += x * x;
    }
    const rms = Math.sqrt(sum / (end - i));
    out.push(rms > 1 ? 1 : rms);
  }
  return out;
}

/** Pull 16-bit PCM out of a wav Piper (or a test double) produced. */
export function pcm16FromWav(bytes: Uint8Array): Int16Array | null {
  if (bytes.length < 44) return null;
  const ascii = (at: number) => String.fromCharCode(bytes[at]!, bytes[at + 1]!, bytes[at + 2]!, bytes[at + 3]!);
  if (ascii(0) !== "RIFF" || ascii(8) !== "WAVE") return null;
  let offset = 12;
  let dataAt = -1;
  let dataLen = 0;
  while (offset + 8 <= bytes.length) {
    const id = ascii(offset);
    const size = bytes[offset + 4]! | (bytes[offset + 5]! << 8) | (bytes[offset + 6]! << 16) | (bytes[offset + 7]! << 24);
    if (id === "data") {
      dataAt = offset + 8;
      dataLen = size;
      break;
    }
    offset += 8 + size;
  }
  if (dataAt < 0) return null;
  const end = dataAt + dataLen < bytes.length ? dataAt + dataLen : bytes.length;
  const count = ((end - dataAt) / 2) | 0;
  const samples = new Int16Array(count);
  for (let i = 0; i < count; i++) {
    const b = dataAt + i * 2;
    let value = bytes[b]! | (bytes[b + 1]! << 8);
    if (value & 0x8000) value -= 0x10000;
    samples[i] = value;
  }
  return samples;
}

export type Heard = { text: string; language: string };

export async function transcribeClip(
  baseUrl: string,
  wav: Uint8Array,
  timeoutMs = 8000,
  fetchImpl: typeof fetch = fetch,
): Promise<Heard | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${baseUrl.replace(/\/$/, "")}/v1/stt`, {
      method: "POST",
      headers: { "content-type": "audio/wav" },
      body: new Blob([wav.slice()], { type: "audio/wav" }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { text?: unknown; language?: unknown };
    if (typeof body.text !== "string" || !body.text.trim()) return null;
    const language = typeof body.language === "string" && body.language ? body.language : "en";
    return { text: body.text.trim(), language };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function synthesizeLine(
  baseUrl: string,
  text: string,
  mood: string,
  language: string,
  voices: VoiceConfig = DEFAULT_VOICES,
  timeoutMs = 8000,
  fetchImpl: typeof fetch = fetch,
): Promise<Uint8Array | null> {
  const prosody = prosodyFor(mood, language, voices);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${baseUrl.replace(/\/$/, "")}/v1/tts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text,
        mood,
        language,
        voice: prosody.voiceId,
        lengthScale: prosody.lengthScale,
        noiseScale: prosody.noiseScale,
      }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length < 44 || bytes[0] !== 0x52) return null;
    return bytes;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
