/**
 * One mood vocabulary for body, brain, TTS, and character packs.
 * Emotion shows through body language — tags drive motion + voice, never a cartoon face.
 */

export const CANONICAL_MOODS = [
  "neutral",
  "happy",
  "excited",
  "angry",
  "sad",
  "surprised",
  "thinking",
  "listening",
  "battle",
] as const;

export type Mood = (typeof CANONICAL_MOODS)[number];

/** Allowed in `[tag]` but canonicalize to a Mood. `amused` is a happy variant. */
export const LEGACY_ALIASES: Record<string, Mood> = {
  // Product legacy → canonical
  fierce: "angry",
  calm: "neutral",
  curious: "thinking",
  mysterious: "neutral",
  determined: "battle",
  idle: "neutral",
  // Happy variant
  amused: "happy",
  // Soft synonyms
  mad: "angry",
  rage: "angry",
  normal: "neutral",
  joy: "happy",
  glad: "happy",
  smile: "happy",
  laugh: "happy",
  hype: "excited",
  hyped: "excited",
  wow: "excited",
  upset: "sad",
  cry: "sad",
  crying: "sad",
  shocked: "surprised",
  shock: "surprised",
  surprise: "surprised",
  think: "thinking",
  hmm: "thinking",
  listen: "listening",
  brave: "battle",
  fight: "battle",
  focused: "battle",
};

const CANONICAL_SET = new Set<string>(CANONICAL_MOODS);

export const DEFAULT_MOOD: Mood = "thinking";

export function isCanonicalMood(value: string): value is Mood {
  return CANONICAL_SET.has(value);
}

export function normalizeMood(raw: string | null | undefined): Mood {
  if (!raw) return DEFAULT_MOOD;
  const x = String(raw).toLowerCase().trim();
  if (LEGACY_ALIASES[x]) return LEGACY_ALIASES[x]!;
  if (isCanonicalMood(x)) return x;
  return DEFAULT_MOOD;
}

/** Prompt line for the LLM — canonical tags only (amused noted as happy variant). */
export function moodPromptLine(): string {
  return (
    "EVERY reply MUST start with a mood tag in square brackets, then a space, then the line. " +
    "Allowed moods: [neutral] [happy] [excited] [angry] [sad] [surprised] [thinking] [listening] [battle]. " +
    "Optional: wrap private reasoning in <think>...</think> (never spoken). " +
    "You may use [amused] as a happy variant — it maps to happy body/voice."
  );
}

const THINK_BLOCK = /<think>[\s\S]*?<\/think>/gi;
const THINK_OPEN = /<think>/i;

/** Remove complete think blocks; drop an unclosed trailing think so it is never spoken. */
export function stripThink(text: string): { speakable: string; inThink: boolean } {
  let s = String(text ?? "");
  s = s.replace(THINK_BLOCK, "");
  const open = s.search(THINK_OPEN);
  if (open !== -1) {
    return { speakable: s.slice(0, open).replace(/\s+/g, " ").trim(), inThink: true };
  }
  return { speakable: s.replace(/\s+/g, " ").trim(), inThink: false };
}

export type TaggedParse = {
  mood: Mood;
  /** Speakable text (think blocks removed). */
  text: string;
  /** True once a closing `]` for the leading mood tag has arrived (or no `[` prefix). */
  complete: boolean;
  inThink: boolean;
};

/**
 * Incremental `[mood] …` parser. Mood is available as soon as `]` arrives so the
 * body can react within ~100 ms while tokens keep streaming.
 */
export function parseTagged(raw: string): TaggedParse {
  const s = String(raw ?? "").trimStart();
  if (!s) {
    return { mood: DEFAULT_MOOD, text: "", complete: false, inThink: false };
  }

  if (s.startsWith("[")) {
    const close = s.indexOf("]");
    if (close === -1) {
      return { mood: DEFAULT_MOOD, text: "", complete: false, inThink: false };
    }
    const tag = s.slice(1, close);
    const rest = s.slice(close + 1);
    if (!/^[a-z]+$/i.test(tag)) {
      const { speakable, inThink } = stripThink(rest.trim() || s.trim());
      return { mood: DEFAULT_MOOD, text: speakable, complete: true, inThink };
    }
    const { speakable, inThink } = stripThink(rest);
    return {
      mood: normalizeMood(tag),
      text: speakable,
      complete: true,
      inThink,
    };
  }

  const { speakable, inThink } = stripThink(s);
  return { mood: DEFAULT_MOOD, text: speakable, complete: true, inThink };
}

/** Full reply helper — same contract as body `react("[mood] text")`. */
export function react(tagged: string): { emotion: Mood; text: string } {
  const p = parseTagged(tagged);
  return { emotion: p.mood, text: p.text };
}

export type StreamSnapshot = {
  mood: Mood | null;
  moodComplete: boolean;
  speakable: string;
  inThink: boolean;
  /** Newly completed sentences since last push (speakable only). */
  sentences: string[];
};

/**
 * Streaming accumulator: push LLM tokens; mood fires first, think never enters speakable.
 */
export class StreamingMoodParser {
  #buf = "";
  #mood: Mood | null = null;
  #moodComplete = false;
  #spokenLen = 0;

  push(chunk: string): StreamSnapshot {
    this.#buf += chunk;
    const parsed = parseTagged(this.#buf);
    if (parsed.complete && !this.#moodComplete) {
      this.#mood = parsed.mood;
      this.#moodComplete = true;
    } else if (parsed.complete) {
      this.#mood = parsed.mood;
    }

    const speakable = parsed.complete ? parsed.text : "";
    const sentences = splitNewSentences(speakable, this.#spokenLen);
    if (sentences.length) {
      // Track by speakable length of fully closed sentences only
      const closed = speakable.match(/[\s\S]*?[.!?]+/g);
      this.#spokenLen = closed ? closed.join("").length : this.#spokenLen;
    }

    return {
      mood: this.#moodComplete ? this.#mood : null,
      moodComplete: this.#moodComplete,
      speakable,
      inThink: parsed.inThink,
      sentences,
    };
  }

  reset(): void {
    this.#buf = "";
    this.#mood = null;
    this.#moodComplete = false;
    this.#spokenLen = 0;
  }

  snapshot(): StreamSnapshot {
    return this.push("");
  }
}

function splitNewSentences(speakable: string, already: number): string[] {
  const slice = speakable.slice(already);
  if (!slice) return [];
  const parts = slice.match(/[^.!?]+[.!?]+/g);
  return parts ? parts.map((s) => s.trim()).filter(Boolean) : [];
}

export function splitSentences(text: string): string[] {
  const cleaned = stripThink(text).speakable.replace(/\*[^*]+\*/g, " ").replace(/\s+/g, " ").trim();
  if (!cleaned) return [];
  const parts = cleaned.match(/[^.!?]+[.!?]+|[^.!?]+$/g);
  return (parts ?? [cleaned]).map((s) => s.trim()).filter(Boolean);
}

/** For TTS / pack maps keyed by canonical mood (legacy keys still resolve). */
export function moodLookupKey(mood: string): Mood {
  return normalizeMood(mood);
}
