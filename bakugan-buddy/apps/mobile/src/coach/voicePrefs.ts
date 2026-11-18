/**
 * Voice preferences for the coach, stored in localStorage under
 * "preyas.coach.voice". Default: read-aloud OFF.
 */

export type VoicePrefs = { readAloud: boolean };

const KEY = "preyas.coach.voice";

export function readVoicePrefs(): VoicePrefs {
  try {
    if (typeof localStorage === "undefined") return { readAloud: false };
    const raw = localStorage.getItem(KEY);
    if (!raw) return { readAloud: false };
    const parsed = JSON.parse(raw);
    return { readAloud: parsed && parsed.readAloud === true };
  } catch {
    return { readAloud: false };
  }
}

export function writeVoicePrefs(prefs: VoicePrefs): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* best effort */
  }
}
