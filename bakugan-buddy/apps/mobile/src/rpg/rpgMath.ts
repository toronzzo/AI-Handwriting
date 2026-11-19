/**
 * RPG level and rank maths (slice 5). Pure functions, no UI.
 */

/** XP needed to pass level L: 150 at level 1, then +30 per level. */
export function need(L: number): number {
  return 120 + 30 * L;
}

/** Turn total XP into level, XP into that level, and XP needed to pass it. */
export function levelOf(totalXp: number): { L: number; into: number; need: number } {
  let L = 1;
  let rest = totalXp;
  while (rest >= need(L)) {
    rest -= need(L);
    L += 1;
  }
  return { L, into: rest, need: need(L) };
}

/** Area strength on a 0..10 scale, square-root shaped. */
export function areaValue(xp: number): number {
  return Math.min(10, Math.sqrt(xp / 12));
}

/** [maxLevel, letter, name] — first row whose maxLevel covers the level. */
export const RANKS: [number, string, string][] = [
  [3, "E", "Rookie"],
  [6, "D", "Seeker"],
  [9, "C", "Hero"],
  [14, "B", "Master"],
  [24, "A", "Legend"],
  [999, "S", "Mythic"],
];

/** Rank for a level: the first entry with level <= entry[0]. */
export function rankOf(level: number): { letter: string; name: string } {
  const entry = RANKS.find(([max]) => level <= max) ?? RANKS[RANKS.length - 1];
  return { letter: entry[1], name: entry[2] };
}
