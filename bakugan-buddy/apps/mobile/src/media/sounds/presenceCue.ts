import type { PreyasBodyState } from "../../face/bodyState.ts";
import type { CueId } from "./cues.ts";

/** One quiet cue per meaningful transition; resting is intentionally silent. */
export function cueForBodyState(state: PreyasBodyState): CueId | null {
  switch (state) {
    case "listening":
      return "pop-open";
    case "thinking":
    case "working":
      return "hmm";
    case "speaking":
      return "whoop";
    case "resting":
    default:
      return null;
  }
}
