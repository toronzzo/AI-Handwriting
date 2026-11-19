/**
 * The 16 colours of the optional 8-bit look (slice 8A). Index 0 is
 * transparent; the 15 real colours are one calm blue/teal water family for
 * Preyas, cream paper, two greys, a near-black outline and one warm accent.
 *
 * Rules baked into this file:
 * - NO red anywhere (a red family would read as an error, and the product rule
 *   keeps red for real errors only).
 * - These are the ONLY 8-bit hex values in the app. Every pixel sprite and the
 *   PixelSprite renderer read colours from here, never from a literal.
 *
 * Pure data plus pure helpers: no React Native import and no enums, so it runs
 * under `node --experimental-strip-types` for the tests.
 */

/** One entry of the 8-bit palette; `transparent` is the hole in the sprite. */
export type BitColour =
  | { readonly index: number; readonly name: string; readonly hex: string; readonly transparent: false }
  | { readonly index: number; readonly name: string; readonly hex: null; readonly transparent: true };

/** Palette index 0: what a "0" in a sprite row means (nothing is drawn). */
export const TRANSPARENT = 0;

/** The palette itself: exactly 16 entries, index 0 transparent. */
export const BIT_PALETTE: readonly BitColour[] = [
  { index: 0, name: "transparent", hex: null, transparent: true },
  { index: 1, name: "outline", hex: "#12161C", transparent: false },
  { index: 2, name: "nightBlue", hex: "#102A45", transparent: false },
  { index: 3, name: "deepWater", hex: "#1B4A73", transparent: false },
  { index: 4, name: "water", hex: "#2A6EA8", transparent: false },
  { index: 5, name: "aqua", hex: "#3E9BD4", transparent: false },
  { index: 6, name: "skyBlue", hex: "#6CC1E6", transparent: false },
  { index: 7, name: "foam", hex: "#A8E0F0", transparent: false },
  { index: 8, name: "paleTeal", hex: "#CFEDEF", transparent: false },
  { index: 9, name: "teal", hex: "#1F7F7A", transparent: false },
  { index: 10, name: "mint", hex: "#5CC4A6", transparent: false },
  { index: 11, name: "cream", hex: "#F2EAD3", transparent: false },
  { index: 12, name: "warmAccent", hex: "#E8B04B", transparent: false },
  { index: 13, name: "greyLight", hex: "#9AA6AD", transparent: false },
  { index: 14, name: "greyDark", hex: "#5A6672", transparent: false },
  { index: 15, name: "paper", hex: "#FBF7EC", transparent: false },
];

/** "0"-"f" -> palette index; anything else is -1. */
export function bitIndexAtDigit(digit: string): number {
  if (digit.length !== 1) return -1;
  const value = Number.parseInt(digit, 16);
  return Number.isInteger(value) && value >= 0 && value < 16 ? value : -1;
}

/** The hex for a palette index, or null when the index is transparent or out of range. */
export function bitColour(index: number): string | null {
  const entry = BIT_PALETTE[index];
  if (!entry || entry.transparent) return null;
  return entry.hex;
}

/** Named colour for the sprite art (throws on a typo, so a pose never silently loses a colour). */
export function bitHex(name: BitColour["name"]): string {
  const entry = BIT_PALETTE.find((item) => item.name === name);
  if (!entry || entry.transparent) throw new Error(`unknown 8-bit colour: ${name}`);
  return entry.hex;
}
