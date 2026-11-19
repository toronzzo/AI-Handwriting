/// <reference types="node" />
import assert from "node:assert/strict";
import test from "node:test";
import { buildSnapshot, createLogSource, type LogSource, type TodayReply } from "./logSource.ts";
import { createMockSource } from "./mockSource.ts";
import type { RpgSnapshot } from "./types.ts";

/** A representative GET /v1/rpg/today reply. */
const SAMPLE: TodayReply = {
  areaXp: { body: 8, intel: 10, money: 2, spirit: 3, craft: 0, goal: 0 },
  todayXp: 11,
  quests: [
    { id: "meal", done: true },
    { id: "water", done: false, sub: "3/6" },
    { id: "focus", done: true, sub: "25/25" },
    { id: "mood", done: false },
    { id: "money", done: false },
    { id: "craft", done: false, sub: "0/30" },
  ],
  paths: [
    { id: "house", pct: 12.4 },
    { id: "car", pct: 7.8 },
    { id: "study", pct: 41.5 },
    { id: "bakugan-buddy", pct: 23 },
    { id: "studio", pct: 9 },
  ],
};

function jsonReply(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

/** A fetch stub that records every call and answers through a handler. */
function makeFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchImpl = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    return Promise.resolve(handler(url, init));
  };
  return { fetchImpl, calls };
}

/** The mock's initial snapshot, exactly what source.ts passes as the fallback. */
function demoSnapshot(): RpgSnapshot {
  return createMockSource().get();
}

test("builds a correct snapshot from a sample /v1/rpg/today reply", async () => {
  const { fetchImpl } = makeFetch(() => jsonReply(SAMPLE));
  const source: LogSource = createLogSource({
    brain: "http://brain",
    fetchImpl,
    autoRefresh: false,
    demoFallback: demoSnapshot,
  });

  await source.refreshNow();
  const snapshot = source.get();

  assert.equal(snapshot.isDemo, false);
  assert.deepEqual(snapshot.areaXp, { body: 8, intel: 10, money: 2, spirit: 3, craft: 0, goal: 0 });
  assert.equal(snapshot.totalXp, 23);
  assert.equal(snapshot.level, 1);
  assert.equal(snapshot.levelInto, 23);
  assert.equal(snapshot.levelNeed, 150);
  assert.deepEqual(snapshot.rank, { letter: "E", name: "Rookie" });
  assert.ok(Math.abs(snapshot.areaValue.body - Math.sqrt(8 / 12)) < 1e-9);
  assert.ok(Math.abs(snapshot.areaValue.intel - Math.sqrt(10 / 12)) < 1e-9);
  assert.equal(snapshot.todayXp, 11);
  assert.equal(snapshot.dailyGoal, 50);

  assert.deepEqual(
    snapshot.quests.map((quest) => [quest.id, quest.done, quest.sub]),
    [
      ["meal", true, undefined],
      ["water", false, "3/6"],
      ["focus", true, "25/25"],
      ["mood", false, undefined],
      ["money", false, undefined],
      ["craft", false, "0/30"],
    ],
  );
  // Titles come from quests.ts.
  assert.equal(snapshot.quests[1]?.title, "Drink 6 glasses");
  assert.equal(snapshot.quests[3]?.title, "Log your mood");

  assert.deepEqual(
    snapshot.paths.map((path) => [path.id, path.name, path.pct]),
    [
      ["house", "House", 12.4],
      ["car", "Car", 7.8],
      ["study", "Study", 41.5],
      ["bakugan-buddy", "Bakugan Buddy", 23],
      ["studio", "Studio", 9],
    ],
  );
});

test("keeps the old snapshot when a fetch fails", async () => {
  let fail = false;
  const { fetchImpl } = makeFetch(() => {
    if (fail) throw new Error("network down");
    return jsonReply(SAMPLE);
  });
  const source: LogSource = createLogSource({
    brain: "http://brain",
    fetchImpl,
    autoRefresh: false,
    demoFallback: demoSnapshot,
  });

  await source.refreshNow();
  const good = source.get();
  assert.equal(good.isDemo, false);

  fail = true;
  const notified: RpgSnapshot[] = [];
  source.subscribe((snapshot) => notified.push(snapshot));
  await source.refreshNow();
  assert.deepEqual(source.get(), good, "the last good snapshot is kept");
  assert.equal(notified.length, 0, "a failed fetch does not repaint");
});

test("toggleQuest posts the right body and takes the fresh reply", async () => {
  const { fetchImpl, calls } = makeFetch((url, init) => {
    if (url.endsWith("/v1/rpg/quest")) {
      return jsonReply({
        ...SAMPLE,
        quests: SAMPLE.quests.map((quest) => (quest.id === "meal" ? { ...quest, done: false } : quest)),
      });
    }
    return jsonReply(SAMPLE);
  });
  const source: LogSource = createLogSource({
    brain: "http://brain",
    fetchImpl,
    autoRefresh: false,
    demoFallback: demoSnapshot,
  });

  await source.refreshNow();
  assert.equal(source.get().quests[0]?.done, true, "the sample has meal done");

  await source.toggleQuest("meal");

  const post = calls.find((call) => call.url === "http://brain/v1/rpg/quest");
  assert.ok(post, "toggleQuest must call the brain");
  assert.equal(post?.init?.method, "POST");
  assert.deepEqual(post?.init?.headers && new Headers(post.init.headers).get("Content-Type"), "application/json");
  assert.equal(post?.init?.body, JSON.stringify({ questId: "meal", done: false }));
  assert.equal(source.get().quests[0]?.done, false, "the POST reply becomes the snapshot");
});

test("shows the demo only while the brain cannot be reached on the first load", async () => {
  let fail = true;
  const { fetchImpl } = makeFetch(() => {
    if (fail) throw new Error("network down");
    return jsonReply(SAMPLE);
  });
  const source: LogSource = createLogSource({
    brain: "http://brain",
    fetchImpl,
    autoRefresh: false,
    demoFallback: demoSnapshot,
  });

  assert.equal(source.get().isDemo, true, "no answer yet: the demo hint shows");
  await source.refreshNow();
  assert.equal(source.get().isDemo, true, "the brain is down: still demo");

  fail = false;
  await source.refreshNow();
  assert.equal(source.get().isDemo, false, "the brain answered: real data");
});

test("buildSnapshot zeroes malformed reply fields instead of leaking them", () => {
  const snapshot = buildSnapshot({
    areaXp: { body: Number.NaN, intel: "lots" as unknown as number },
    todayXp: "nope" as unknown as number,
    quests: [{ id: "water", done: true, sub: "1/6" }],
    paths: [{ id: "house", pct: 999 }, { id: "car", pct: -5 }],
  });
  assert.deepEqual(snapshot.areaXp, { body: 0, intel: 0, money: 0, spirit: 0, craft: 0, goal: 0 });
  assert.equal(snapshot.todayXp, 0);
  assert.equal(snapshot.paths[0]?.pct, 100);
  assert.equal(snapshot.paths[1]?.pct, 0);
  assert.equal(snapshot.quests.find((quest) => quest.id === "water")?.done, true);
});
