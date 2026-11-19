import assert from "node:assert/strict";
import test from "node:test";
import {
  activityReducer,
  clipDetail,
  emptyActivity,
  isActivityEvent,
  labelFor,
  newestFinished,
  summary,
  type ActivityEvent,
} from "./activity.ts";

function ev(overrides: Partial<ActivityEvent> = {}): ActivityEvent {
  return {
    v: 1,
    id: "e1",
    seq: 1,
    runId: "r-1",
    ts: 1_000,
    kind: "tool",
    tool: "search_web",
    label: "Searched web",
    status: "running",
    startedAt: 1_000,
    ...overrides,
  };
}

test("the shape validator accepts a good event", () => {
  assert.equal(isActivityEvent(ev()), true);
  assert.equal(isActivityEvent(ev({ detail: "weather", status: "done", endedAt: 1_500, durationMs: 500 })), true);
  assert.equal(isActivityEvent(ev({ kind: "frame", frame: { id: "f1", w: 640, h: 400 } })), true);
});

test("the shape validator rejects what the UI must never see", () => {
  const { seq: _seq, ...noSeq } = ev();
  assert.equal(isActivityEvent(noSeq), false);
  const { label: _label, ...noLabel } = ev();
  assert.equal(isActivityEvent(noLabel), false);
  const { runId: _run, ...noRun } = ev();
  assert.equal(isActivityEvent(noRun), false);
  assert.equal(isActivityEvent(ev({ status: "fine" as unknown as ActivityEvent["status"] })), false);
  assert.equal(isActivityEvent(ev({ seq: "3" as unknown as number })), false);
  assert.equal(isActivityEvent(ev({ v: 2 as unknown as 1 })), false);
  assert.equal(isActivityEvent(null), false);
  assert.equal(isActivityEvent("event"), false);
});

test("labelFor keeps the thinking time in whole seconds", () => {
  assert.equal(labelFor("think", "done", 5_200), "Thought 5s");
  assert.equal(labelFor("think", "done", 300), "Thought 1s");
  assert.equal(labelFor("think", "running"), "Thinking…");
  assert.equal(labelFor("search_web", "running"), "Searching web…");
  assert.equal(labelFor("search_web", "done"), "Searched web");
  assert.equal(labelFor("read_file", "error"), "Read file");
  assert.equal(labelFor("mystery_tool", "running"), "Running mystery_tool…");
  assert.equal(labelFor("mystery_tool", "done"), "Ran mystery_tool");
});

test("the reducer merges running into done", () => {
  let state = activityReducer(emptyActivity(), ev());
  assert.equal(state.runs["r-1"]!.open, true);
  state = activityReducer(state, ev({ seq: 2, status: "done", label: "Searched web", endedAt: 3_400, durationMs: 2_400 }));
  const run = state.runs["r-1"]!;
  assert.equal(run.order.length, 1);
  assert.equal(run.byId.e1!.status, "done");
  assert.equal(run.byId.e1!.endedAt, 3_400);
  assert.equal(run.byId.e1!.durationMs, 2_400);
  assert.equal(run.open, false);
  assert.equal(run.lastSeq, 2);
});

test("the reducer ignores a duplicate from an old poll", () => {
  let state = activityReducer(emptyActivity(), ev());
  state = activityReducer(state, ev({ id: "e2", seq: 2, status: "done" }));
  const before = state;
  const after = activityReducer(state, ev({ id: "e9", seq: 1, status: "done", ts: 9_999 }));
  assert.equal(after, before);
  assert.equal(after.runs["r-1"]!.order.length, 2);
});

test("steps stay ordered by their first seq, whatever order they arrive in", () => {
  let state = activityReducer(emptyActivity(), ev({ id: "a", seq: 1 }));
  state = activityReducer(state, ev({ id: "b", seq: 2 }));
  state = activityReducer(state, ev({ id: "c", seq: 3 }));
  // b finishes later: it merges in place and does not jump to the end.
  state = activityReducer(state, ev({ id: "b", seq: 4, status: "done" }));
  assert.deepEqual(state.runs["r-1"]!.order, ["a", "b", "c"]);
  assert.equal(state.runs["r-1"]!.open, true);
});

test("two runs stay apart", () => {
  let state = activityReducer(emptyActivity(), ev({ runId: "r-1" }));
  state = activityReducer(state, ev({ id: "x", seq: 2, runId: "r-2", tool: "read_file" }));
  assert.deepEqual(Object.keys(state.runs).sort(), ["r-1", "r-2"]);
  assert.equal(state.runs["r-1"]!.order.length, 1);
  assert.equal(state.runs["r-2"]!.order.length, 1);
  assert.equal(state.runs["r-2"]!.byId.x!.tool, "read_file");
});

test("summary reads like the panel header", () => {
  let state = activityReducer(emptyActivity(), ev({ ts: 1_000, startedAt: 1_000 }));
  state = activityReducer(state, ev({ id: "e1", seq: 2, status: "done", endedAt: 4_000 }));
  state = activityReducer(
    state,
    ev({ id: "e2", seq: 3, ts: 1_100, startedAt: 1_100, tool: "think" }),
  );
  state = activityReducer(state, ev({ id: "e2", seq: 4, status: "done", endedAt: 13_100 }));
  assert.equal(state.runs["r-1"]!.open, false);
  const run = state.runs["r-1"]!;
  // Two rows, the last one finished 12.1 s after the first one started.
  assert.equal(summary(run), "2 steps · 12s");
  state = activityReducer(state, ev({ id: "e2", seq: 5, status: "done", endedAt: 13_100 }));
  assert.equal(summary(state.runs["r-1"]), "2 steps · 12s");
});

test("summary counts a single step without an s", () => {
  const state = activityReducer(emptyActivity(), ev({ status: "done", endedAt: 1_400 }));
  assert.equal(summary(state.runs["r-1"]), "1 step · 1s");
  assert.equal(summary(undefined), "");
});

test("newestFinished reports the latest finished step for the live region", () => {
  let state = activityReducer(emptyActivity(), ev({ id: "a", seq: 1, tool: "think" }));
  assert.equal(newestFinished(state.runs["r-1"]), null);
  state = activityReducer(state, ev({ id: "b", seq: 2, tool: "read_file" }));
  state = activityReducer(state, ev({ id: "a", seq: 3, status: "done" }));
  assert.equal(newestFinished(state.runs["r-1"])!.id, "a");
});

test("clipDetail collapses whitespace and caps at 120 characters", () => {
  assert.equal(clipDetail("  the   weather\n in Oslo "), "the weather in Oslo");
  const long = "x".repeat(200);
  const clipped = clipDetail(long);
  assert.equal(clipped.length, 120);
  assert.equal(clipped.endsWith("…"), true);
  assert.equal(clipDetail(long.slice(0, 120)).length, 120);
  assert.equal(clipDetail(undefined), "");
});
