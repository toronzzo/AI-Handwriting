/**
 * Focus quest timer state machine (slice 8).
 *
 * Pure and timestamp-based: no React, no timers inside. Every running state
 * stores its own deadline, so the clock — never interval counting — decides
 * where the timer is. A hidden tab that ticks again much later catches up on
 * the next tick and still completes exactly once.
 */

/** One 5 minute break after every finished focus quest. */
export const BREAK_MS = 5 * 60_000;

/** The timer states: waiting, counting down, frozen, or on the break. */
export type FocusTimerState =
  | { mode: "idle" }
  | { mode: "run"; minutes: number; endAt: number }
  | { mode: "pause"; minutes: number; remaining: number }
  | { mode: "break"; endAt: number };

/** Begin (or restart) a focus quest of `minutes` minutes. */
export function start(minutes: number, now: number): FocusTimerState {
  return { mode: "run", minutes, endAt: now + minutes * 60_000 };
}

/** Freeze a running quest; keeps the time still on the clock. */
export function pause(state: FocusTimerState, now: number): FocusTimerState {
  if (state.mode !== "run") return state;
  return { mode: "pause", minutes: state.minutes, remaining: Math.max(0, state.endAt - now) };
}

/** Continue a frozen quest from where it stopped. */
export function resume(state: FocusTimerState, now: number): FocusTimerState {
  if (state.mode !== "pause") return state;
  return { mode: "run", minutes: state.minutes, endAt: now + state.remaining };
}

/** Back to the start: nothing running, nothing kept. */
export function reset(): FocusTimerState {
  return { mode: "idle" };
}

/** Milliseconds still on the clock, never negative. */
export function remainingMs(state: FocusTimerState, now: number): number {
  switch (state.mode) {
    case "run":
      return Math.max(0, state.endAt - now);
    case "pause":
      return state.remaining;
    case "break":
      return Math.max(0, state.endAt - now);
    case "idle":
      return 0;
  }
}

/** What one tick decided: the next state plus the completion report. */
export type FocusTick = {
  state: FocusTimerState;
  /** Minutes of the quest that just finished on this tick, else null. */
  completed: number | null;
};

/**
 * Advance the machine by the clock. A run that reached its end moves to the
 * 5 minute break anchored to the run's own end time, and that transition
 * reports `completed` with the minutes done — once, because the next state
 * is the break. A break that reached its end goes idle.
 */
export function tick(state: FocusTimerState, now: number): FocusTick {
  if (state.mode === "run" && now >= state.endAt) {
    return {
      state: { mode: "break", endAt: state.endAt + BREAK_MS },
      completed: state.minutes,
    };
  }
  if (state.mode === "break" && now >= state.endAt) {
    return { state: { mode: "idle" }, completed: null };
  }
  return { state, completed: null };
}
