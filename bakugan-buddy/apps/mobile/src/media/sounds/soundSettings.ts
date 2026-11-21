/**
 * The one "Sounds" switch for Preyas reaction sounds (media plan A.2/A.6).
 *
 * Saved locally with the same method voiceSettings.ts uses: a "preyas.*" key
 * in localStorage on the web and nothing on the Mac, so no new dependency
 * and no new server storage. The whole app reads it through the same module,
 * so one tap in Settings takes effect at once.
 *
 * OFF by default: the other small switches in this app (voiceSettings.ts,
 * useBitMode.ts) all start off, and a companion that suddenly makes noise is
 * worse than one the user switched on.
 */
export type StorageLike = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
};

export type SoundSettings = {
  /** "Sounds": allowed to play the Tier-0 reaction cues. */
  sounds: boolean;
};

export const SOUND_SETTINGS_KEY = "preyas.sounds";

export const SOUNDS_DEFAULT = false;

const OFF: SoundSettings = { sounds: SOUNDS_DEFAULT };

function storage(): StorageLike | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

/** Read the saved switch. OFF when nothing is saved or the value is unreadable. */
export function readSoundSettings(from: StorageLike | null = storage()): SoundSettings {
  try {
    const raw = from?.getItem(SOUND_SETTINGS_KEY);
    if (!raw) return { ...OFF };
    const parsed = JSON.parse(raw) as Partial<SoundSettings> | null;
    if (!parsed || typeof parsed !== "object") return { ...OFF };
    // Only a real boolean true switches it on; "yes", 1 and missing all stay off.
    return { sounds: parsed.sounds === true };
  } catch {
    return { ...OFF };
  }
}

/** Save the switch. A storage failure is silent, like the other small settings. */
export function writeSoundSettings(next: SoundSettings, to: StorageLike | null = storage()): SoundSettings {
  const safe: SoundSettings = { sounds: next.sounds === true };
  try {
    to?.setItem(SOUND_SETTINGS_KEY, JSON.stringify(safe));
  } catch {
    /* best effort, like the other small settings */
  }
  return safe;
}

/** Patch the switch and return the new settings. */
export function patchSoundSettings(
  current: SoundSettings,
  patch: Partial<SoundSettings>,
  to: StorageLike | null = storage(),
): SoundSettings {
  return writeSoundSettings({ ...current, ...patch }, to);
}
