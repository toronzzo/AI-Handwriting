/**
 * The Pajero palette for the Retro RPG redesign. Pure TypeScript with no
 * React Native import and no enums, so it runs under
 * `node --experimental-strip-types`.
 *
 * DAY is the light theme (paper cards, dark text). NIGHT is the dark theme
 * (navy surfaces, light text). Which one is on screen is the saved appearance
 * choice in themePrefs.ts, not the clock by itself.
 *
 * `isNight` / `paletteFor` stay the plain clock helper: night is 19:00 to
 * 05:59 local time. The settings window (20:00–07:00) is separate.
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
  | "onSky"
  | "onSkyMuted"
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
  "onSky",
  "onSkyMuted",
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
  /* Text that sits on the sky, not on a paper card. Day sky is mid blue, so
     this has to be near-black; night sky is navy, so this is white. */
  onSky: "#000000",
  onSkyMuted: "#050505",
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
  bg: "#10192B",
  skyTop: "#0C1424",
  skyMid: "#16243C",
  skyBottom: "#1E3558",
  card: "#162033",
  cardSoft: "#1E2C46",
  text: "#F3F0E8",
  dim: "#D0CBC1",
  faint: "#B7B2A8",
  onSky: "#FFFFFF",
  onSkyMuted: "#C9D4E6",
  accent: "#2C78CC",
  accentText: "#A9CEFF",
  onAccent: "#FFFFFF",
  accentDim: "rgba(44,120,204,0.55)",
  accentSoft: "rgba(169,206,255,0.16)",
  accentLine: "rgba(243,240,232,0.16)",
  lineStrong: "rgba(243,240,232,0.32)",
  track: "#314564",
  off: "#9AA3B5",
  good: "#7EB6FF",
  danger: "#FF9B9B",
  stripeYellow: "#F6C02C",
  stripeOrange: "#F07F1E",
  stripeRed: "#D8262B",
  note: "#F0C56B",
  shadow: "rgba(0,0,0,0.45)",
  scrim: "rgba(4,8,16,0.72)",
  stageTop: "#1A3054",
  stageBottom: "#0E1A30",
  slotPlaceholder: "#2A3D5C",
  bgShadeTop: "rgba(12,20,36,0.82)",
  bgShadeBottom: "rgba(16,25,43,0.88)",
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

/**
 * Turn a `#RRGGBB` colour into the same colour with a different alpha, as
 * an `rgba()` string. SVG attributes do not reliably accept CSS `var()`
 * strings, so charts build translucent fills from real hex values through
 * this helper. Non-hex values fall back to the colour unchanged.
 */
export function withAlpha(hex: string, alpha: number): string {
  const value = hex.replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(value)) return hex;
  const n = parseInt(value, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${alpha})`;
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
