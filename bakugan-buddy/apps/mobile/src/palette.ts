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
  | "stageBottom"
  | "slotPlaceholder"
  | "bgShadeTop"
  | "bgShadeBottom";

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
  "slotPlaceholder",
  "bgShadeTop",
  "bgShadeBottom",
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
  /* Image slots: the empty picture box, and the shade over a bg picture. */
  slotPlaceholder: "#DCE6F2",
  bgShadeTop: "rgba(63,120,192,0.55)",
  bgShadeBottom: "rgba(156,196,234,0.60)",
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
  slotPlaceholder: "#B9C4D3",
  bgShadeTop: "rgba(22,34,60,0.80)",
  bgShadeBottom: "rgba(35,54,88,0.85)",
};

/**
 * Blend two `#RRGGBB` colours channel by channel, `t` 0 = from and `t` 1 = to.
 * Used to draw the small gradients the app shows as stacked bands (the level
 * card stage and the empty image slot), since there is no gradient package.
 * Non-hex values fall back to the `to` colour so translucent tokens are safe.
 */
export function mixHex(from: string, to: string, t: number): string {
  const parse = (value: string): number | null => {
    const hex = value.trim();
    return /^#[0-9a-fA-F]{6}$/.test(hex) ? parseInt(hex.slice(1), 16) : null;
  };
  const a = parse(from);
  const b = parse(to);
  if (a === null || b === null) return b === null ? from : to;
  const channel = (shift: number) => {
    const ca = (a >> shift) & 255;
    const cb = (b >> shift) & 255;
    return Math.round(ca + (cb - ca) * t);
  };
  const value = (channel(16) << 16) | (channel(8) << 8) | channel(0);
  return `#${value.toString(16).padStart(6, "0")}`;
}

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
