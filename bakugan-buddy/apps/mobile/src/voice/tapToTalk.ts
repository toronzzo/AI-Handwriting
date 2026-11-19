/**
 * Tap-to-talk (slice V1): the small state machine behind the composer mic.
 *
 * The flow is: tap the mic -> recording (with a mm:ss timer) -> tap again (or
 * the 60 second auto-stop) -> the wav goes to the brain's /v1/stt -> the heard
 * text lands in the message box so the user can read it and fix it. Nothing is
 * ever sent without the user pressing Send unless the "Send voice right away"
 * switch is ON.
 *
 * Pure TypeScript: no react-native import and no enums, so it runs under
 * `node --test` and is easy to reason about apart from the microphone.
 */

/** idle: nothing happening. recording: the mic is open. transcribing: waiting for text. */
export type TapPhase = "idle" | "recording" | "transcribing";

/** The whole flow, as data. Times are epoch milliseconds. */
export type TapState = {
  phase: TapPhase;
  /** When recording started (0 when not recording). */
  startedAt: number;
};

/** A recording never runs longer than this; it stops itself. */
export const AUTO_STOP_MS = 60_000;

/** Shown while the brain turns the wav into words. */
export const TRANSCRIBING_LABEL = "Turning speech into text…";

/** Shown when the brain heard nothing usable. */
export const HEARD_NOTHING_LABEL = "I didn't catch that — try again";

/** One calm line, only after the browser actually refused the microphone. */
export const MIC_DENIED_LABEL =
  "Preyas can't use the microphone. Allow it for this page: tap the mic icon beside the address bar, choose Allow, then tap the mic again.";

export function idleTapState(): TapState {
  return { phase: "idle", startedAt: 0 };
}

/** What a tap on the mic should do right now. */
export type TapAction = "start" | "stop" | "wait";

/**
 * The mic button's one job: idle starts a recording, recording stops and
 * transcribes, transcribing waits (a second tap must not open the mic again).
 */
export function tapAction(state: TapState): TapAction {
  if (state.phase === "idle") return "start";
  if (state.phase === "recording") return "stop";
  return "wait";
}

export function startRecording(now: number): TapState {
  return { phase: "recording", startedAt: now };
}

export function startTranscribing(): TapState {
  return { phase: "transcribing", startedAt: 0 };
}

/** Whatever happened (words, silence, an error) the mic goes back to idle. */
export function finishTranscribing(): TapState {
  return idleTapState();
}

/** How long the current recording has been running; never negative. */
export function recordedMs(state: TapState, now: number): number {
  if (state.phase !== "recording") return 0;
  const elapsed = now - state.startedAt;
  return elapsed > 0 ? elapsed : 0;
}

/** True once the 60 second limit is reached, so the caller stops recording. */
export function shouldAutoStop(state: TapState, now: number): boolean {
  return state.phase === "recording" && recordedMs(state, now) >= AUTO_STOP_MS;
}

/** The recording timer: 0:00, 0:07, 1:00 (never longer than the limit). */
export function formatClock(ms: number): string {
  const safe = Number.isFinite(ms) && ms > 0 ? ms : 0;
  const capped = safe > AUTO_STOP_MS ? AUTO_STOP_MS : safe;
  const total = Math.floor(capped / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds < 10 ? "0" : ""}${seconds}`;
}

/**
 * The "Send voice right away" switch. OFF by default; when ON the heard text
 * is sent as the user's message straight after transcription.
 */
export function shouldAutoSend(autoSendOn: boolean, heard: string): boolean {
  return autoSendOn === true && heard.trim().length > 0;
}

/**
 * Keep the message box exactly as it was when nothing was heard. When words
 * arrive they replace the box (a placeholder is not real text).
 */
export function boxAfterTranscription(heard: string, current: string): { text: string; changed: boolean } {
  const text = heard.trim();
  if (!text) return { text: current, changed: false };
  return { text, changed: true };
}

/**
 * Esc and the ✕ button throw the recording away. They never touch a finished
 * transcription: by then the audio is already gone and is not sent.
 */
export function cancelsRecording(state: TapState): boolean {
  return state.phase === "recording";
}
