/**
 * The bundled Tier-0 WAVs as Metro asset ids (expo-audio AudioSource).
 *
 * assets/sounds/*.wav are generated, original files: see
 * assets/sounds/SFX_CREDITS.md for how each one is made and what it may be
 * used for. Metro turns each require() into a numeric asset id that
 * expo-audio plays straight from the bundle, so playback needs no network,
 * no download and no new dependency.
 *
 * src/media/sounds/wav.d.ts teaches TypeScript what a "*.wav" import is.
 */
import type { Cue } from "./cues.ts";

import popOpen from "../../../assets/sounds/pop-open.wav";
import laugh from "../../../assets/sounds/laugh.wav";
import gasp from "../../../assets/sounds/gasp.wav";
import hmm from "../../../assets/sounds/hmm.wav";
import whoop from "../../../assets/sounds/whoop.wav";
import droop from "../../../assets/sounds/droop.wav";

/** Every cue's asset id, keyed by cue id. */
export const CUE_SOURCES: Record<Cue["id"], number> = {
  "pop-open": popOpen,
  laugh,
  gasp,
  hmm,
  whoop,
  droop,
};
