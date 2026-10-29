import type { Mood } from "../../../mood/src/index.ts";

/**
 * Five ball-form idle sets. Shell angle, bob, roll, hop, and tilt are body
 * language — there is no face. Other canonical moods map onto these five
 * so the app keeps the vocabulary in `@bakugan-buddy/mood`.
 *
 * `battle` stays on the excited set. Popping into the big creature is a
 * battle-only transform and is out of scope for the room.
 */
export const BALL_MOODS = ["neutral", "happy", "excited", "sad", "angry"] as const;
export type BallMood = (typeof BALL_MOODS)[number];

export type IdleSet = {
  bobHz: number;
  bobAmp: number;
  /** 0 = shut, 1 = the largest procedural flutter we allow on top of a clip. */
  flap: number;
  rollHz: number;
  rollAmp: number;
  hopHz: number;
  hopAmp: number;
  /** -1 droop, +1 lean in. Scaled by POSE_LIMITS.headTiltMax. */
  headTilt: number;
  eye: number;
};

export const IDLE_SETS: Record<BallMood, IdleSet> = {
  neutral: {
    bobHz: 0.45,
    bobAmp: 0.018,
    flap: 0.08,
    rollHz: 0.28,
    rollAmp: 0.035,
    hopHz: 0,
    hopAmp: 0,
    headTilt: 0,
    eye: 0.42,
  },
  happy: {
    bobHz: 1.15,
    bobAmp: 0.028,
    flap: 0.4,
    rollHz: 0.55,
    rollAmp: 0.05,
    hopHz: 1.45,
    hopAmp: 0.05,
    headTilt: 0.2,
    eye: 0.92,
  },
  excited: {
    bobHz: 1.8,
    bobAmp: 0.032,
    flap: 1,
    rollHz: 0.9,
    rollAmp: 0.06,
    hopHz: 2.3,
    hopAmp: 0.065,
    headTilt: 0.35,
    eye: 1,
  },
  sad: {
    bobHz: 0.26,
    bobAmp: 0.01,
    flap: 0,
    rollHz: 0.16,
    rollAmp: 0.018,
    hopHz: 0,
    hopAmp: 0,
    headTilt: -1,
    eye: 0.16,
  },
  angry: {
    bobHz: 3.4,
    bobAmp: 0.016,
    flap: 0.62,
    rollHz: 7.5,
    rollAmp: 0.045,
    hopHz: 0,
    hopAmp: 0,
    headTilt: 0.75,
    eye: 0.88,
  },
};

export const CANONICAL_TO_BALL: Record<Mood, BallMood> = {
  neutral: "neutral",
  happy: "happy",
  excited: "excited",
  angry: "angry",
  sad: "sad",
  surprised: "excited",
  thinking: "neutral",
  listening: "neutral",
  battle: "excited",
};

/** Extra tilt so thinking and listening are not the same stance as neutral. */
export const HEAD_TILT_BIAS: Partial<Record<Mood, number>> = {
  thinking: -0.65,
  listening: 0.5,
  surprised: 0.4,
  battle: 0.45,
};
