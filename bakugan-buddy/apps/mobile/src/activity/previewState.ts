/**
 * Conditions for the corner preview, kept pure so they are tested without a
 * browser.
 */
import type { ActivityRun } from "../../../../packages/alive/src/activity.ts";

/** How long the card lingers after the run ends. */
export const PREVIEW_LINGER_MS = 8_000;

/** The tool whose frames feed the card. */
export const PREVIEW_TOOLS: readonly string[] = ["screen", "browser"];

/** A screen or browser step is running, or a frame step has arrived. */
export function wantsPreview(run: ActivityRun | undefined): boolean {
  if (!run) return false;
  return run.order.some((id) => {
    const step = run.byId[id];
    if (!step) return false;
    return PREVIEW_TOOLS.includes(step.tool) || step.kind === "frame" || Boolean(step.frame);
  });
}

/** True only while a screen or browser step is still running. */
export function previewRunning(run: ActivityRun | undefined): boolean {
  if (!run) return false;
  return run.order.some((id) => {
    const step = run.byId[id];
    return Boolean(step && PREVIEW_TOOLS.includes(step.tool) && step.status === "running");
  });
}

/** The newest frame a step reported, if any. */
export function latestFrameId(run: ActivityRun | undefined): string {
  if (!run) return "";
  let best: { seq: number; id: string } | null = null;
  for (const id of run.order) {
    const step = run.byId[id];
    if (!step?.frame?.id) continue;
    if (!best || step.seq > best.seq) best = { seq: step.seq, id: step.frame.id };
  }
  return best?.id ?? "";
}

/** "Screen" unless the run only ever browsed. */
export function previewTitle(run: ActivityRun | undefined): string {
  if (!run) return "Screen";
  const tools = run.order.map((id) => run.byId[id]).filter(Boolean);
  const anyScreen = tools.some((step) => step!.tool === "screen" || step!.kind === "frame");
  if (anyScreen) return "Screen";
  const anyBrowser = tools.some((step) => step!.tool === "browser");
  return anyBrowser ? "Browser" : "Screen";
}

/** True once the run has ended and the 8 s linger is over. */
export function previewExpired(run: ActivityRun | undefined, now: number): boolean {
  if (!run) return true;
  if (run.open || run.endedAt === undefined) return false;
  return now - run.endedAt > PREVIEW_LINGER_MS;
}
