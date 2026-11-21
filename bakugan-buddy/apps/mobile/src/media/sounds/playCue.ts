/**
 * playCue() on the web (media plan A.2, house pattern: one file per platform).
 *
 * The browser is the phone runtime too (Expo Go serves the web bundle), so
 * this is the file that runs for the user. It owns no policy: every rule
 * lives in cueSession.ts, which the node tests cover.
 *
 * A browser can refuse to start audio before the user has interacted with the
 * page (autoplay policy). When that happens the cue is skipped silently, the
 * existing chat keeps working, and the next tap on any control lets the next
 * cue play. A sound never blocks or fails a UI action.
 */
import { ensureCueAudioMode } from "./audioMode.ts";
import { createPlatformCueSession, openCuePlayer } from "./cueAudio.ts";
import type { CueResult, CueSession } from "./cueSession.ts";

export { openCuePlayer };

/** True while the document is hidden; a hidden tab gets no sound. */
function pageHidden(): boolean {
  try {
    if (typeof document === "undefined") return false;
    return document.visibilityState === "hidden";
  } catch {
    return false;
  }
}

/** The web asks for less motion, so transition cues are skipped. */
function reducedMotion(): boolean {
  try {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

let session: CueSession | null = null;

/** The app-wide session, created on first use. */
export function cueSession(): CueSession {
  if (!session) session = createPlatformCueSession(pageHidden, reducedMotion);
  return session;
}

/** Play one Tier-0 cue. Never throws. */
export function playCue(id: unknown): CueResult {
  return cueSession().play(id);
}

/** Stop whatever cue is playing. */
export function stopCue(): void {
  session?.stop();
}

/** Call once when sounds are on: sets mixing before the first cue. */
export async function warmCues(): Promise<void> {
  await ensureCueAudioMode();
}

export type { CueResult, CueSession };
