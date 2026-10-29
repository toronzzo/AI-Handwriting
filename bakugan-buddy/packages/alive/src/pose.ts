import { normalizeMood, type Mood } from "../../mood/src/index.ts";
import { CANONICAL_TO_BALL, HEAD_TILT_BIAS, IDLE_SETS } from "./data/moodIdles.ts";
import type { ClipName, SkillId } from "./types.ts";
import { POSE_LIMITS } from "./tuning.ts";

export type PoseSample = {
  bob: number;
  hop: number;
  roll: number;
  flap: number;
  headTilt: number;
  eye: number;
};

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/**
 * Procedural offsets for one mood at time `timeSec`. Bob and hop stay
 * at or above zero so the shell does not sink through the floor.
 * Flap is a few degrees on top of the clip, and zero while the closed clip plays.
 */
export function sampleIdle(mood: Mood, timeSec: number, clip: ClipName, out: PoseSample): void {
  const canon = normalizeMood(mood);
  const set = IDLE_SETS[CANONICAL_TO_BALL[canon]];
  const bobAmp = set.bobAmp > POSE_LIMITS.bobMax ? POSE_LIMITS.bobMax : set.bobAmp;
  out.bob = (0.5 + 0.5 * Math.sin(timeSec * set.bobHz * Math.PI * 2)) * bobAmp;
  if (set.hopHz > 0) {
    const hop = Math.sin(timeSec * set.hopHz * Math.PI * 2);
    const amp = set.hopAmp > POSE_LIMITS.hopMax ? POSE_LIMITS.hopMax : set.hopAmp;
    out.hop = hop > 0 ? hop * amp : 0;
  } else {
    out.hop = 0;
  }
  const rollAmp = set.rollAmp > POSE_LIMITS.rollMax ? POSE_LIMITS.rollMax : set.rollAmp;
  out.roll = Math.sin(timeSec * set.rollHz * Math.PI * 2) * rollAmp;
  const flapScale = clip === "happy" ? 0.35 : clip === "closed" ? 0 : 1;
  const flutter = clip === "closed" ? 0 : Math.sin(timeSec * 3.2) * 0.008 * flapScale;
  out.flap = clamp(set.flap * POSE_LIMITS.flapMax * flapScale + flutter, 0, POSE_LIMITS.flapMax);
  const bias = HEAD_TILT_BIAS[canon] ?? set.headTilt;
  out.headTilt = clamp(bias * POSE_LIMITS.headTiltMax, -POSE_LIMITS.headTiltMax, POSE_LIMITS.headTiltMax);
  out.eye = clamp(set.eye, 0, 1);
}

/** Happy and excited play the happy clip. Sleep plays closed. The rest stay on idle. */
export function clipFor(skill: SkillId, mood: Mood): ClipName {
  if (skill === "sleep") return "closed";
  const ball = CANONICAL_TO_BALL[normalizeMood(mood)];
  if (ball === "happy" || ball === "excited") return "happy";
  return "idle";
}
