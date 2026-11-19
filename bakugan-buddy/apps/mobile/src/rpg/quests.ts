/**
 * The six daily quests (slice 5). Each gives a one-time +5 XP bonus in its
 * area per day. `sub` is the progress hint for countable quests ("n/6" and so
 * on); the mock starts them at zero.
 */
import type { QuestState } from "./types.ts";

export const DAILY_QUESTS: QuestState[] = [
  { id: "meal", title: "Log a meal", area: "body", done: false, bonusXp: 5 },
  { id: "water", title: "Drink 6 glasses", area: "body", done: false, sub: "0/6", bonusXp: 5 },
  { id: "focus", title: "Focus 25 min", area: "intel", done: false, sub: "0/25", bonusXp: 5 },
  { id: "mood", title: "Log your mood", area: "spirit", done: false, bonusXp: 5 },
  { id: "money", title: "Log spending", area: "money", done: false, bonusXp: 5 },
  { id: "craft", title: "Craft 30 min", area: "craft", done: false, sub: "0/30", bonusXp: 5 },
];

/** A fresh, not-done copy of the daily quests for a new source. */
export function freshQuests(): QuestState[] {
  return DAILY_QUESTS.map((quest) => ({ ...quest }));
}
