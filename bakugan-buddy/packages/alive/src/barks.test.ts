import assert from "node:assert/strict";
import { test } from "node:test";
import { BARKS, BARK_SITUATIONS } from "./data/barks.ts";
import { activeSituation, BarkMemory, pickBark, type BarkTuning } from "./barks.ts";
import type { Mood } from "../../mood/src/index.ts";

const fast: BarkTuning = { lineMs: 10_000, globalMs: 0, situationMs: 40 };

test("lines stay in his voice, not the dev notes", () => {
  const banned = ["chasing is for later", "sleep mode", "malfunction", "ball form", "budget whoop"];
  for (const situation of BARK_SITUATIONS) {
    for (const line of BARKS[situation]) {
      const lower = line.toLowerCase();
      for (const phrase of banned) {
        assert.equal(lower.includes(phrase), false, line);
      }
    }
  }
});

test("every situation has a pool of 10 to 20 lines", () => {
  assert.ok(BARK_SITUATIONS.length >= 8);
  for (const situation of BARK_SITUATIONS) {
    const count = BARKS[situation].length;
    assert.ok(count >= 10 && count <= 20, `${situation} has ${count}`);
  }
});

test("a line plays only when the situation is true", () => {
  const state = new BarkMemory();
  assert.equal(pickBark(null, 0, state, () => 0, fast), null);
  assert.equal(
    activeSituation({
      skill: "sleep",
      hurry: false,
      scanning: false,
      justNoticed: false,
      woke: false,
      fellAsleep: false,
      mood: "neutral" as Mood,
      moodJustChanged: false,
    }),
    null,
  );
  assert.equal(
    activeSituation({
      skill: "idle-roll",
      hurry: false,
      scanning: false,
      justNoticed: false,
      woke: false,
      fellAsleep: false,
      mood: "neutral" as Mood,
      moodJustChanged: false,
    }),
    "idle",
  );
  assert.notEqual(
    activeSituation({
      skill: "idle-roll",
      hurry: true,
      scanning: false,
      justNoticed: false,
      woke: false,
      fellAsleep: false,
      mood: "happy" as Mood,
      moodJustChanged: false,
    }),
    "follow",
  );
  assert.equal(
    activeSituation({
      skill: "follow",
      hurry: false,
      scanning: false,
      justNoticed: false,
      woke: false,
      fellAsleep: true,
      mood: "neutral" as Mood,
      moodJustChanged: false,
    }),
    "sleep",
  );
});

test("cooldowns block a repeat, then the next line, then silence when the pool is spent", () => {
  const state = new BarkMemory();
  const first = pickBark("follow", 0, state, () => 0, fast);
  assert.ok(first);
  assert.equal(pickBark("follow", 10, state, () => 0.2, fast), null);
  const seen = new Set<string>([first!]);
  let now = 50;
  for (let i = 1; i < BARKS.follow.length; i++) {
    const line = pickBark("follow", now, state, () => 0, fast);
    assert.ok(line, `line ${i}`);
    assert.equal(seen.has(line!), false);
    seen.add(line!);
    now += 50;
  }
  assert.equal(seen.size, BARKS.follow.length);
  assert.equal(pickBark("follow", now, state, () => 0.5, fast), null);
  assert.equal(pickBark("follow", now + 30, state, () => 0.9, fast), null);
});

test("a line stays out of the recent window even after the situation gap", () => {
  const state = new BarkMemory(4);
  const tuning: BarkTuning = { lineMs: 50_000, globalMs: 0, situationMs: 10 };
  const recent: string[] = [];
  let now = 0;
  for (let i = 0; i < 4; i++) {
    const line = pickBark("scan", now, state, () => i / 20, tuning);
    assert.ok(line);
    recent.push(line!);
    now += 20;
  }
  const next = pickBark("scan", now, state, () => 0, tuning);
  assert.ok(next);
  assert.equal(recent.includes(next!), false);
});
