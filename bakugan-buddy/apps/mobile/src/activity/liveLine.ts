/**
 * The words for the one-line indicator above the composer while a reply is in
 * flight. A running step names itself ("Searching web…"); before any step has
 * arrived the wait is said honestly. Nothing active, nothing finished: no line.
 */
import { labelFor, runOf, type ActivityState } from "../../../../packages/alive/src/activity.ts";

/** What the line says before the brain has reported a step of its own. */
export const WAITING_LINE = "Preyas is thinking…";

export function liveLine(state: ActivityState, runId: string, active: boolean): string {
  if (!active || !runId) return "";
  const run = runOf(state, runId);
  if (!run) return WAITING_LINE;
  for (let i = run.order.length - 1; i >= 0; i -= 1) {
    const step = run.byId[run.order[i]];
    if (step && step.status === "running") return labelFor(step.tool, "running");
  }
  return run.open ? WAITING_LINE : "";
}
