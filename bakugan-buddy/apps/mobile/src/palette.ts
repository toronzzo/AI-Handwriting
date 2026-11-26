/**
 * The Preyas risograph palette. Pure TypeScript with no React Native import
 * and no enums, so it runs under `node --experimental-strip-types`.
 *
 * DAY is the warm paper theme (cream paper, ink text, blue + vermilion spot
 * colours). NIGHT is the dark print (ink paper, cream text, the same two spot
 * colours lifted for dark ground). Which one is on screen is the saved
 * appearance choice in themePrefs.ts, not the clock by itself.
 *
 * The riso tokens the Today redesign draws with are paper / paperDeep / ink
 * (day) and ink / raised / cream (night), plus the shared spot colours blue,
 * vermilion and ochre. `isNight` / `paletteFor` stay the plain clock
 * helper: night is 19:00 to 05:59 local time.
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
  | "bgShadeBottom"
  | "paper"
  | "paperDeep"
  | "ink"
  | "raised"
  | "cream"
  | "blue"
  | "vermilion"
  | "ochre";

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
  "paper",
  "paperDeep",
  "ink",
  "raised",
  "cream",
  "blue",
  "vermilion",
  "ochre",
];

export const DAY: Palette = {
  bg: "#EFE7D6",
  skyTop: "#EFE7D6",
  skyMid: "#EFE7D6",
  skyBottom: "#EFE7D6",
  card: "#E4D9C3",
  cardSoft: "#E9E0CC",
  text: "#16130F",
  dim: "#3F3A32",
  faint: "#5C564C",
  /* Text that sits on the page itself (titles and subtitles), which is now
     the paper tone in both themes, not a blue sky. */
  onSky: "#16130F",
  onSkyMuted: "#4A433A",
  accent: "#1D4E9E",
  accentText: "#1D4E9E",
  onAccent: "#EFE7D6",
  accentDim: "rgba(29,78,158,0.55)",
  accentSoft: "rgba(29,78,158,0.14)",
  accentLine: "rgba(22,19,15,0.16)",
  lineStrong: "rgba(22,19,15,0.50)",
  track: "#D8CEB8",
  off: "#8A8172",
  good: "#1D4E9E",
  danger: "#8E2A10",
  stripeYellow: "#D99A2B",
  stripeOrange: "#C9431B",
  stripeRed: "#8E2A10",
  note: "#6A4D00",
  shadow: "rgba(22,19,15,0.18)",
  scrim: "rgba(22,19,15,0.45)",
  stageTop: "#EFE7D6",
  stageBottom: "#EFE7D6",
  slotPlaceholder: "#E0D7C3",
  bgShadeTop: "rgba(239,231,214,0.55)",
  bgShadeBottom: "rgba(239,231,214,0.62)",
  /* Risograph tokens (Today redesign). */
  paper: "#EFE7D6",
  paperDeep: "#E4D9C3",
  ink: "#16130F",
  raised: "#E4D9C3",
  cream: "#EFE7D6",
  blue: "#1D4E9E",
  vermilion: "#C9431B",
  ochre: "#D99A2B",
};

export const NIGHT: Palette = {
  bg: "#12161B",
  skyTop: "#12161B",
  skyMid: "#12161B",
  skyBottom: "#12161B",
  card: "#1B2128",
  cardSoft: "#232B34",
  text: "#EFE7D6",
  dim: "#B8B0A0",
  faint: "#9A9282",
  onSky: "#EFE7D6",
  onSkyMuted: "#B8B0A0",
  accent: "#7FA8E8",
  accentText: "#7FA8E8",
  onAccent: "#12161B",
  accentDim: "rgba(127,168,232,0.55)",
  accentSoft: "rgba(127,168,232,0.16)",
  accentLine: "rgba(239,231,214,0.16)",
  lineStrong: "rgba(239,231,214,0.45)",
  track: "#2A323C",
  off: "#7C8490",
  good: "#7FA8E8",
  danger: "#F08256",
  stripeYellow: "#E8B65A",
  stripeOrange: "#F08256",
  stripeRed: "#C9431B",
  note: "#E8B65A",
  shadow: "rgba(0,0,0,0.45)",
  scrim: "rgba(4,8,16,0.72)",
  stageTop: "#12161B",
  stageBottom: "#12161B",
  slotPlaceholder: "#262E38",
  bgShadeTop: "rgba(18,22,27,0.82)",
  bgShadeBottom: "rgba(18,22,27,0.88)",
  /* Risograph tokens (Today redesign): dark paper, cream ink, lifted spots. */
  paper: "#EFE7D6",
  paperDeep: "#E4D9C3",
  ink: "#12161B",
  raised: "#1B2128",
  cream: "#EFE7D6",
  blue: "#7FA8E8",
  vermilion: "#F08256",
  ochre: "#E8B65A",
};

/**
 * Blend two `#RRGGBB` colours channel by channel, `t` 0 = from and `t` 1 = to.
 * Used to draw the small gradients the app shows as stacked bands (the empty
 * image slot), since there is no gradient package. Non-hex values fall back
 * to the `to` colour so translucent tokens are safe.
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
 * e.g. `--pz-card:#E4D9C3;--pz-text:#16130F;...`.
 */
export function cssVars(p: Palette): string {
  return KEYS.map((k) => `--pz-${k}:${p[k]}`).join(";");
}
