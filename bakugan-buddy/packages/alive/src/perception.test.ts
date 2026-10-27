import assert from "node:assert/strict";
import { test } from "node:test";
import { AliveController } from "./controller.ts";
import { exportMemory } from "./memory.ts";
import { makeSlot, tickNotice } from "./perception.ts";
import { NOTICE_MS } from "./tuning.ts";
import type { AliveInput } from "./types.ts";

test("he does not notice before the timer fills", () => {
  const slot = makeSlot("player", "partner");
  const result = tickNotice(slot, true, 1, 2, 500, 5_000, NOTICE_MS);
  assert.equal(result, "none");
  assert.equal(slot.noticed, false);
  assert.equal(slot.lastAt, 0);
});

test("a full look notices, and the log keeps the name and timestamp", () => {
  const sim = new AliveController({ x: 0, z: 0, noticeMs: NOTICE_MS, seed: 4 });
  const input: AliveInput = {
    nowMs: 0,
    dt: 0.05,
    playerX: 1,
    playerZ: -0.4,
    playerVisible: true,
    camForwardX: 0,
    camForwardZ: -1,
    sleepRequested: false,
    summon: false,
    moodOverride: null,
  };
  let noticedAt = -1;
  for (let i = 0; i < 30; i++) {
    input.nowMs += 50;
    const frame = sim.tick(input);
    if (frame.noticedPlayer && noticedAt < 0) noticedAt = input.nowMs;
  }
  assert.ok(noticedAt >= NOTICE_MS);
  assert.ok(noticedAt < NOTICE_MS + 80);
  const file = exportMemory(sim.log, sim.facts);
  const event = file.events.find((item) => item.name === "noticed" && item.detail === "partner");
  assert.ok(event);
  assert.equal(event!.t, noticedAt);
  assert.equal(event!.name, "noticed");
  const raw = sim.exportSnapshot();
  const parsed = JSON.parse(raw) as { events: { t: number; name: string }[] };
  assert.equal(parsed.events.some((item) => item.name === "noticed" && item.t === noticedAt), true);
});

test("looking away before the timer clears it", () => {
  const slot = makeSlot("player", "partner");
  tickNotice(slot, true, 1, 2, 400, 1_000, NOTICE_MS);
  assert.equal(slot.seenMs, 400);
  tickNotice(slot, false, 9, 9, 100, 1_100, NOTICE_MS);
  assert.equal(slot.seenMs, 0);
  assert.equal(slot.noticed, false);
  tickNotice(slot, true, 1, 2, 400, 1_500, NOTICE_MS);
  assert.equal(slot.noticed, false);
  assert.equal(slot.seenMs, 400);
});

test("last-known position freezes when the partner leaves view", () => {
  const slot = makeSlot("player", "partner");
  assert.equal(tickNotice(slot, true, 2, 3, NOTICE_MS, 8_000, NOTICE_MS), "noticed");
  assert.equal(slot.lastX, 2);
  assert.equal(slot.lastZ, 3);
  tickNotice(slot, false, 80, -40, 500, 9_000, NOTICE_MS);
  assert.equal(slot.noticed, false);
  assert.equal(slot.lastX, 2);
  assert.equal(slot.lastZ, 3);
  assert.equal(slot.lastAt, 8_000);
  tickNotice(slot, true, 4, 5, 16, 9_500, NOTICE_MS);
  assert.equal(slot.noticed, false);
  assert.equal(slot.lastX, 2);
  assert.equal(slot.lastZ, 3);
  assert.equal(tickNotice(slot, true, 4, 5, NOTICE_MS, 11_000, NOTICE_MS), "noticed");
  assert.equal(slot.lastX, 4);
  assert.equal(slot.lastZ, 5);
  assert.equal(slot.lastAt, 11_000);
});

test("a saved log reloads names without moving him", () => {
  const sim = new AliveController({ x: 1.25, z: -0.5, seed: 5 });
  const input: AliveInput = {
    nowMs: 1_700_000_000_000,
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
  for (let i = 0; i < 25; i++) {
    input.nowMs += 50;
    sim.tick(input);
  }
  const json = sim.exportSnapshot();
  const next = new AliveController({ x: 1.25, z: -0.5, seed: 5 });
  assert.equal(next.loadSnapshot(json), true);
  assert.equal(next.x, 1.25);
  assert.equal(next.z, -0.5);
  const file = exportMemory(next.log, next.facts);
  assert.ok(file.events.some((event) => event.name === "noticed" && event.detail === "partner"));
  assert.equal(typeof file.events[0]!.t, "number");
  assert.equal(next.loadSnapshot("{"), false);
});
