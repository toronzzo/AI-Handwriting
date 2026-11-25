/**
 * What Preyas is really doing right now, shared across the whole app.
 *
 * The body told the truth only where the chat screen could see it. On Today, or
 * while a reply kept streaming with another tab open, the same ball said
 * "resting" because nothing told it otherwise. This is the one place that answer
 * lives, so every surface can read the same honest state.
 *
 * Only the chat screen publishes, because it is the only thing that knows the
 * mic is open, a reply is arriving, a search or a document read is running, or
 * his voice is playing. Everything else subscribes. No timers and no invented
 * activity: when nothing is happening the store says resting, and the publisher
 * says so again when the chat screen goes away.
 *
 * Same tiny shape as screens/chatFlight.ts: a Set of listeners plus one value,
 * pure and testable under node, no React and no react-native import.
 */
import type { PreyasBodyState } from "../face/bodyState.ts";

export type ActivitySignals = {
  /** The tap-to-talk mic is recording. */
  recording: boolean;
  /** His voice is playing. */
  speaking: boolean;
  /** A tool step, a search or a document read is running. */
  working: boolean;
  /** The model is writing, or a request is in flight. */
  thinking: boolean;
};

type Listener = (state: PreyasBodyState) => void;

const listeners = new Set<Listener>();
let current: PreyasBodyState = "resting";

/**
 * The one priority order, and why it is this order: the mic outranks everything
 * (he was interrupted and is listening again), his own voice outranks new work,
 * visible work (searching, reading, tools) outranks quiet thinking, and nothing
 * at all is resting.
 */
export function bodyStateFromSignals(signals: Partial<ActivitySignals>): PreyasBodyState {
  if (signals.recording) return "listening";
  if (signals.speaking) return "speaking";
  if (signals.working) return "working";
  if (signals.thinking) return "thinking";
  return "resting";
}

export function publishActivity(state: PreyasBodyState): void {
  if (state === current) return;
  current = state;
  for (const listener of [...listeners]) listener(state);
}

export function subscribeActivity(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function peekActivity(): PreyasBodyState {
  return current;
}

/** Back to resting: the chat screen went away, or the run ended. */
export function clearActivity(): void {
  publishActivity("resting");
}

/** True when the state says something is happening that you asked for. */
export function activityIsActive(state: PreyasBodyState): boolean {
  return state !== "resting";
}
