/**
 * The two voice switches from slice V1, kept in localStorage under one
 * "preyas.voice" key on the web, exactly like the coach voice preference
 * (src/coach/voicePrefs.ts) and the 8-bit switch. Both default to OFF:
 *
 *   autoSend   "Send voice right away": heard words are sent straight away.
 *   handsFree  "Hands-free listening": the old always-on loop may run.
 *
 * Nothing new is stored on the Mac and there is no new dependency.
 */
export type VoiceSettings = {
  /** "Send voice right away": ON sends the heard text without pressing Send. */
  autoSend: boolean;
  /** "Hands-free listening": the old always-on ear may listen by itself. */
  handsFree: boolean;
};

export const VOICE_SETTINGS_KEY = "preyas.voice";

const OFF: VoiceSettings = { autoSend: false, handsFree: false };

function storage(): StorageLike | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

/** The bit of the browser storage this module needs (so tests can fake it). */
export type StorageLike = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
};

export function readVoiceSettings(from: StorageLike | null = storage()): VoiceSettings {
  try {
    const raw = from?.getItem(VOICE_SETTINGS_KEY);
    if (!raw) return { ...OFF };
    const parsed = JSON.parse(raw) as Partial<VoiceSettings> | null;
    if (!parsed || typeof parsed !== "object") return { ...OFF };
    return { autoSend: parsed.autoSend === true, handsFree: parsed.handsFree === true };
  } catch {
    return { ...OFF };
  }
}

export function writeVoiceSettings(next: VoiceSettings, to: StorageLike | null = storage()): VoiceSettings {
  const safe: VoiceSettings = { autoSend: next.autoSend === true, handsFree: next.handsFree === true };
  try {
    to?.setItem(VOICE_SETTINGS_KEY, JSON.stringify(safe));
  } catch {
    /* best effort, like the other small settings */
  }
  return safe;
}

/** Patch one switch and return the new pair. */
export function patchVoiceSettings(
  current: VoiceSettings,
  patch: Partial<VoiceSettings>,
  to: StorageLike | null = storage(),
): VoiceSettings {
  return writeVoiceSettings({ ...current, ...patch }, to);
}
