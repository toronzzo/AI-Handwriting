/**
 * What Preyas's 3D body is doing, in words a person can read.
 *
 * The expression engine (face/expression.ts) already decides what is really
 * happening: the mic is recording, a reply is still arriving, his voice is
 * playing, otherwise the last reply's mood. This module turns that one answer
 * into the body's own vocabulary, so every place the ball appears moves and
 * glows the same way — and never in a way that invents activity.
 *
 * Four states, because the kit has four honest things to say:
 *   resting  - nothing is happening right now
 *   listening - the mic is open and he is taking in what you say
 *   thinking - a reply, a search or a document read is in flight
 *   speaking - his voice is playing
 *
 * Pure data and pure functions: no React, no react-native, no three, so it
 * runs under node --test and the lazy-3D guard keeps the scene behind it.
 */
import type { FaceExpression } from "./expression.ts";

export const BODY_STATES = ["resting", "listening", "thinking", "speaking"] as const;

export type PreyasBodyState = (typeof BODY_STATES)[number];

/** The exact sentence a screen reader hears. It states the truth, not a mood. */
export const BODY_LABEL: Record<PreyasBodyState, string> = {
  resting: "Preyas is here, resting",
  listening: "Preyas is listening",
  thinking: "Preyas is thinking",
  speaking: "Preyas is speaking",
};

/**
 * The halo the ball stands on: how bright it is, how big it is, and how fast it
 * breathes. Brightness and size carry the state even when motion is off, which
 * is what reduced-motion and colour-blind readers still get.
 */
export type BodyHalo = {
  /** 0..1 opacity of the ring. */
  strength: number;
  /** Radius in scene units; the resting ring is the smallest. */
  radius: number;
  /** Seconds for one breath. 0 means steady: no pulse at all. */
  pulseSeconds: number;
};

export type BodyMotion = {
  /** Radians per second of the slow spin. */
  spin: number;
  /** Height of the happy bob, in scene units. Speaking gets it. */
  bob: number;
  /** Sideways wobble while thinking, in radians. */
  wobble: number;
};

const HALO: Record<PreyasBodyState, BodyHalo> = {
  resting: { strength: 0.34, radius: 0.9, pulseSeconds: 0 },
  listening: { strength: 0.58, radius: 1.02, pulseSeconds: 1.6 },
  thinking: { strength: 0.72, radius: 0.96, pulseSeconds: 0.9 },
  speaking: { strength: 0.92, radius: 1.1, pulseSeconds: 0.45 },
};

const MOTION: Record<PreyasBodyState, BodyMotion> = {
  resting: { spin: 0.28, bob: 0, wobble: 0 },
  listening: { spin: 0.16, bob: 0, wobble: 0 },
  thinking: { spin: 0.34, bob: 0, wobble: 0.05 },
  speaking: { spin: 0.85, bob: 0.05, wobble: 0 },
};

/** Which expression belongs to which body state. Activity beats mood. */
export function bodyStateFor(expression: FaceExpression): PreyasBodyState {
  if (expression === "listening") return "listening";
  if (expression === "thinking") return "thinking";
  if (expression === "talking") return "speaking";
  // Every feeling (happy, sad, surprised, excited, sleepy, idle) is a way of
  // being at rest: the shell still holds its own clip, nothing is happening.
  return "resting";
}

/** The halo for a state; with reduced motion the pulse is dropped, never the size. */
export function haloFor(state: PreyasBodyState, reduce = false): BodyHalo {
  const halo = HALO[state];
  return reduce ? { ...halo, pulseSeconds: 0 } : halo;
}

/** The motion for a state; reduced motion means a still ball, as it always did. */
export function motionFor(state: PreyasBodyState, reduce = false): BodyMotion {
  if (reduce) return { spin: 0, bob: 0, wobble: 0 };
  return MOTION[state];
}

/** True while the state says Preyas is doing something you asked for. */
export function bodyIsActive(state: PreyasBodyState): boolean {
  return state !== "resting";
}
