/**
 * One Pajero theme for the whole app, with automatic day/night colours.
 * 8px spacing grid, one type scale. Every screen reads from here.
 *
 * On the web every colour is the string `var(--pz-<key>)` so the injected
 * stylesheet can flip day/night live; on the iPhone and under node tests it
 * is a fixed hex taken from the palette at launch.
 */
import { paletteFor, type PaletteKey } from "./palette.ts";

const isWeb = typeof document !== "undefined";
const launch = paletteFor(new Date());

function colour(key: PaletteKey): string {
  return isWeb ? `var(--pz-${key})` : launch[key];
}

export const theme = {
  bg: colour("bg"),
  card: colour("card"),
  cardSoft: colour("cardSoft"),
  accent: colour("accent"),
  accentDim: colour("accentDim"),
  accentSoft: colour("accentSoft"),
  accentLine: colour("accentLine"),
  text: colour("text"),
  dim: colour("dim"),
  faint: colour("faint"),
  danger: colour("danger"),
  good: colour("good"),
  /** New palette colours added for the Retro RPG redesign. */
  skyTop: colour("skyTop"),
  skyMid: colour("skyMid"),
  skyBottom: colour("skyBottom"),
  accentText: colour("accentText"),
  onAccent: colour("onAccent"),
  lineStrong: colour("lineStrong"),
  track: colour("track"),
  off: colour("off"),
  stripeYellow: colour("stripeYellow"),
  stripeOrange: colour("stripeOrange"),
  stripeRed: colour("stripeRed"),
  note: colour("note"),
  shadow: colour("shadow"),
  scrim: colour("scrim"),
  /** The LevelCard hero stage gradient, added in the Today slice. */
  stageTop: colour("stageTop"),
  stageBottom: colour("stageBottom"),
  /** Image slots (slice 10): the empty box and the shade over a bg picture. */
  slotPlaceholder: colour("slotPlaceholder"),
  bgShadeTop: colour("bgShadeTop"),
  bgShadeBottom: colour("bgShadeBottom"),
  /** Font stacks; only the web has named fonts loaded. */
  font: {
    body: isWeb ? "Inter, system-ui, -apple-system, sans-serif" : undefined,
    display: isWeb ? "Oswald, 'Arial Narrow', Impact, sans-serif" : undefined,
  },
  space: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 },
  type: {
    label: 11,
    caption: 12,
    body: 14,
    input: 16,
    title: 18,
    hero: 24,
    /** Display sizes for the RPG headings, clock and timer. */
    display: { title: 32, level: 32, section: 26, clock: 24, timer: 20 },
  },
  radius: { sm: 10, md: 14, lg: 20 },
  /** Layout sizes shared by the shell and the chat screen. */
  size: {
    /** Width of the Mac icon rail. */
    nav: 72,
    /** Width of the chats list beside the thread on a Mac. */
    list: 240,
    /** Reading width of the chat column. */
    maxChat: 760,
    /** Header ball and the dot beside his bubbles. */
    avatar: 40,
    dot: 24,
    header: 64,
    bond: 160,
    composer: 22,
  },
  /** Text line height for chat bubbles. */
  lead: 21,
};

export type Theme = typeof theme;
