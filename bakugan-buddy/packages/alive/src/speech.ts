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

/** While he is talking, speaker bleed sits near the normal start level. A real interruption is louder. */
export const BARGE_VAD: VadOptions = {
  start: 0.12,
  stop: 0.08,
  silenceMs: 420,
  minSpeechMs: 280,
};

/** Keep the mic closed this long after his playback ends so the room tone is not a new turn. */
export const ECHO_TAIL_MS = 400;

export const MIN_CLIP_MS = 280;

/** True while his wav is still playing, plus a short tail. A barge-in sets talkUntil to 0 and opens the ear. */
export function earIsMuted(now: number, talkUntil: number, tailMs = ECHO_TAIL_MS): boolean {
  return talkUntil > 0 && now < talkUntil + tailMs;
}

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

export type SpeechCursor = {
  count: number;
  line: string;
};

/**
 * Sentences that still need a voice. A partial and the final call share one
 * cursor, so the finished reply does not speak the same sentence again.
 * A later final of that same line speaks nothing. A new line starts over.
 */
export function planSpeech(
  line: string,
  cursor: SpeechCursor,
  final: boolean,
): { cursor: SpeechCursor; speak: string[] } {
  const trimmed = line.trim().replace(/\s+/g, " ");
  const prev = normalizeHeard(cursor.line);
  const next = normalizeHeard(trimmed);
  const extended = prev.length > 0 && (next.startsWith(prev) || prev.startsWith(next));
  const seen = new Set<string>();
  const ended = final && trimmed && !/[.!?…。！？]$/.test(trimmed) ? `${trimmed}.` : trimmed;
  const split = takeSentences(ended);
  const ready = split.ready.map((sentence) => dedupeSpoken(sentence));
  if (final && split.rest) ready.push(dedupeSpoken(split.rest));
  const start = extended ? cursor.count : 0;
  for (let i = 0; i < start && i < ready.length; i++) {
    const key = normalizeHeard(ready[i] ?? "");
    if (key) seen.add(key);
  }
  const speak: string[] = [];
  for (let i = start; i < ready.length; i++) {
    const sentence = ready[i] ?? "";
    const key = normalizeHeard(sentence);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    speak.push(sentence);
  }
  return { cursor: { count: Math.max(start, ready.length), line: trimmed }, speak };
}

const mouths = new WeakMap<object, { cursor: SpeechCursor; said: string[] }>();

/** Remember what this sink already sent to the speaker. */
export function takeNewSentences(key: object, line: string, final: boolean): string[] {
  const row = mouths.get(key) ?? { cursor: { count: 0, line: "" }, said: [] };
  const plan = planSpeech(line, row.cursor, final);
  row.cursor = plan.cursor;
  for (let i = 0; i < plan.speak.length; i++) {
    row.said.push(plan.speak[i]!);
    if (row.said.length > 4) row.said.shift();
  }
  mouths.set(key, row);
  return plan.speak;
}

export function recentLines(key: object): readonly string[] {
  return mouths.get(key)?.said ?? [];
}

/** Collapse "mine mine mine" and a line that is the same phrase twice. */
export function dedupeSpoken(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, " ");
  if (!trimmed) return "";
  const words = trimmed.split(/\s+/);
  const kept: string[] = [];
  let prev = "";
  for (let i = 0; i < words.length; i++) {
    const word = words[i]!;
    const key = word.toLowerCase();
    if (key === prev) continue;
    kept.push(word);
    prev = key;
  }
  const lower = kept.map((word) => word.toLowerCase());
  for (let size = 1; size <= 4; size++) {
    if (lower.length < size * 2 || lower.length % size !== 0) continue;
    const chunk = lower.slice(0, size).join(" ");
    let same = true;
    for (let i = size; i < lower.length; i += size) {
      if (lower.slice(i, i + size).join(" ") !== chunk) {
        same = false;
        break;
      }
    }
    if (same) return kept.slice(0, size).join(" ");
  }
  return kept.join(" ");
}

export function normalizeHeard(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^0-9a-zA-Zа-яА-ЯёЁ']+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const WHISPER_FILLERS = new Set([
  "you",
  "thank you",
  "thanks",
  "thanks for watching",
  "thank you for watching",
  "bye",
  "goodbye",
  "okay",
  "ok",
  "hmm",
  "mm",
  "uh",
  "um",
  "subtitles",
  "subscribe",
  "please subscribe",
  "продолжение следует",
  "субтитры",
  "спасибо за просмотр",
]);

/** Whisper loops on silence: one token repeated, or a short phrase three times, or a stock filler. */
export function isWhisperHallucination(text: string): boolean {
  const raw = text.trim();
  if (!raw || /^\[?\s*blank[_\s-]*audio\s*\]?$/i.test(raw)) return true;
  const norm = normalizeHeard(raw);
  if (!norm || norm === "blank audio" || WHISPER_FILLERS.has(norm)) return true;
  const words = norm.split(" ");
  if (words.length >= 2 && new Set(words).size === 1) return true;
  if (words.length >= 6) {
    for (let size = 2; size <= 4; size++) {
      if (words.length % size !== 0 || words.length / size < 3) continue;
      const chunk = words.slice(0, size).join(" ");
      let same = true;
      for (let i = size; i < words.length; i += size) {
        if (words.slice(i, i + size).join(" ") !== chunk) {
          same = false;
          break;
        }
      }
      if (same) return true;
    }
  }
  return false;
}

/** The mic heard him. Short answers like "yes" stay; a transcript of his own line does not. */
export function hearsOwnVoice(heard: string, spoken: readonly string[]): boolean {
  const heardTokens = normalizeHeard(heard).split(" ").filter(Boolean);
  if (heardTokens.length === 0) return true;
  const heardLine = heardTokens.join(" ");
  for (let i = 0; i < spoken.length; i++) {
    const saidTokens = normalizeHeard(spoken[i] ?? "").split(" ").filter(Boolean);
    if (saidTokens.length === 0) continue;
    const saidLine = saidTokens.join(" ");
    if (heardLine === saidLine) return true;
    if (saidLine.includes(heardLine) && heardLine.length >= 8) return true;
    if (heardLine.includes(saidLine) && saidLine.length >= 8) return true;
    if (heardTokens.length >= 3) {
      const said = new Set(saidTokens);
      let hit = 0;
      for (let w = 0; w < heardTokens.length; w++) if (said.has(heardTokens[w]!)) hit += 1;
      if (hit / heardTokens.length >= 0.75) return true;
    }
  }
  return false;
}

export function wavDurationMs(bytes: Uint8Array): number | null {
  if (bytes.length < 44) return null;
  const rate = bytes[24]! | (bytes[25]! << 8) | (bytes[26]! << 16) | (bytes[27]! << 24);
  const pcm = pcm16FromWav(bytes);
  if (!pcm || rate < 1000) return null;
  return (pcm.length / rate) * 1000;
}

export function clipTooShort(bytes: Uint8Array, minMs = MIN_CLIP_MS): boolean {
  const ms = wavDurationMs(bytes);
  return ms == null || ms < minMs;
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
