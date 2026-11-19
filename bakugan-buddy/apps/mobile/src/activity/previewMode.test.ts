import test from "node:test";
import assert from "node:assert/strict";
import { previewMode } from "./previewMode.ts";
import { activityReducer, emptyActivity, type ActivityEvent } from "../../../../packages/alive/src/activity.ts";
import {
  PREVIEW_LINGER_MS,
  latestFrameId,
  previewExpired,
  previewRunning,
  previewTitle,
  wantsPreview,
} from "./previewState.ts";

test("the corner preview has three sizes", () => {
  assert.equal(previewMode(1399), "chip");
  assert.equal(previewMode(1400), "card");
  assert.equal(previewMode(899), "none");
});

test("a wider Mac is always the card and a phone is always nothing", () => {
  assert.equal(previewMode(1440), "card");
  assert.equal(previewMode(1280), "chip");
  assert.equal(previewMode(900), "chip");
  assert.equal(previewMode(390), "none");
  assert.equal(previewMode(Number.NaN), "none");
});

// ---- the preview's conditions (previewState.ts) ----
function step(overrides: Partial<ActivityEvent> = {}): ActivityEvent {
  return {
    v: 1,
    id: "s1",
    seq: 1,
    runId: "r-1",
    ts: 1_000,
    kind: "tool",
    tool: "search_web",
    label: "Searched web",
    status: "done",
    startedAt: 1_000,
    ...overrides,
  };
}

function fold(...events: ActivityEvent[]) {
  return events.reduce(activityReducer, emptyActivity()).runs["r-1"];
}

test("a normal tool run never asks for the preview", () => {
  const run = fold(step(), step({ id: "s2", seq: 2, tool: "read_file" }));
  assert.equal(wantsPreview(run), false);
  assert.equal(wantsPreview(undefined), false);
});

test("a screen step asks for the preview, a frame keeps it", () => {
  const screen = fold(step({ tool: "screen", status: "running" }));
  assert.equal(wantsPreview(screen), true);
  assert.equal(previewRunning(screen), true);
  const browsed = fold(step({ tool: "browser" }));
  assert.equal(wantsPreview(browsed), true);
  assert.equal(previewRunning(browsed), false);
  const frame = fold(step({ kind: "frame", tool: "screen", frame: { id: "f9", w: 640, h: 400 } }));
  assert.equal(wantsPreview(frame), true);
  assert.equal(latestFrameId(frame), "f9");
  assert.equal(previewTitle(frame), "Screen");
  const onlyBrowser = fold(step({ tool: "browser" }));
  assert.equal(previewTitle(onlyBrowser), "Browser");
});

test("the preview hides 8 s after the run ends", () => {
  const run = fold(step({ tool: "screen", status: "done", id: "s1" }));
  assert.equal(previewExpired(run, run.endedAt! + PREVIEW_LINGER_MS - 1), false);
  assert.equal(previewExpired(run, run.endedAt! + PREVIEW_LINGER_MS + 1), true);
  const open = fold(step({ tool: "screen", status: "running" }));
  assert.equal(previewExpired(open, Date.now()), false);
});
