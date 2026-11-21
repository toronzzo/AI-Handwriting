/**
 * The cues' audio behaviour, set once (media plan A.2 audioMode.ts).
 *
 * "mixWithOthers" is deliberate: a reaction sound is UI feedback, not media.
 * It sits under whatever the user is already listening to (music, a podcast,
 * Preyas's own voice) and never pauses it, and it never forces the phone out
 * of silent mode. The silent switch stays the user's decision.
 *
 * "allowsRecording: false" hands the audio session back after a voice turn:
 * expo-audio's microphone preset turns recording on, and this turns it off
 * again so a cue can play while Preyas talks without holding the recorder.
 *
 * Any failure here is silent: a missing mixing call must never stop a cue
 * from being skipped cleanly, and it never throws into the caller.
 */
import { setAudioModeAsync } from "expo-audio";

/** True once the mode is set, so repeat calls are cheap. */
let applied = false;

/** Play the phone's other audio at the same time; respect the silent switch. */
export async function ensureCueAudioMode(): Promise<boolean> {
  if (applied) return true;
  try {
    await setAudioModeAsync({
      interruptionMode: "mixWithOthers",
      playsInSilentMode: false,
      allowsRecording: false,
      shouldPlayInBackground: false,
      shouldRouteThroughEarpiece: false,
    });
    applied = true;
    return true;
  } catch {
    return false;
  }
}

/** Forget the cached call (used by tests and after a failed set). */
export function resetCueAudioMode(): void {
  applied = false;
}
