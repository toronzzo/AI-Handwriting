/// <reference types="node" />
import assert from "node:assert/strict";
import test from "node:test";
import { createMockSource } from "./mockSource.ts";
import type { RpgSnapshot } from "./types.ts";

test("the mock starts clearly flagged as demo data", () => {
  const source = createMockSource();
  const snapshot = source.get();
  assert.equal(snapshot.isDemo, true);
  assert.equal(snapshot.todayXp, 20);
  assert.equal(snapshot.dailyGoal, 50);
  assert.deepEqual(snapshot.areaXp, {
    body: 300,
    intel: 250,
    money: 150,
    spirit: 180,
    craft: 90,
    goal: 50,
  });
  assert.equal(snapshot.totalXp, 1020);
  assert.equal(snapshot.quests.length, 6);
  assert.deepEqual(
    snapshot.paths.map((path) => [path.id, path.pct]),
    [
      ["house", 12.4],
      ["car", 7.8],
      ["study", 41.5],
      ["bakugan-buddy", 23],
      ["studio", 9],
    ],
  );
});

test("the snapshot level, XP-in-level and need always agree with totalXp", () => {
  const source = createMockSource();
  const snapshot = source.get();
  // 150 + 180 + 210 + 240 = 780; 1020 - 780 = 240 into level 5, needing 270.
  assert.equal(snapshot.level, 5);
  assert.equal(snapshot.levelInto, 240);
  assert.equal(snapshot.levelNeed, 270);
  assert.deepEqual(snapshot.rank, { letter: "D", name: "Seeker" });
});

test("toggleQuest gives +5 in its area once and toggling off removes it", () => {
  const source = createMockSource();
  const before = source.get().areaXp.body;

  source.toggleQuest?.("meal");
  let snapshot = source.get();
  assert.equal(snapshot.areaXp.body, before + 5);
  assert.equal(snapshot.quests.find((quest) => quest.id === "meal")?.done, true);

  source.toggleQuest?.("meal");
  snapshot = source.get();
  assert.equal(snapshot.areaXp.body, before);
  assert.equal(snapshot.quests.find((quest) => quest.id === "meal")?.done, false);
});

test("each quest pays its bonus into its own area", () => {
  const source = createMockSource();
  const before = source.get().areaXp.intel;
  source.toggleQuest?.("focus");
  const snapshot = source.get();
  assert.equal(snapshot.areaXp.intel, before + 5);
  assert.equal(snapshot.areaXp.body, 300);
});

test("addDemoXp raises totalXp and calls the subscriber", () => {
  const source = createMockSource();
  const seen: RpgSnapshot[] = [];
  const off = source.subscribe((snapshot) => {
    seen.push(snapshot);
  });
  const before = source.get().totalXp;

  source.addDemoXp?.("intel", 10);
  const snapshot = source.get();

  assert.equal(snapshot.areaXp.intel, 260);
  assert.equal(snapshot.totalXp, before + 10);
  assert.equal(seen.length, 1);
  assert.equal(seen[0]?.totalXp, before + 10);
  off();
});

test("addFocus adds Mind XP, at least 2 per session", () => {
  const source = createMockSource();
  const before = source.get().areaXp.intel;

  source.addFocus?.(25);
  assert.equal(source.get().areaXp.intel, before + 5);

  source.addFocus?.(1);
  assert.equal(source.get().areaXp.intel, before + 5 + 2);
});

test("unsubscribe stops calls", () => {
  const source = createMockSource();
  let calls = 0;
  const off = source.subscribe(() => {
    calls += 1;
  });
  off();

  source.addDemoXp?.("craft", 5);
  source.toggleQuest?.("mood");
  assert.equal(calls, 0);
});

test("toggleQuest ignores unknown quest ids without changing anything", () => {
  const source = createMockSource();
  const before = source.get();
  source.toggleQuest?.("no-such-quest");
  assert.deepEqual(source.get().areaXp, before.areaXp);
});

test("get() hands out a fresh snapshot so callers cannot mutate the source", () => {
  const source = createMockSource();
  const first = source.get();
  first.quests[0]!.done = true;
  first.areaXp.body = 0;
  const second = source.get();
  assert.equal(second.areaXp.body, 300);
  assert.equal(second.quests[0]?.done, false);
});
