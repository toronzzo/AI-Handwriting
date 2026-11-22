/**
 * Saved appearance: Light, Dark, or Auto.
 *
 * Auto follows the device colour scheme. It can also force dark during a
 * local window (20:00–07:00 by default). The choice is stored under
 * `preyas.theme`, the same local key the other small settings use.
 *
 * Pure TypeScript: no React, no enums. Node tests pass a fake store. On the
 * web the store is localStorage. On the phone it is a small file read with
 * the sync file API, so the first paint already has the saved choice.
 */
import { DAY, NIGHT, type Palette } from "./palette.ts";

export type { Palette };

export type ThemeChoice = "light" | "dark" | "auto";

export type ThemeScheme = "day" | "night";

export type ThemePrefs = {
  choice: ThemeChoice;
  /** When choice is auto, also use the dark theme inside the night window. */
  nightByClock: boolean;
  /** "HH:MM", inclusive. */
  nightStart: string;
  /** "HH:MM", exclusive. Overnight when this is earlier than nightStart. */
  nightEnd: string;
};

export type StorageLike = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
};

export const THEME_PREFS_KEY = "preyas.theme";

export const DEFAULT_THEME_PREFS: ThemePrefs = {
  choice: "auto",
  nightByClock: true,
  nightStart: "20:00",
  nightEnd: "07:00",
};

const NATIVE_FILE = "preyas-theme.json";

type Listener = (prefs: ThemePrefs) => void;
const listeners = new Set<Listener>();

/** Minutes from midnight, or null when the string is not HH:MM. */
export function clockMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

/**
 * True when `now` sits in [start, end). A window that crosses midnight
 * (20:00–07:00) is the late evening plus the early morning. A zero-length
 * window, or a clock that will not parse, is never inside.
 */
export function inNightWindow(now: Date, start: string, end: string): boolean {
  const from = clockMinutes(start);
  const to = clockMinutes(end);
  if (from === null || to === null || from === to) return false;
  const minute = now.getHours() * 60 + now.getMinutes();
  if (from < to) return minute >= from && minute < to;
  return minute >= from || minute < to;
}

export function resolveScheme(
  prefs: ThemePrefs,
  ctx: { now: Date; systemDark: boolean },
): ThemeScheme {
  if (prefs.choice === "light") return "day";
  if (prefs.choice === "dark") return "night";
  if (prefs.nightByClock && inNightWindow(ctx.now, prefs.nightStart, prefs.nightEnd)) return "night";
  return ctx.systemDark ? "night" : "day";
}

export function paletteForScheme(scheme: ThemeScheme): Palette {
  return scheme === "night" ? NIGHT : DAY;
}

function sanitize(raw: Partial<ThemePrefs> | null): ThemePrefs {
  const choice =
    raw?.choice === "light" || raw?.choice === "dark" || raw?.choice === "auto"
      ? raw.choice
      : DEFAULT_THEME_PREFS.choice;
  const nightByClock = typeof raw?.nightByClock === "boolean" ? raw.nightByClock : DEFAULT_THEME_PREFS.nightByClock;
  const nightStart =
    typeof raw?.nightStart === "string" && clockMinutes(raw.nightStart) !== null
      ? raw.nightStart
      : DEFAULT_THEME_PREFS.nightStart;
  const nightEnd =
    typeof raw?.nightEnd === "string" && clockMinutes(raw.nightEnd) !== null
      ? raw.nightEnd
      : DEFAULT_THEME_PREFS.nightEnd;
  return { choice, nightByClock, nightStart, nightEnd };
}

function parsePrefs(raw: string | null): ThemePrefs {
  if (!raw) return { ...DEFAULT_THEME_PREFS };
  try {
    const parsed = JSON.parse(raw) as Partial<ThemePrefs> | null;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { ...DEFAULT_THEME_PREFS };
    return sanitize(parsed);
  } catch {
    return { ...DEFAULT_THEME_PREFS };
  }
}

/** localStorage on the web, a sync file on the phone, nothing under node. */
function storage(): StorageLike | null {
  try {
    if (typeof localStorage !== "undefined") return localStorage;
  } catch {
    /* private mode: fall through */
  }
  return nativeFileStorage();
}

function nativeFileStorage(): StorageLike | null {
  if (typeof navigator === "undefined" || navigator.product !== "ReactNative") return null;
  try {
    const fs = require("expo-file-system") as {
      File: new (dir: unknown, name: string) => {
        exists: boolean;
        textSync: () => string;
        writeSync: (content: string) => void;
        create: (opts?: { overwrite?: boolean }) => void;
      };
      Paths: { document: unknown };
    };
    const file = new fs.File(fs.Paths.document, NATIVE_FILE);
    return {
      getItem: (key) => {
        if (key !== THEME_PREFS_KEY || !file.exists) return null;
        return file.textSync();
      },
      setItem: (key, value) => {
        if (key !== THEME_PREFS_KEY) return;
        if (!file.exists) file.create();
        file.writeSync(value);
      },
    };
  } catch {
    return null;
  }
}

/** True when the device itself is in dark mode. False under node. */
export function detectSystemDark(): boolean {
  if (typeof matchMedia === "function") {
    try {
      return matchMedia("(prefers-color-scheme: dark)").matches;
    } catch {
      /* fall through */
    }
  }
  if (typeof navigator !== "undefined" && navigator.product === "ReactNative") {
    try {
      const rn = require("react-native") as {
        Appearance?: { getColorScheme?: () => string | null | undefined };
      };
      return rn.Appearance?.getColorScheme?.() === "dark";
    } catch {
      return false;
    }
  }
  return false;
}

export function readThemePrefs(from: StorageLike | null = storage()): ThemePrefs {
  try {
    return parsePrefs(from?.getItem(THEME_PREFS_KEY) ?? null);
  } catch {
    return { ...DEFAULT_THEME_PREFS };
  }
}

export function writeThemePrefs(next: ThemePrefs, to: StorageLike | null = storage()): ThemePrefs {
  const safe = sanitize(next);
  try {
    to?.setItem(THEME_PREFS_KEY, JSON.stringify(safe));
  } catch {
    /* best effort, like the other small settings */
  }
  return safe;
}

export function subscribeThemePrefs(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify(prefs: ThemePrefs): void {
  for (const listener of listeners) listener(prefs);
}

function isNativeApp(): boolean {
  return typeof document === "undefined" && typeof navigator !== "undefined" && navigator.product === "ReactNative";
}

/**
 * Save the choice and tell every listener. On the phone the styles were
 * captured at launch, so a scheme change reloads the app once the file is
 * written. The web flips the CSS variables in place.
 */
export function commitThemePrefs(next: ThemePrefs, to?: StorageLike | null): ThemePrefs {
  const live = to === undefined;
  const store = live ? storage() : to;
  const before = resolveScheme(readThemePrefs(store), { now: new Date(), systemDark: detectSystemDark() });
  const saved = writeThemePrefs(next, store);
  if (live) notify(saved);
  const after = resolveScheme(saved, { now: new Date(), systemDark: detectSystemDark() });
  if (live && before !== after && isNativeApp()) {
    void import("expo")
      .then((mod) => {
        const reload = (mod as { reloadAppAsync?: (reason: string) => Promise<void> }).reloadAppAsync;
        return reload?.("theme");
      })
      .catch(() => {
        /* the file is saved; the next cold start still picks it up */
      });
  }
  return saved;
}

/** The palette the screens should paint with right now. */
export function activePalette(now: Date = new Date()): Palette {
  return paletteForScheme(resolveScheme(readThemePrefs(), { now, systemDark: detectSystemDark() }));
}
