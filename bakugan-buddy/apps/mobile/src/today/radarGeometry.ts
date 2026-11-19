/**
 * Pure radar geometry (slice 7): where the six area values land inside the
 * SVG viewBox. No React and no react-native imports, so it runs under
 * `node --experimental-strip-types`.
 */

export type RadarPoint = { x: number; y: number };

/** The radar has six axes: Body, Mind, Money, Spirit, Craft, Goal. */
export const RADAR_AXES = 6;

/** The value the outermost ring stands for (areaValue caps at 10). */
export const RADAR_MAX = 10;

/**
 * Unit direction of axis `i`. Axis 0 points straight up and the rest follow
 * clockwise, one per corner of the hexagon.
 */
export function radarAxisDirection(i: number): RadarPoint {
  const angle = -Math.PI / 2 + i * ((Math.PI * 2) / RADAR_AXES);
  return { x: Math.cos(angle), y: Math.sin(angle) };
}

/**
 * The polygon points for one area value per axis, scaled against RADAR_MAX.
 * Values are clamped to 0..10 so the shape can never leave its rings.
 */
export function radarPoints(
  values: number[],
  cx: number,
  cy: number,
  radius: number,
): RadarPoint[] {
  return values.map((value, i) => {
    const clamped = Math.min(RADAR_MAX, Math.max(0, value));
    const dir = radarAxisDirection(i);
    const r = radius * (clamped / RADAR_MAX);
    return { x: cx + dir.x * r, y: cy + dir.y * r };
  });
}
