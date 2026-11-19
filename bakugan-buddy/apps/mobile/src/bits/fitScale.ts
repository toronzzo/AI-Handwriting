/**
 * How big to draw the pixel Preyas inside a box (FIX-2).
 *
 * A pixel sprite must be scaled by a whole number or its edges blur, so the
 * caller gives the available box (in device pixels) and this returns the
 * largest whole scale that fills about 60% of the box's height. Width is
 * checked too, so a short wide box never cuts him off.
 *
 * Pure: no react-native import, no enums, so it runs under `node --test`.
 */

/** The sprite should cover about this share of the box height. */
export const FILL_SHARE = 0.6;

/**
 * The largest whole scale, at least 1, at which a `size` x `size` sprite
 * covers about `FILL_SHARE` of `height` and still fits inside `width`.
 * A missing or nonsense box falls back to `fallback`.
 */
export function fitScale(height: number, width: number, size: number, fallback = 5): number {
  const px = Number.isFinite(size) && size > 0 ? Math.round(size) : 0;
  if (!px) return 1;
  if (!Number.isFinite(height) || !Number.isFinite(width) || height <= 0 || width <= 0) {
    return fallback >= 1 ? Math.round(fallback) : 1;
  }
  const byHeight = (height * FILL_SHARE) / px;
  const byWidth = width / px;
  const scale = Math.floor(Math.min(byHeight, byWidth));
  return scale >= 1 ? scale : 1;
}
