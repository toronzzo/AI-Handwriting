/**
 * playCue() on the iPhone and Android (media plan A.2, one file per platform).
 *
 * Same rules as the web file; only "is the page hidden?" differs: on the phone
 * that is React Native's AppState, so a cue never rings from the background,
 * and a cue still playing when the app leaves the foreground is stopped.
 */
import { AppState } from "react-native";
import { ensureCueAudioMode } from "./audioMode.ts";
import { createPlatformCueSession, openCuePlayer } from "./cueAudio.ts";
import type { CueResult, CueSession } from "./cueSession.ts";

export { openCuePlayer };

/** True while the app is not the active foreground app. */
function appHidden(): boolean {
  try {
    return AppState.currentState !== "active";
  } catch {
    return false;
  }
}

let session: CueSession | null = null;

/** The app-wide session, created on first use. */
export function cueSession(): CueSession {
  if (!session) session = createPlatformCueSession(appHidden, () => false);
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
