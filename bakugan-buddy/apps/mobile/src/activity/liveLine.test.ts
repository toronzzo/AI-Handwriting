import test from "node:test";
import assert from "node:assert/strict";
import { WAITING_LINE, liveLine } from "./liveLine.ts";
import {
  activityReducer,
  emptyActivity,
  type ActivityEvent,
  type ActivityState,
} from "../../../../packages/alive/src/activity.ts";

function step(id: string, seq: number, tool: string, status: ActivityEvent["status"]): ActivityEvent {
  return {
    v: 1,
    id,
    seq,
    runId: "r-1",
    ts: 1000 + seq,
    kind: "tool",
    tool,
    label: "",
    status,
    startedAt: 1000 + seq,
    ...(status === "done" ? { endedAt: 1500 + seq, durationMs: 500 } : {}),
  };
}

function fold(...events: ActivityEvent[]): ActivityState {
  return events.reduce(activityReducer, emptyActivity());
}

test("an idle chat shows no line at all", () => {
  assert.equal(liveLine(emptyActivity(), "r-1", false), "");
});

test("a run with no step yet says he is thinking", () => {
  assert.equal(liveLine(emptyActivity(), "r-1", true), WAITING_LINE);
});

test("a running step names itself", () => {
  const state = fold(step("a", 1, "search_web", "running"));
  assert.equal(liveLine(state, "r-1", true), "Searching web…");
});

test("the newest running step wins over an older one", () => {
  const state = fold(step("a", 1, "search_web", "done"), step("b", 2, "read_file", "running"));
  assert.equal(liveLine(state, "r-1", true), "Reading file…");
});

test("a finished run says nothing, even if the screen still calls it active", () => {
  const state = fold(step("a", 1, "think", "done"));
  assert.equal(liveLine(state, "r-1", true), "");
});

test("another run's steps never leak into this one", () => {
  const state = fold(step("a", 1, "search_web", "running"));
  assert.equal(liveLine(state, "r-2", true), WAITING_LINE);
});
