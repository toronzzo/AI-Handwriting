/// <reference types="node" />
import assert from "node:assert/strict";
import test from "node:test";
import { areaValue, levelOf, rankOf } from "./rpgMath.ts";

test("levelOf(0) is level 1 needing 150 XP", () => {
  assert.deepEqual(levelOf(0), { L: 1, into: 0, need: 150 });
});

test("levelOf(150) is level 2 with nothing into it", () => {
  assert.deepEqual(levelOf(150), { L: 2, into: 0, need: 180 });
});

test("levels keep counting up: 540 XP opens level 4", () => {
  // 150 + 180 + 210 = 540, exactly enough to reach level 4, needing 240.
  assert.deepEqual(levelOf(540), { L: 4, into: 0, need: 240 });
});

test("areaValue grows with the square root and caps at 10", () => {
  assert.equal(areaValue(0), 0);
  assert.equal(areaValue(12), 1);
  assert.equal(areaValue(300), 5);
  assert.equal(areaValue(1200), 10);
  assert.equal(areaValue(4800), 10);
});

test("rankOf: 3 is E, 4 is D, 25 is S", () => {
  assert.deepEqual(rankOf(3), { letter: "E", name: "Rookie" });
  assert.deepEqual(rankOf(4), { letter: "D", name: "Seeker" });
  assert.deepEqual(rankOf(25), { letter: "S", name: "Mythic" });
});
