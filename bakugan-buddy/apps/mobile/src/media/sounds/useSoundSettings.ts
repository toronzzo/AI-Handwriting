/**
 * The "Sounds" switch, shared by the Settings row and the dev preview.
 *
 * Same shape as bits/useBitMode.ts: one saved value, one in-memory listener
 * set so every mounted reader flips at once, and a localStorage event for
 * another tab. Turning it off stops any cue that is still playing, which is
 * the "stop playback when the toggle is disabled" rule in one place.
 */
import { useEffect, useState } from "react";
import { readSoundSettings, SOUND_SETTINGS_KEY, writeSoundSettings } from "./soundSettings.ts";

type Listener = (on: boolean) => void;
const listeners = new Set<Listener>();

/** Read the saved switch. OFF when nothing is saved or the value is unreadable. */
export function readSoundsOn(): boolean {
  return readSoundSettings().sounds;
}

/**
 * Save the switch and tell every mounted reader at once.
 *
 * `stop` is passed in by the caller rather than imported here, so this hook
 * stays free of expo-audio (and of the platform split) while still stopping
 * playback the moment the user switches sounds off.
 */
export function writeSoundsOn(on: boolean, stop: () => void = () => {}): void {
  writeSoundSettings({ sounds: on });
  if (!on) {
    try {
      stop();
    } catch {
      /* a stopped sound never raises */
    }
  }
  for (const listener of listeners) listener(on);
}

/** [isOn, set] for the Settings row and the preview. */
export function useSoundSettings(stop: () => void): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState<boolean>(() => readSoundsOn());
  useEffect(() => {
    const listener: Listener = (next) => setOn(next);
    listeners.add(listener);
    const onStorage = (event: StorageEvent) => {
      if (event.key === SOUND_SETTINGS_KEY) setOn(readSoundsOn());
    };
    const win = typeof window !== "undefined" ? window : null;
    win?.addEventListener("storage", onStorage);
    return () => {
      listeners.delete(listener);
      win?.removeEventListener("storage", onStorage);
    };
  }, []);
  return [on, (next: boolean) => writeSoundsOn(next, stop)];
}
