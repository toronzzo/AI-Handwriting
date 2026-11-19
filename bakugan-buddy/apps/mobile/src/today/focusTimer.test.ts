/// <reference types="node" />
import assert from "node:assert/strict";
import test from "node:test";
import { BREAK_MS, pause, remainingMs, reset, resume, start, tick } from "./focusTimer.ts";

const MINUTE = 60_000;
const T0 = 1_700_000_000_000;

test("a normal run counts down from the chosen minutes and never goes negative", () => {
  const run = start(25, T0);
  assert.equal(run.mode, "run");
  assert.equal(remainingMs(run, T0), 25 * MINUTE);
  assert.equal(remainingMs(run, T0 + 10 * MINUTE), 15 * MINUTE);
  assert.equal(remainingMs(run, T0 + 25 * MINUTE), 0);
  assert.equal(remainingMs(run, T0 + 60 * MINUTE), 0);
});

test("pause freezes the remaining time and resume keeps it", () => {
  const run = start(25, T0);
  const paused = pause(run, T0 + 7 * MINUTE);
  assert.equal(paused.mode, "pause");
  assert.equal(remainingMs(paused, T0 + 30 * MINUTE), 18 * MINUTE);

  const resumed = resume(paused, T0 + 30 * MINUTE);
  assert.equal(resumed.mode, "run");
  assert.equal(remainingMs(resumed, T0 + 30 * MINUTE), 18 * MINUTE);
  assert.equal(remainingMs(resumed, T0 + 31 * MINUTE), 17 * MINUTE);
});

test("pause and resume leave non-running states alone", () => {
  const idle = reset();
  assert.equal(pause(idle, T0).mode, "idle");
  assert.equal(resume(idle, T0).mode, "idle");

  const run = start(25, T0);
  const done = tick(run, T0 + 25 * MINUTE);
  assert.equal(done.state.mode, "break");
  assert.equal(pause(done.state, T0).mode, "break");
});

test("tick before the end leaves the run untouched", () => {
  const run = start(25, T0);
  const early = tick(run, T0 + 24 * MINUTE);
  assert.equal(early.completed, null);
  assert.equal(early.state, run);
});

test("tick after the end completes exactly once and starts the break", () => {
  const run = start(25, T0);
  const done = tick(run, T0 + 25 * MINUTE);
  assert.equal(done.completed, 25);
  assert.equal(done.state.mode, "break");
  assert.equal(remainingMs(done.state, T0 + 25 * MINUTE), BREAK_MS);

  // The break state never reports a run completion, however often it ticks.
  const stillBreak = tick(done.state, T0 + 26 * MINUTE);
  assert.equal(stillBreak.completed, null);
  assert.equal(stillBreak.state.mode, "break");
});

test("the break lasts 5 minutes and then goes idle", () => {
  const run = start(25, T0);
  const done = tick(run, T0 + 25 * MINUTE);

  const almostOver = tick(done.state, T0 + 30 * MINUTE - 1);
  assert.equal(almostOver.completed, null);
  assert.equal(almostOver.state.mode, "break");

  const over = tick(done.state, T0 + 30 * MINUTE);
  assert.equal(over.completed, null);
  assert.equal(over.state.mode, "idle");
  assert.equal(remainingMs(over.state, T0 + 30 * MINUTE), 0);
});

test("a hidden tab that ticks late still completes once and lands idle", () => {
  const run = start(25, T0);
  // 60 minutes later: the run and its 5 minute break are both long past.
  const late = tick(run, T0 + 60 * MINUTE);
  assert.equal(late.completed, 25);
  assert.equal(late.state.mode, "break");

  const next = tick(late.state, T0 + 60 * MINUTE + 1000);
  assert.equal(next.completed, null);
  assert.equal(next.state.mode, "idle");
});

test("reset works from every state and leaves nothing behind", () => {
  const idle = reset();
  assert.equal(idle.mode, "idle");
  assert.equal(remainingMs(idle, T0), 0);

  const run = start(15, T0);
  assert.equal(reset().mode, "idle");

  const paused = pause(run, T0 + 1000);
  assert.equal(paused.mode, "pause");
  assert.equal(reset().mode, "idle");

  const done = tick(run, T0 + 15 * MINUTE);
  assert.equal(done.state.mode, "break");
  assert.equal(reset().mode, "idle");
});
