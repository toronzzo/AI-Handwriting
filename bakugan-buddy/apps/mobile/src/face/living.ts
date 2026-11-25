/**
 * What Preyas's body does when he feels something.
 *
 * `bodyState.ts` answers what he is *doing* (resting, listening, thinking,
 * working, speaking). This module answers what he *feels* on top of that,
 * so a happy ball is not drawn exactly like a sad one while both are resting.
 *
 * The rule the two files share, and this one exists to keep honest: activity
 * always outranks feeling. A ball that is mid-sentence does not get to look
 * sleepy, and a ball that is listening does not hop about. Feeling only adds
 * pose on top of what is really happening, and the activity's own motion is
 * never replaced by it.
 *
 * Pure numbers, no React and no three: the same answer is used by every surface
 * that draws him, and it can be checked under node --test.
 */
import { motionFor, type PreyasBodyState } from "./bodyState.ts";

/** A pose the scene can apply: amplitudes, not positions. */
export type LivingPose = {
    /** Radians per second of the slow spin. */
    spin: number;
    /** Height of the speaking bob, in scene units. */
    bob: number;
    /** Sideways wobble, in radians. */
    wobble: number;
    /** Forward lean, in radians. Positive droops, negative lifts the chin. */
    tiltX: number;
    /** Steady side tilt, in radians. */
    tiltZ: number;
    /** Height of the feeling's hop, in scene units. */
    hop: number;
};

const STILL: LivingPose = { spin: 0, bob: 0, wobble: 0, tiltX: 0, tiltZ: 0, hop: 0 };

/** What each feeling adds. Anything unknown is neutral. */
const MOOD_POSE: Record<string, Omit<LivingPose, "bob" | "wobble">> = {
  neutral: { spin: 0, tiltX: 0, tiltZ: 0, hop: 0 },
  // Happy and excited lift the chin and hop; excited hops more.
  happy: { spin: 0.34, tiltX: -0.03, tiltZ: 0.02, hop: 0.035 },
  excited: { spin: 0.62, tiltX: -0.05, tiltZ: 0.05, hop: 0.065 },
  // Surprised is the highest hop and a fast sway.
  surprised: { spin: 0.5, tiltX: -0.06, tiltZ: 0.07, hop: 0.07 },
  // Sad and sleepy droop; sleepy droops the most and hardly moves.
  sad: { spin: 0.12, tiltX: 0.09, tiltZ: 0, hop: 0 },
  sleepy: { spin: 0.06, tiltX: 0.14, tiltZ: 0.03, hop: 0 },
  // Battle and angry lean forward and sway; battle is the wider stance.
  battle: { spin: 0.44, tiltX: 0.04, tiltZ: 0.08, hop: 0 },
  angry: { spin: 0.4, tiltX: 0.06, tiltZ: 0.05, hop: 0 },
  // A thinking or listening feeling already has its own body state; these
  // small poses only matter while resting.
  thinking: { spin: 0.3, tiltX: 0.03, tiltZ: 0.02, hop: 0 },
  listening: { spin: 0.16, tiltX: -0.06, tiltZ: 0, hop: 0 },
};

function moodPoseFor(mood?: string | null): Omit<LivingPose, "bob" | "wobble"> {
  if (!mood) return MOOD_POSE.neutral;
  return MOOD_POSE[mood] ?? MOOD_POSE.neutral;
}

/**
 * The pose for a state and a feeling.
 *
 * Activity's motion is the base. A feeling may add pose at any time, but its
 * hop is cut to about a third while something is actually happening, so the
 * speaking bob or the thinking wobble still reads as the main movement.
 * Reduced motion returns a still pose: the state is still carried by the halo
 * and the label, never by movement.
 */
export function livingMotion(
  state: PreyasBodyState,
  mood?: string | null,
  reduce = false,
): LivingPose {
  if (reduce) return STILL;
  const base = motionFor(state, false);
  const moodPose = moodPoseFor(mood);
  const busy = state !== "resting";
  return {
    spin: busy ? base.spin : base.spin + moodPose.spin,
    bob: base.bob,
    wobble: base.wobble + moodPose.tiltZ,
    tiltX: moodPose.tiltX,
    tiltZ: moodPose.tiltZ,
    hop: busy ? moodPose.hop * 0.33 : moodPose.hop,
  };
}

/** True when a feeling is driving the body rather than an activity. */
export function moodLeads(state: PreyasBodyState, mood?: string | null): boolean {
  return state === "resting" && (mood ?? "neutral") !== "neutral";
}
