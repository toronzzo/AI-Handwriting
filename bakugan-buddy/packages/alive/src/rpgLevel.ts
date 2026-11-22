/**
 * Level, rank and the chat header's bond, shared by Today and the brain.
 *
 * Chat used to count user turns inside the open thread, so a new chat reset
 * Preyas to level 1 while Today kept the life-log level. Both screens now
 * read this maths from the same XP total.
 */

/** XP needed to pass level L: 150 at level 1, then +30 per level. */
export function need(L: number): number {
  return 120 + 30 * L;
}

/** Turn total XP into level, XP into that level, and XP needed to pass it. */
export function levelOf(totalXp: number): { L: number; into: number; need: number } {
  let L = 1;
  let rest = Number.isFinite(totalXp) ? Math.max(0, totalXp) : 0;
  while (rest >= need(L)) {
    rest -= need(L);
    L += 1;
  }
  return { L, into: rest, need: need(L) };
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

export type PartnerCard = {
  turns: number;
  level: number;
  bond: number;
  caption: string;
};

/**
 * The chat header, from the same level bar Today draws.
 * `bond` is how far this level is filled, 0–100.
 */
export function partnerFromProgress(input: {
  level: number;
  into: number;
  need: number;
  rankName?: string;
  totalXp?: number;
}): PartnerCard {
  const level = Number.isFinite(input.level) ? Math.max(1, Math.floor(input.level)) : 1;
  const needXp = Number.isFinite(input.need) && input.need > 0 ? input.need : 1;
  const into = Number.isFinite(input.into) ? Math.max(0, Math.min(needXp, input.into)) : 0;
  const bond = Math.max(0, Math.min(100, Math.round((into / needXp) * 100)));
  const rank = input.rankName || rankOf(level).name;
  const turns = Number.isFinite(input.totalXp) ? Math.max(0, Math.floor(input.totalXp as number)) : 0;
  return {
    turns,
    level,
    bond,
    caption: `${rank}. ${into} / ${needXp} XP toward the next level.`,
  };
}

/** One Preyas, from all-time XP. The open chat does not change this. */
export function partnerFromAreas(totalXp: number): PartnerCard {
  const total = Number.isFinite(totalXp) ? Math.max(0, Math.floor(totalXp)) : 0;
  const progress = levelOf(total);
  const rank = rankOf(progress.L);
  return partnerFromProgress({
    level: progress.L,
    into: progress.into,
    need: progress.need,
    rankName: rank.name,
    totalXp: total,
  });
}
