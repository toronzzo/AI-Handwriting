/**
 * What Preyas's face is doing.
 *
 * Real app state wins: the mic, a reply still arriving, then his voice.
 * After that, a mood tag from the brain (`[happy] …`) wins over the words.
 * With no tag, emojis are counted, then a few plain phrases.
 * The face art is original; this file only decides which expression to show.
 */
import { isCanonicalMood, LEGACY_ALIASES, type Mood } from "../../../../packages/mood/src/index.ts";

export const FACE_EXPRESSIONS = [
  "idle",
  "listening",
  "thinking",
  "talking",
  "happy",
  "surprised",
  "sad",
  "excited",
  "sleepy",
] as const;

export type FaceExpression = (typeof FACE_EXPRESSIONS)[number];

/** A brain mood, plus sleepy, which the face understands and the body vocabulary does not. */
export type FaceMood = Mood | "sleepy";

export type FaceSignals = {
  /** The tap-to-talk mic is recording. */
  recording: boolean;
  /** A reply, search, or document read is still in flight. */
  generating: boolean;
  /** TTS audio is playing. */
  speaking: boolean;
  /** Latest reply, tag included. Empty when he has not spoken yet. */
  reply: string;
};

export type FaceRead = {
  expression: FaceExpression;
  /** Tint for the eyes and the mouth shape. Null when nothing was inferred. */
  mood: FaceMood | null;
};

/** Samples from the TTS wav, one RMS value per 20 ms hop (`envelopeFromPcm16`). */
export type FacePlayback = {
  envelope: readonly number[];
  talkStart: number;
  playing: boolean;
};

export const EXPRESSION_LABEL: Record<FaceExpression, string> = {
  idle: "Idle",
  listening: "Listening",
  thinking: "Thinking",
  talking: "Talking",
  happy: "Happy",
  surprised: "Surprised",
  sad: "Sad",
  excited: "Battle ready",
  sleepy: "Sleepy",
};

const TAG = /^\s*\[([a-z]+)\]/i;

const MOOD_EXPRESSION: Record<FaceMood, FaceExpression> = {
  neutral: "idle",
  happy: "happy",
  excited: "excited",
  angry: "excited",
  sad: "sad",
  surprised: "surprised",
  thinking: "thinking",
  listening: "listening",
  battle: "excited",
  sleepy: "sleepy",
};

const EXPRESSION_MOOD: Record<FaceExpression, FaceMood | null> = {
  idle: null,
  listening: "listening",
  thinking: "thinking",
  talking: null,
  happy: "happy",
  surprised: "surprised",
  sad: "sad",
  excited: "excited",
  sleepy: "sleepy",
};

/** Emoji that carry a feeling when the brain did not send a tag. */
const EMOJI_EXPRESSION: Record<string, FaceExpression> = {
  "😀": "happy",
  "😃": "happy",
  "😄": "happy",
  "😁": "happy",
  "😆": "happy",
  "😅": "happy",
  "😂": "happy",
  "🤣": "happy",
  "😊": "happy",
  "🙂": "happy",
  "😉": "happy",
  "😍": "happy",
  "🥰": "happy",
  "😘": "happy",
  "🤗": "happy",
  "👍": "happy",
  "❤": "happy",
  "💕": "happy",
  "💖": "happy",
  "✨": "happy",
  "🎉": "happy",
  "😮": "surprised",
  "😲": "surprised",
  "😯": "surprised",
  "🤯": "surprised",
  "😱": "surprised",
  "😳": "surprised",
  "😢": "sad",
  "😭": "sad",
  "😞": "sad",
  "😔": "sad",
  "😟": "sad",
  "🥺": "sad",
  "💔": "sad",
  "😿": "sad",
  "🔥": "excited",
  "⚡": "excited",
  "💪": "excited",
  "⚔": "excited",
  "🏆": "excited",
  "🤩": "excited",
  "😤": "excited",
  "💥": "excited",
  "🙌": "excited",
  "😴": "sleepy",
  "💤": "sleepy",
  "🥱": "sleepy",
  "😪": "sleepy",
  "🤔": "thinking",
  "🧐": "thinking",
  "👂": "listening",
};

/** First match wins, so the more specific phrases sit above the broad ones. */
const WORDS: { expression: FaceExpression; pattern: RegExp }[] = [
  { expression: "sleepy", pattern: /\b(sleepy|tired|yawn(?:ing)?|drowsy|bedtime|good\s*night|goodnight)\b/i },
  { expression: "sad", pattern: /\b(sad|sorry|lonely|miss you|crying|cried|upset|heartbroken)\b/i },
  { expression: "surprised", pattern: /\b(wow|whoa|whoop|gasp|no way|unbelievable)\b/i },
  { expression: "excited", pattern: /\b(battle|let's go|lets go|hype|hyped|pumped|make a splash)\b/i },
  { expression: "thinking", pattern: /\b(hmm+|let me think|thinking|ponder|wondering)\b/i },
  { expression: "listening", pattern: /\b(i'm listening|im listening|go on|tell me more)\b/i },
  { expression: "happy", pattern: /\b(haha|hehe|glad|yay|love|great|nice|thank|thanks|happy|fun|awesome)\b/i },
];

/** Tie break when two feelings have the same number of emoji. */
const TIE_BREAK: readonly FaceExpression[] = [
  "surprised",
  "sad",
  "excited",
  "sleepy",
  "happy",
  "thinking",
  "listening",
];

/** A leading `[tag]` the face knows, or null when the reply has no usable tag. */
export function readMoodTag(reply: string): FaceMood | null {
  const match = TAG.exec(reply ?? "");
  if (!match) return null;
  const raw = match[1]!.toLowerCase();
  if (raw === "sleepy" || raw === "tired" || raw === "drowsy" || raw === "asleep") return "sleepy";
  if (Object.prototype.hasOwnProperty.call(LEGACY_ALIASES, raw)) return LEGACY_ALIASES[raw]!;
  if (isCanonicalMood(raw)) return raw;
  return null;
}

/** Drop a recognised leading tag so the bubble and the voice do not read it aloud. */
export function spokenText(reply: string): string {
  if (!readMoodTag(reply)) return reply ?? "";
  return (reply ?? "").replace(TAG, "").trim();
}

function emojiHits(text: string): FaceExpression[] {
  const hits: FaceExpression[] = [];
  for (const token of text.matchAll(/\p{Extended_Pictographic}\uFE0F?/gu)) {
    const raw = token[0];
    const base = raw.replace(/\uFE0F/g, "");
    const found = EMOJI_EXPRESSION[raw] ?? EMOJI_EXPRESSION[base];
    if (found) hits.push(found);
  }
  return hits;
}

function vote(hits: readonly FaceExpression[]): FaceExpression | null {
  if (hits.length === 0) return null;
  const counts = new Map<FaceExpression, number>();
  for (const hit of hits) counts.set(hit, (counts.get(hit) ?? 0) + 1);
  let best: FaceExpression | null = null;
  let bestCount = 0;
  for (const name of TIE_BREAK) {
    const count = counts.get(name) ?? 0;
    if (count > bestCount) {
      best = name;
      bestCount = count;
    }
  }
  return best;
}

/** Feeling of the reply alone: tag, then emoji, then a phrase. Null when it is just talk. */
export function sentimentMood(reply: string): FaceMood | null {
  const tagged = readMoodTag(reply);
  if (tagged) return tagged;
  const fromEmoji = vote(emojiHits(reply ?? ""));
  if (fromEmoji) return EXPRESSION_MOOD[fromEmoji];
  const text = reply ?? "";
  for (const rule of WORDS) {
    if (rule.pattern.test(text)) return EXPRESSION_MOOD[rule.expression];
  }
  return null;
}

export function expressionForMood(mood: FaceMood): FaceExpression {
  return MOOD_EXPRESSION[mood];
}

/**
 * Activity first, then the reply.
 * Recording beats speech (he was interrupted). Speech beats a reply that is
 * still streaming. A tag beats emoji, which beat plain phrases.
 */
export function readFace(signals: FaceSignals): FaceRead {
  const mood = sentimentMood(signals.reply);
  if (signals.recording) return { expression: "listening", mood };
  if (signals.speaking) return { expression: "talking", mood };
  if (signals.generating) return { expression: "thinking", mood };
  if (mood) return { expression: expressionForMood(mood), mood };
  return { expression: "idle", mood: null };
}

/** Fold "the wav is actually playing" into the signals the header already has. */
export function liveExpression(signals: FaceSignals, playing: boolean): FaceExpression {
  const speaking = signals.speaking || playing;
  return readFace({
    ...signals,
    speaking,
    generating: signals.generating && !speaking && !signals.recording,
  }).expression;
}

/** A fullscreen preview pin. Talking keeps the reply's mood so the mouth still matches. */
export function applyPin(live: FaceRead, pin: FaceExpression | null): FaceRead {
  if (!pin) return live;
  if (pin === "talking") return { expression: "talking", mood: live.mood };
  return { expression: pin, mood: EXPRESSION_MOOD[pin] };
}

/** Mood string for the existing TTS prosody. Neutral when the reply has no feeling. */
export function speechMood(reply: string): string {
  return sentimentMood(reply) ?? "neutral";
}
