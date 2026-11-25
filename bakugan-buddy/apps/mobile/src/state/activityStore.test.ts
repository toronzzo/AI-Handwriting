/// <reference types="node" />
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  activityIsActive,
  bodyStateFromSignals,
  clearActivity,
  peekActivity,
  publishActivity,
  subscribeActivity,
} from "./activityStore.ts";

const ROOT = process.cwd();

test("with nothing happening the shared answer is resting, never a guess", () => {
  clearActivity();
  assert.equal(peekActivity(), "resting");
  assert.equal(bodyStateFromSignals({}), "resting");
  assert.equal(
    bodyStateFromSignals({ recording: false, speaking: false, working: false, thinking: false }),
    "resting",
  );
  assert.equal(activityIsActive("resting"), false);
});

test("the priority order: mic, then his voice, then work, then thinking", () => {
  assert.equal(bodyStateFromSignals({ recording: true, speaking: true, working: true, thinking: true }), "listening");
  assert.equal(bodyStateFromSignals({ speaking: true, working: true, thinking: true }), "speaking");
  assert.equal(bodyStateFromSignals({ working: true, thinking: true }), "working");
  assert.equal(bodyStateFromSignals({ thinking: true }), "thinking");
  for (const state of ["listening", "thinking", "working", "speaking"] as const) {
    assert.equal(activityIsActive(state), true, `${state} is real activity`);
  }
});

test("a subscriber hears every change and nothing else", () => {
  clearActivity();
  const heard: string[] = [];
  const stop = subscribeActivity((state) => heard.push(state));
  publishActivity("thinking");
  publishActivity("thinking"); // same answer: no duplicate event
  publishActivity("working");
  assert.deepEqual(heard, ["thinking", "working"]);
  assert.equal(peekActivity(), "working");
  stop();
  publishActivity("speaking");
  assert.deepEqual(heard, ["thinking", "working"], "an unsubscribed listener is never called again");
  clearActivity();
  assert.equal(peekActivity(), "resting");
});

test("clearing returns to resting so a stale claim cannot outlive the work", () => {
  publishActivity("working");
  assert.equal(peekActivity(), "working");
  clearActivity();
  assert.equal(peekActivity(), "resting");
  clearActivity();
  assert.equal(peekActivity(), "resting");
});

test("only the chat screen publishes, and every body reads the same answer", () => {
  const publishers = ["src/screens/ChatScreen.tsx"];
  for (const rel of publishers) {
    const source = readFileSync(join(ROOT, rel), "utf8");
    assert.match(source, /publishActivity\(/, `${rel} publishes the measured state`);
    assert.match(source, /clearActivity\(/, `${rel} goes back to resting when it goes away`);
    assert.match(source, /bodyStateFromSignals\(/, `${rel} derives the state from real signals`);
  }
  // Today is the surface that used to lie: it must read the shared answer.
  const level = readFileSync(join(ROOT, "src/today/LevelCard.tsx"), "utf8");
  assert.match(level, /usePreyasActivity\(/, "Today reads the shared activity");
  assert.ok(!/state="resting"/.test(level), "Today may not hardcode a resting body");
});
