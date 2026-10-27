import type { SkillContext, SkillId, SkillRecord } from "./types.ts";
import { COMFORT_DISTANCE, LEASH_DISTANCE } from "./tuning.ts";

/**
 * Each skill says whether it wants this frame. The highest priority that
 * wants it wins. Idle-roll always wants it, so the result is never empty.
 * Pure and synchronous — no I/O, no promises.
 */
export function skillWants(id: SkillId, ctx: SkillContext): boolean {
  switch (id) {
    case "idle-roll":
      return true;
    case "follow":
      return followWants(ctx);
    case "sleep":
      return sleepWants(ctx);
    case "explore":
      return exploreWants(ctx);
    default:
      return false;
  }
}

function followWants(ctx: SkillContext): boolean {
  if (!ctx.noticedPlayer) return false;
  if (ctx.summon || ctx.playerMoving) return true;
  if (ctx.sleepRequested) return false;
  if (ctx.distance > LEASH_DISTANCE) return true;
  if (!ctx.settled && ctx.distance > COMFORT_DISTANCE) return true;
  if (ctx.adviceGoal === "follow" && !ctx.settled && ctx.distance > COMFORT_DISTANCE) return true;
  return false;
}

function sleepWants(ctx: SkillContext): boolean {
  if (ctx.playerMoving || ctx.summon) return false;
  if (ctx.sleepRequested) return true;
  if (ctx.adviceGoal === "sleep" && ctx.settled && ctx.distance <= LEASH_DISTANCE) return true;
  return false;
}

function exploreWants(ctx: SkillContext): boolean {
  if (ctx.explorePoints <= 0) return false;
  if (ctx.playerMoving || ctx.summon || ctx.sleepRequested) return false;
  if (ctx.adviceGoal === "sleep") return false;
  if (!ctx.noticedPlayer && !ctx.playerVisible) return true;
  if (ctx.noticedPlayer && ctx.settled && ctx.distance <= LEASH_DISTANCE) return true;
  if (ctx.adviceGoal === "explore" && ctx.settled) return true;
  return false;
}

/**
 * Walks the data list. A goal the mind suggested is used only when that
 * skill's own `wants` is true — a bad suggestion cannot freeze or yank him.
 */
export function pickSkill(list: readonly SkillRecord[], ctx: SkillContext): SkillId {
  let best: SkillId = "idle-roll";
  let bestPriority = -1;
  for (let i = 0; i < list.length; i++) {
    const skill = list[i]!;
    if (!skillWants(skill.id, ctx)) continue;
    if (skill.priority > bestPriority) {
      best = skill.id;
      bestPriority = skill.priority;
    }
  }
  return best;
}
