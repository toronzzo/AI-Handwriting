/**
 * The Pajero palette for the Retro RPG redesign, with automatic day/night
 * colours. Pure TypeScript with no React Native import and no enums, so it
 * runs under `node --experimental-strip-types`.
 *
 * Night is 19:00 to 05:59 local time; day is 06:00 to 18:59.
 */

export type PaletteKey =
  | "bg"
  | "skyTop"
  | "skyMid"
  | "skyBottom"
  | "card"
  | "cardSoft"
  | "text"
  | "dim"
  | "faint"
  | "accent"
  | "accentText"
  | "onAccent"
  | "accentDim"
  | "accentSoft"
  | "accentLine"
  | "lineStrong"
  | "track"
  | "off"
  | "good"
  | "danger"
  | "stripeYellow"
  | "stripeOrange"
  | "stripeRed"
  | "note"
  | "shadow"
  | "scrim"
  | "stageTop"
  | "stageBottom";

export type Palette = Record<PaletteKey, string>;

/** The order keys are emitted by cssVars; stable for snapshot-free diffs. */
const KEYS: readonly PaletteKey[] = [
  "bg",
  "skyTop",
  "skyMid",
  "skyBottom",
  "card",
  "cardSoft",
  "text",
  "dim",
  "faint",
  "accent",
  "accentText",
  "onAccent",
  "accentDim",
  "accentSoft",
  "accentLine",
  "lineStrong",
  "track",
  "off",
  "good",
  "danger",
  "stripeYellow",
  "stripeOrange",
  "stripeRed",
  "note",
  "shadow",
  "scrim",
  "stageTop",
  "stageBottom",
];

export const DAY: Palette = {
  bg: "#3F78C0",
  skyTop: "#3F78C0",
  skyMid: "#6C9DD3",
  skyBottom: "#9CC4EA",
  card: "#F2F0EA",
  cardSoft: "#E9E6DE",
  text: "#121212",
  dim: "#4A4A4A",
  faint: "#5E5E5E",
  accent: "#1E64C8",
  accentText: "#1957B4",
  onAccent: "#FFFFFF",
  accentDim: "rgba(30,100,200,0.55)",
  accentSoft: "rgba(30,100,200,0.14)",
  accentLine: "rgba(18,18,18,0.14)",
  lineStrong: "rgba(18,18,18,0.28)",
  track: "#D6DDE8",
  off: "#8A8A8A",
  good: "#1E64C8",
  danger: "#B01E22",
  stripeYellow: "#F6C02C",
  stripeOrange: "#F07F1E",
  stripeRed: "#D8262B",
  note: "#6A4D00",
  shadow: "rgba(14,34,66,0.20)",
  scrim: "rgba(10,24,50,0.45)",
  stageTop: "#4F88CC",
  stageBottom: "#9CC4EA",
};

export const NIGHT: Palette = {
  bg: "#233658",
  skyTop: "#16223C",
  skyMid: "#233658",
  skyBottom: "#34507F",
  card: "#D6D4CD",
  cardSoft: "#CBC8C0",
  text: "#121212",
  dim: "#3F3F3F",
  faint: "#4A4A4A",
  accent: "#1E64C8",
  accentText: "#123F8C",
  onAccent: "#FFFFFF",
  accentDim: "rgba(30,100,200,0.55)",
  accentSoft: "rgba(30,100,200,0.14)",
  accentLine: "rgba(18,18,18,0.18)",
  lineStrong: "rgba(18,18,18,0.34)",
  track: "#BFC6D2",
  off: "#6E6E6E",
  good: "#1E64C8",
  danger: "#9B1B1F",
  stripeYellow: "#F6C02C",
  stripeOrange: "#F07F1E",
  stripeRed: "#D8262B",
  note: "#6A4D00",
  shadow: "rgba(14,34,66,0.20)",
  scrim: "rgba(10,24,50,0.45)",
  stageTop: "#1B2B49",
  stageBottom: "#2C4572",
};

/** Night runs from 19:00 through 05:59 local time (inclusive hour bands). */
export function isNight(d: Date): boolean {
  const h = d.getHours();
  return h >= 19 || h < 6;
}

export function paletteFor(d: Date): Palette {
  return isNight(d) ? NIGHT : DAY;
}

/**
 * One CSS declaration string, a variable per palette key named `--pz-<key>`,
 * e.g. `--pz-card:#F2F0EA;--pz-text:#121212;...`.
 */
export function cssVars(p: Palette): string {
  return KEYS.map((k) => `--pz-${k}:${p[k]}`).join(";");
}
