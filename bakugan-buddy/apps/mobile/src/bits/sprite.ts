/**
 * The pixel-sprite format used by the optional 8-bit look (slice 8A).
 *
 * A sprite is a fixed width and height plus a list of frames. Every frame row
 * is one string of hex digits pointing into `BIT_PALETTE` (bitPalette.ts):
 * "0" is transparent, "1" to "f" are real colours.
 *
 * Pure TypeScript: no React Native import and no enums, so it runs under
 * `node --experimental-strip-types` for the tests.
 */

export type Sprite = {
  /** Width in pixels (one palette digit per pixel). */
  w: number;
  /** Height in pixels. */
  h: number;
  /** One entry per animation frame; each frame is `h` rows of `w` digits. */
  frames: string[][];
};

export type SpriteCheck = { ok: true } | { ok: false; errors: string[] };

/** One digit of a sprite row: "0" to "f", any case. */
export const DIGIT = /^[0-9a-fA-F]$/;

/**
 * Check a sprite: a real width and height, at least one frame, every frame
 * exactly `h` rows, every row exactly `w` digits, only 0-f. Never throws.
 */
export function validateSprite(input: Sprite): SpriteCheck {
  const errors: string[] = [];
  if (!input || typeof input !== "object") return { ok: false, errors: ["the sprite is not an object"] };
  const { w, h, frames } = input;
  if (!Number.isInteger(w) || w <= 0) errors.push(`w must be a positive whole number, got ${String(w)}`);
  if (!Number.isInteger(h) || h <= 0) errors.push(`h must be a positive whole number, got ${String(h)}`);
  if (!Array.isArray(frames) || frames.length === 0) {
    errors.push("frames must be a non-empty list");
    return { ok: errors.length === 0, errors };
  }
  frames.forEach((frame, frameIndex) => {
    if (!Array.isArray(frame)) {
      errors.push(`frame ${frameIndex} is not a list of rows`);
      return;
    }
    if (Number.isInteger(h) && frame.length !== h) {
      errors.push(`frame ${frameIndex} has ${frame.length} rows, expected ${h}`);
    }
    frame.forEach((row, rowIndex) => {
      if (typeof row !== "string") {
        errors.push(`frame ${frameIndex} row ${rowIndex} is not a string`);
        return;
      }
      if (Number.isInteger(w) && row.length !== w) {
        errors.push(`frame ${frameIndex} row ${rowIndex} is ${row.length} wide, expected ${w}`);
      }
      for (const digit of row) {
        if (!DIGIT.test(digit)) {
          errors.push(`frame ${frameIndex} row ${rowIndex} has a bad digit "${digit}"`);
          break;
        }
      }
    });
  });
  return { ok: errors.length === 0, errors };
}

/** Throw with every problem listed; the art file calls this once at import time. */
export function assertSprite(input: Sprite, name = "sprite"): void {
  const check = validateSprite(input);
  if (!check.ok) throw new Error(`${name} is not a valid sprite: ${check.errors.join("; ")}`);
}

/** How many frames a sprite carries (nine moods x two frames for Preyas). */
export function frameCount(sprite: Sprite): number {
  return sprite.frames.length;
}
