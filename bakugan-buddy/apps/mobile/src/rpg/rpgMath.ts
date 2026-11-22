/**
 * RPG level and rank maths (slice 5). Pure functions, no UI.
 *
 * Level and rank live in the alive package so the chat header and Today
 * cannot drift. Area strength stays here; it is only drawn on the radar.
 */
export { need, levelOf, rankOf, RANKS } from "../../../../packages/alive/src/rpgLevel.ts";

/** Area strength on a 0..10 scale, square-root shaped. */
export function areaValue(xp: number): number {
  return Math.min(10, Math.sqrt(xp / 12));
}
