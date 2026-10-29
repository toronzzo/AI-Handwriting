import assert from "node:assert/strict";
import { test } from "node:test";
import { AliveController } from "./controller.ts";
import { hurryFor, scoreRing, stepToward, type Spot, type StepOut } from "./follow.ts";
import {
  FOLLOW_RING_RADIUS,
  HURRY_DISTANCE,
  HURRY_SPEED,
  MAX_DT,
  SPOT_COUNT,
  WALK_SPEED,
} from "./tuning.ts";
import type { AliveInput } from "./types.ts";

function spots(): Spot[] {
  return Array.from({ length: SPOT_COUNT }, () => ({ x: 0, z: 0, score: 0 }));
}

test("a step never teleports and hurry is faster than a walk", () => {
  const out: StepOut = { x: 0, z: 0, moved: false, hurry: false };
  stepToward(0, 0, 10, 0, 0.05, false, out);
  assert.ok(out.moved);
  assert.ok(out.x <= WALK_SPEED * 0.05 + 1e-9);
  assert.ok(out.x > 0);
  const walked = out.x;

  stepToward(0, 0, 10, 0, 0.05, true, out);
  assert.ok(out.x > walked);
  assert.ok(out.x <= HURRY_SPEED * 0.05 + 1e-9);

  const before = 2;
  stepToward(before, 1, before + 100, 1, 1, true, out);
  const moved = Math.hypot(out.x - before, out.z - 1);
  assert.ok(moved <= HURRY_SPEED * MAX_DT + 1e-9);
  assert.ok(out.x < before + 100);
});

test("inside the dead zone he stays put", () => {
  const out: StepOut = { x: 0, z: 0, moved: false, hurry: false };
  stepToward(1, 1, 1.05, 1.02, 0.05, true, out);
  assert.equal(out.moved, false);
  assert.equal(out.x, 1);
  assert.equal(out.z, 1);
});

test("hurry starts far away and stays hurried across the hysteresis band", () => {
  assert.equal(hurryFor(HURRY_DISTANCE + 0.1, false), true);
  assert.equal(hurryFor(HURRY_DISTANCE - 0.1, false), false);
  assert.equal(hurryFor(HURRY_DISTANCE - 0.2, true), true);
});

test("the ring scores a side spot and never the partner's exact point", () => {
  const ring = spots();
  const winner = scoreRing(0, 0, 2.2, 0.4, 0, -1, ring, -1);
  const spot = ring[winner]!;
  const radius = Math.hypot(spot.x, spot.z);
  assert.ok(Math.abs(radius - FOLLOW_RING_RADIUS) < 1e-9);
  assert.ok(Math.hypot(spot.x, spot.z) > 0.5);
  let worst = 0;
  for (let i = 1; i < ring.length; i++) if (ring[i]!.score < ring[worst]!.score) worst = i;
  assert.ok(ring[winner]!.score > ring[worst]!.score);
  const facing = spot.z * -1;
  assert.ok(Math.abs(facing) < FOLLOW_RING_RADIUS * 0.55);
});

test("the body honors the step cap while following", () => {
  const sim = new AliveController({ x: 0, z: 0, noticeMs: 40, seed: 8 });
  const input: AliveInput = {
    nowMs: 0,
    dt: 0.05,
    playerX: 0,
    playerZ: 0,
    playerVisible: true,
    camForwardX: 0,
    camForwardZ: -1,
    sleepRequested: false,
    summon: false,
    moodOverride: null,
  };
  for (let i = 0; i < 3; i++) {
    input.nowMs += 50;
    sim.tick(input);
  }
  input.playerX = 6;
  input.dt = 1;
  input.nowMs += 1000;
  const beforeX = sim.x;
  const beforeZ = sim.z;
  const frame = sim.tick(input);
  const moved = Math.hypot(frame.x - beforeX, frame.z - beforeZ);
  assert.equal(frame.skill, "follow");
  assert.equal(frame.hurry, true);
  assert.ok(moved <= HURRY_SPEED * MAX_DT + 1e-6);
  assert.ok(Math.hypot(frame.x - input.playerX, frame.z - input.playerZ) > 1);
});
