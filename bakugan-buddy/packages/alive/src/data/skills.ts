import type { SkillRecord } from "../types.ts";

/**
 * Priority list for Preyas in his room.
 * The picker does not care about file order — `priority` decides.
 * `idle-roll` is last in priority and always valid, so he never freezes.
 */
export const SKILL_LIST: readonly SkillRecord[] = [
  { id: "sleep", priority: 50, fallback: false },
  { id: "follow", priority: 40, fallback: false },
  { id: "explore", priority: 20, fallback: false },
  { id: "idle-roll", priority: 0, fallback: true },
];
