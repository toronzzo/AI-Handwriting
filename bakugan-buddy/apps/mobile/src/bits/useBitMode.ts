/**
 * The "8-bit look" switch (slice 8A). OFF by default.
 *
 * Saved with the same local storage method the coach voice preference uses
 * (localStorage under a "preyas.*" key on the web); there is no new
 * dependency and nothing is sent to the Mac. Every part of the app that shows
 * Preyas reads the switch through `useBitMode()`, so one tap in Settings swaps
 * the 3D ball for the pixel sprite everywhere at once.
 */
import { useEffect, useState } from "react";

export const BIT_MODE_KEY = "preyas.bits";

type Listener = (on: boolean) => void;
const listeners = new Set<Listener>();

/** Small storage shim: localStorage on the web, nothing elsewhere. */
function storage(): Storage | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

/** Read the saved switch. OFF when nothing is saved or the value is unreadable. */
export function readBitMode(): boolean {
  try {
    return storage()?.getItem(BIT_MODE_KEY) === "1";
  } catch {
    return false;
  }
}

/** Save the switch and tell every mounted PixelSprite/hero spot at once. */
export function writeBitMode(on: boolean): void {
  try {
    storage()?.setItem(BIT_MODE_KEY, on ? "1" : "0");
  } catch {
    /* best effort, like the coach voice preference */
  }
  for (const listener of listeners) listener(on);
}

/** The switch, kept in sync across every component that reads it. */
export function useBitMode(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState<boolean>(() => readBitMode());
  useEffect(() => {
    const listener: Listener = (next) => setOn(next);
    listeners.add(listener);
    // Another tab may have changed it.
    const onStorage = (event: StorageEvent) => {
      if (event.key === BIT_MODE_KEY) setOn(readBitMode());
    };
    const win = typeof window !== "undefined" ? window : null;
    win?.addEventListener("storage", onStorage);
    return () => {
      listeners.delete(listener);
      win?.removeEventListener("storage", onStorage);
    };
  }, []);
  return [on, writeBitMode];
}
