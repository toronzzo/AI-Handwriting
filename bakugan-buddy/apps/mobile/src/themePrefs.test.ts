/// <reference types="node" />
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DAY, NIGHT } from "./palette.ts";
import {
  DEFAULT_THEME_PREFS,
  THEME_PREFS_KEY,
  clockMinutes,
  commitThemePrefs,
  inNightWindow,
  readThemePrefs,
  resolveScheme,
  writeThemePrefs,
  type StorageLike,
  type ThemePrefs,
} from "./themePrefs.ts";

function fakeStorage(seed: Record<string, string> = {}): StorageLike & { rows: Map<string, string> } {
  const rows = new Map(Object.entries(seed));
  return {
    rows,
    getItem: (key) => rows.get(key) ?? null,
    setItem: (key, value) => {
      rows.set(key, value);
    },
  };
}

const throwing: StorageLike = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
};

const noon = new Date(2024, 0, 15, 12, 0);
const evening = new Date(2024, 0, 15, 20, 0);
const morning = new Date(2024, 0, 15, 6, 59);
const seven = new Date(2024, 0, 15, 7, 0);

test("nothing saved means Auto, with dark from 20:00 to 07:00", () => {
  assert.deepEqual(readThemePrefs(fakeStorage()), DEFAULT_THEME_PREFS);
  assert.deepEqual(readThemePrefs(null), DEFAULT_THEME_PREFS);
  assert.equal(THEME_PREFS_KEY, "preyas.theme");
  assert.equal(DEFAULT_THEME_PREFS.choice, "auto");
  assert.equal(DEFAULT_THEME_PREFS.nightByClock, true);
  assert.equal(DEFAULT_THEME_PREFS.nightStart, "20:00");
  assert.equal(DEFAULT_THEME_PREFS.nightEnd, "07:00");
});

test("the choice survives a reload under one key", () => {
  const store = fakeStorage();
  const saved = writeThemePrefs({ choice: "dark", nightByClock: false, nightStart: "20:00", nightEnd: "07:00" }, store);
  assert.deepEqual(readThemePrefs(store), saved);
  assert.deepEqual([...store.rows.keys()], [THEME_PREFS_KEY]);
  const again = JSON.parse(store.rows.get(THEME_PREFS_KEY)!) as ThemePrefs;
  assert.equal(again.choice, "dark");
  assert.equal(again.nightByClock, false);
});

test("Light, Dark and Auto all round-trip, including the night window", () => {
  const store = fakeStorage();
  for (const choice of ["light", "dark", "auto"] as const) {
    writeThemePrefs({ ...DEFAULT_THEME_PREFS, choice, nightByClock: choice === "auto" }, store);
    assert.equal(readThemePrefs(store).choice, choice);
  }
  writeThemePrefs({ ...DEFAULT_THEME_PREFS, nightByClock: false, nightStart: "21:30", nightEnd: "06:15" }, store);
  const read = readThemePrefs(store);
  assert.equal(read.nightByClock, false);
  assert.equal(read.nightStart, "21:30");
  assert.equal(read.nightEnd, "06:15");
});

test("torn storage falls back to the default instead of crashing", () => {
  for (const raw of ["{not json", "null", "[]", '"dark"', '{"choice":"dim"}', '{"nightByClock":"yes"}']) {
    const store = fakeStorage({ [THEME_PREFS_KEY]: raw });
    const read = readThemePrefs(store);
    if (raw === '{"nightByClock":"yes"}') {
      assert.equal(read.choice, "auto");
      assert.equal(read.nightByClock, true);
    } else if (raw === '{"choice":"dim"}') {
      assert.equal(read.choice, "auto");
    } else {
      assert.deepEqual(read, DEFAULT_THEME_PREFS, raw);
    }
  }
  assert.deepEqual(readThemePrefs(throwing), DEFAULT_THEME_PREFS);
  assert.equal(writeThemePrefs({ ...DEFAULT_THEME_PREFS, choice: "light" }, throwing).choice, "light");
});

test("the night window is 20:00 inclusive through 07:00 exclusive", () => {
  assert.equal(inNightWindow(new Date(2024, 0, 15, 19, 59), "20:00", "07:00"), false);
  assert.equal(inNightWindow(evening, "20:00", "07:00"), true);
  assert.equal(inNightWindow(new Date(2024, 0, 15, 0, 0), "20:00", "07:00"), true);
  assert.equal(inNightWindow(morning, "20:00", "07:00"), true);
  assert.equal(inNightWindow(seven, "20:00", "07:00"), false);
  assert.equal(inNightWindow(noon, "20:00", "07:00"), false);
  assert.equal(clockMinutes("24:00"), null);
  assert.equal(clockMinutes("20:60"), null);
  assert.equal(inNightWindow(evening, "nope", "07:00"), false);
  assert.equal(inNightWindow(evening, "20:00", "20:00"), false);
});

test("Light stays light and Dark stays dark, whatever the clock and the device say", () => {
  const light: ThemePrefs = { ...DEFAULT_THEME_PREFS, choice: "light" };
  const dark: ThemePrefs = { ...DEFAULT_THEME_PREFS, choice: "dark", nightByClock: false };
  assert.equal(resolveScheme(light, { now: evening, systemDark: true }), "day");
  assert.equal(resolveScheme(light, { now: noon, systemDark: false }), "day");
  assert.equal(resolveScheme(dark, { now: noon, systemDark: false }), "night");
  assert.equal(resolveScheme(dark, { now: seven, systemDark: false }), "night");
});

test("Auto follows the device, and the night window only when it is on", () => {
  const autoOn: ThemePrefs = { ...DEFAULT_THEME_PREFS, choice: "auto", nightByClock: true };
  const autoOff: ThemePrefs = { ...DEFAULT_THEME_PREFS, choice: "auto", nightByClock: false };
  assert.equal(resolveScheme(autoOff, { now: noon, systemDark: false }), "day");
  assert.equal(resolveScheme(autoOff, { now: noon, systemDark: true }), "night");
  assert.equal(resolveScheme(autoOff, { now: evening, systemDark: false }), "day");
  assert.equal(resolveScheme(autoOn, { now: evening, systemDark: false }), "night");
  assert.equal(resolveScheme(autoOn, { now: morning, systemDark: false }), "night");
  assert.equal(resolveScheme(autoOn, { now: seven, systemDark: false }), "day");
  assert.equal(resolveScheme(autoOn, { now: noon, systemDark: true }), "night");
  assert.equal(resolveScheme(autoOn, { now: noon, systemDark: false }), "day");
});

test("commit writes the same record readThemePrefs returns", () => {
  const store = fakeStorage();
  const saved = commitThemePrefs({ ...DEFAULT_THEME_PREFS, choice: "light", nightByClock: false }, store);
  assert.deepEqual(readThemePrefs(store), saved);
  assert.equal(saved.choice, "light");
});

test("the first-paint script uses the same key, window and backgrounds", () => {
  const html = readFileSync(join(process.cwd(), "public/index.html"), "utf8");
  assert.match(html, new RegExp(THEME_PREFS_KEY));
  assert.match(html, new RegExp(DEFAULT_THEME_PREFS.nightStart));
  assert.match(html, new RegExp(DEFAULT_THEME_PREFS.nightEnd));
  assert.match(html, new RegExp(DAY.bg));
  assert.match(html, new RegExp(NIGHT.bg));
  assert.match(html, new RegExp(NIGHT.onSky));
  assert.match(html, /data-pz/);
  assert.match(html, /prefers-color-scheme: dark/);
});
