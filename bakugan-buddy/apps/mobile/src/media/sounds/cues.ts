/**
 * Preyas Tier-0 reaction cues (slice M4, Earshot plan phase 0).
 *
 * The predefined set of short, non-verbal reaction sounds from the product
 * plan: docs/PREYAS_FROM_ANIME.md §3 "Reaction bank" (laugh / gasp / growl)
 * and §4 "Tier 0 - reactions" (laughs, gasps, "hmm", battle whoops). Six
 * cues, one per reaction the ball's body language already shows, so a sound
 * never fires without a visible state change beside it.
 *
 * This file is data and pure functions only: no react-native, no expo-audio
 * and no JSX, so node --test can load it without node_modules. The WAV files
 * live in assets/sounds/ and are listed in assets/sounds/SFX_CREDITS.md.
 */

/** The six Tier-0 cue ids. Anything else is not a cue. */
export type CueId = "pop-open" | "laugh" | "gasp" | "hmm" | "whoop" | "droop";

/** A cue file name; the assets are assets/sounds/<file>.wav. */
export type CueFile = string;

export type Cue = {
  /** Stable id used by playCue() and the preview screen. */
  id: CueId;
  /** Short name shown in the dev-only preview. */
  label: string;
  /** The ball mood that fires this cue (PREYAS_FROM_ANIME §3). */
  mood: "excited" | "happy" | "curious" | "thinking" | "battle" | "sad";
  /** Bundled WAV file name, without the folder (assets/sounds/<file>). */
  file: CueFile;
  /** A one-line description for the preview screen and credits. */
  what: string;
};

/**
 * The whole Tier-0 bank. Kept small on purpose: one cue per mood that has a
 * body reaction, no ambience, no music and no speech.
 */
export const TIER0_CUES: readonly Cue[] = [
  { id: "pop-open", label: "Pop open", mood: "excited", file: "pop-open", what: "A short snap open when Preyas wakes." },
  { id: "laugh", label: "Laugh", mood: "happy", file: "laugh", what: "A soft giggle for a happy line." },
  { id: "gasp", label: "Gasp", mood: "curious", file: "gasp", what: "A quick breath for surprise." },
  { id: "hmm", label: "Hmm", mood: "thinking", file: "hmm", what: "A quiet hum while the brain thinks." },
  { id: "whoop", label: "Whoop", mood: "battle", file: "whoop", what: "One small battle cheer, no words." },
  { id: "droop", label: "Droop", mood: "sad", file: "droop", what: "A low sigh when a moment is sad." },
] as const;

/** Every cue id, in bank order. */
export const CUE_IDS: readonly CueId[] = TIER0_CUES.map((cue) => cue.id);

/**
 * The 3 s window (media plan A.2/A.6): a second cue inside this many
 * milliseconds of the last one is suppressed instead of playing over it.
 */
export const CUE_WINDOW_MS = 3000;

/**
 * The cues are deliberately quiet. 0.35 keeps a short effect well under the
 * voice and behind the rest of the phone, and the cap below stops a stray
 * value from ever getting loud.
 */
export const CUE_VOLUME = 0.35;
export const MAX_CUE_VOLUME = 1;

/** Longest a single cue may hold the speaker; a stale timer can never stick. */
export const CUE_MAX_MS = 3000;

/** True when `id` is one of the predefined Tier-0 cues. */
export function isCueId(id: unknown): id is CueId {
  return typeof id === "string" && (CUE_IDS as readonly string[]).includes(id);
}

/** The cue by id, or null for anything that is not a Tier-0 cue. */
export function cueById(id: unknown): Cue | null {
  return isCueId(id) ? (TIER0_CUES.find((cue) => cue.id === id) ?? null) : null;
}

/** The cue that belongs to a ball mood, or null when the mood has none. */
export function cueForMood(mood: string): Cue | null {
  return TIER0_CUES.find((cue) => cue.mood === mood) ?? null;
}

/** Every WAV file the bank needs, in bank order. */
export const CUE_FILES: readonly CueFile[] = TIER0_CUES.map((cue) => cue.file);

/** A volume that is always safe: finite, positive and never above the cap. */
export function clampVolume(volume: number): number {
  if (!Number.isFinite(volume) || volume <= 0) return 0;
  return Math.min(MAX_CUE_VOLUME, volume);
}
