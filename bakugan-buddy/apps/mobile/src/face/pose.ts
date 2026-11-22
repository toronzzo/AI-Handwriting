/**
 * Numbers for the face drawing. The component lerps toward these so a mood
 * change eases instead of popping. Reduced motion returns a still pose:
 * eyes open (or the expression's resting lid), no breath, no look-around.
 */
import { type FaceExpression, type FaceMood, type FaceRead } from "./expression.ts";

export type FacePose = {
  /** 0 closed, 1 fully open, before the blink multiplier. */
  eyeOpen: number;
  /** -1 lowered, 1 raised. */
  brow: number;
  /** -1 frown, 1 smile. */
  smile: number;
  /** 0 shut, 1 wide open. */
  mouth: number;
  /** 0 slicked, 1 flared. */
  crest: number;
  /** -1 left, 1 right. */
  lookX: number;
  /** -1 up, 1 down. */
  lookY: number;
  /** How far the two eyes diverge. Chameleon, kept small. */
  turret: number;
  /** -1 left, 1 right. */
  tilt: number;
  /** 0 none, 1 full cheek spots. */
  blush: number;
  /** 0 tucked, 1 side fins out. */
  fin: number;
  /** -1 .. 1 breath cycle. 0 when motion is reduced. */
  breath: number;
};

export const ENVELOPE_HOP_MS = 20;

const REST: FacePose = {
  eyeOpen: 1,
  brow: 0.08,
  smile: 0.16,
  mouth: 0.02,
  crest: 0.38,
  lookX: 0,
  lookY: 0,
  turret: 0.12,
  tilt: 0,
  blush: 0.18,
  fin: 0.32,
  breath: 0,
};

const POSE: Record<FaceExpression, FacePose> = {
  idle: { ...REST },
  listening: {
    ...REST,
    eyeOpen: 1,
    brow: 0.62,
    smile: 0.28,
    mouth: 0.06,
    crest: 0.7,
    turret: 0.05,
    blush: 0.22,
    fin: 0.95,
  },
  thinking: {
    ...REST,
    eyeOpen: 0.92,
    brow: 0.28,
    smile: 0.04,
    mouth: 0.03,
    crest: 0.46,
    lookX: 0.62,
    lookY: -0.42,
    turret: 0.7,
    tilt: 0.18,
    blush: 0.08,
    fin: 0.4,
  },
  talking: {
    ...REST,
    eyeOpen: 0.94,
    brow: 0.2,
    smile: 0.34,
    mouth: 0.2,
    crest: 0.55,
    blush: 0.28,
    fin: 0.48,
  },
  happy: {
    ...REST,
    eyeOpen: 0.9,
    brow: 0.46,
    smile: 0.92,
    mouth: 0.16,
    crest: 0.74,
    blush: 0.7,
    fin: 0.58,
  },
  surprised: {
    ...REST,
    eyeOpen: 1,
    brow: 0.95,
    smile: 0.08,
    mouth: 0.78,
    crest: 0.92,
    turret: 0.02,
    blush: 0.35,
    fin: 0.7,
  },
  sad: {
    ...REST,
    eyeOpen: 0.7,
    brow: -0.82,
    smile: -0.86,
    mouth: 0.04,
    crest: 0.12,
    lookY: 0.38,
    turret: 0.04,
    tilt: -0.12,
    blush: 0.05,
    fin: 0.1,
  },
  excited: {
    ...REST,
    eyeOpen: 1,
    brow: 0.72,
    smile: 0.98,
    mouth: 0.3,
    crest: 1,
    blush: 0.62,
    fin: 1,
    tilt: 0.08,
  },
  sleepy: {
    ...REST,
    eyeOpen: 0.32,
    brow: -0.28,
    smile: 0.1,
    mouth: 0.05,
    crest: 0.08,
    lookY: 0.28,
    turret: 0.02,
    blush: 0.08,
    fin: 0.06,
  },
};

/** Determined, not a grin. Angry shares the battle-ready expression with a tighter mouth. */
const ANGRY: FacePose = {
  ...POSE.excited,
  eyeOpen: 0.9,
  brow: -0.5,
  smile: -0.12,
  mouth: 0.1,
  crest: 1,
  blush: 0.12,
  fin: 0.92,
  tilt: -0.08,
};

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/**
 * Map one envelope sample to a mouth opening.
 * Speech RMS usually sits well below 1, so 0.12 RMS is already "open".
 * Null when there is no sample for this instant (the mouth then uses time).
 */
export function mouthFromEnvelope(
  envelope: readonly number[] | null | undefined,
  talkStart: number,
  now: number,
): number | null {
  if (!envelope || envelope.length === 0 || !(talkStart > 0)) return null;
  const index = Math.floor((now - talkStart) / ENVELOPE_HOP_MS);
  if (index < 0 || index >= envelope.length) return null;
  const rms = envelope[index] ?? 0;
  if (!Number.isFinite(rms)) return null;
  return clamp(rms / 0.12, 0, 1);
}

/** A stand-in jaw when the wav has no envelope yet. */
export function timedMouth(tMs: number): number {
  const t = Number.isFinite(tMs) ? tMs : 0;
  const wobble = Math.abs(Math.sin(t / 90));
  const flap = Math.abs(Math.sin(t / 170));
  return clamp(0.12 + wobble * 0.62 * (0.6 + 0.4 * flap), 0, 1);
}

/**
 * 1 open, 0 shut. One blink about every 3.4 s.
 * Reduced motion stays open so the lids do not flash.
 */
export function blinkAmount(tMs: number, reduceMotion: boolean): number {
  if (reduceMotion) return 1;
  const period = 3400;
  const phase = ((tMs % period) + period) % period;
  const start = 2400;
  const dur = 150;
  if (phase < start || phase > start + dur) return 1;
  const u = (phase - start) / dur;
  return 1 - Math.sin(u * Math.PI);
}

function withLife(pose: FacePose, expression: FaceExpression, tMs: number, reduceMotion: boolean): FacePose {
  if (reduceMotion) return { ...pose, breath: 0 };
  const next = { ...pose };
  next.breath = Math.sin(tMs / 980) * (expression === "sleepy" ? 0.45 : 1);
  if (expression === "idle") {
    next.lookX = Math.sin(tMs / 1700) * 0.28;
    next.lookY = Math.sin(tMs / 2300) * 0.1;
    next.turret = 0.12 + Math.sin(tMs / 2600) * 0.08;
  } else if (expression === "happy") {
    next.lookX = Math.sin(tMs / 1700) * 0.1;
  } else if (expression === "thinking") {
    next.turret = 0.55 + Math.sin(tMs / 800) * 0.22;
  } else if (expression === "excited") {
    next.tilt = Math.sin(tMs / 280) * 0.32;
  } else if (expression === "listening") {
    next.fin = 0.78 + Math.sin(tMs / 520) * 0.12;
  }
  return next;
}

export function poseFor(
  read: FaceRead,
  tMs: number,
  amplitude: number | null,
  reduceMotion: boolean,
): FacePose {
  const t = Number.isFinite(tMs) ? tMs : 0;
  let pose = { ...POSE[read.expression] };
  if (read.expression === "talking") {
    const tint = talkingTint(read.mood);
    if (tint) pose = { ...POSE[tint], mouth: pose.mouth };
    if (read.mood === "angry") pose = { ...ANGRY };
    pose.mouth = amplitude == null ? timedMouth(t) : clamp(0.06 + amplitude * 0.94, 0, 1);
  } else if (read.mood === "angry" && read.expression === "excited") {
    pose = { ...ANGRY };
  }
  return withLife(pose, read.expression, t, reduceMotion);
}

function talkingTint(mood: FaceMood | null): FaceExpression | null {
  if (!mood || mood === "angry" || mood === "neutral") return null;
  if (mood === "sleepy") return "sleepy";
  if (mood === "happy") return "happy";
  if (mood === "sad") return "sad";
  if (mood === "surprised") return "surprised";
  if (mood === "excited" || mood === "battle") return "excited";
  if (mood === "thinking") return "thinking";
  if (mood === "listening") return "listening";
  return null;
}

const LERP_KEYS = [
  "eyeOpen",
  "brow",
  "smile",
  "crest",
  "lookX",
  "lookY",
  "turret",
  "tilt",
  "blush",
  "fin",
  "breath",
] as const;

/** Ease toward `to`. The mouth uses its own factor so speech stays quick. */
export function lerpPose(from: FacePose, to: FacePose, rest: number, mouth: number): FacePose {
  const out: FacePose = { ...to };
  const restK = clamp(rest, 0, 1);
  const mouthK = clamp(mouth, 0, 1);
  for (const key of LERP_KEYS) {
    out[key] = from[key] + (to[key] - from[key]) * restK;
  }
  out.mouth = from.mouth + (to.mouth - from.mouth) * mouthK;
  return out;
}
