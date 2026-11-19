import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { appendEvent } from "./events.mjs";
import { focusEvent, moodEvent, questEvent, rpgToday, waterEvent, XP_TABLE, DAILY_QUEST_DEFS } from "./rpg.mjs";

const TZ = "Europe/Warsaw";
/** Local noon in Warsaw, so the "today" of rpgToday is 2026-11-18. */
const NOW = Date.UTC(2026, 10, 18, 11, 0, 0);
const TODAY = "2026-11-18";
const YESTERDAY = "2026-11-17";

let seq = 0;

function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rpg-test-"));
  // Pin the time zone so the tests never depend on the machine's zone.
  fs.mkdirSync(path.join(dir, "settings"), { recursive: true });
  fs.writeFileSync(path.join(dir, "settings", "events.json"), JSON.stringify({ tz: TZ, currency: "KZT" }));
  return dir;
}

/** Appends one raw event line with a unique, sortable id and the given day. */
function log(dir, type, data, { day = TODAY, ts = NOW } = {}) {
  seq += 1;
  const event = {
    v: 1,
    id: `evt_${String(seq).padStart(4, "0")}`,
    ts,
    day,
    type,
    data,
    src: "tool",
    raw: "",
    parser: "p1",
  };
  appendEvent(dir, event);
  return event;
}

/** The areaXp row all zeros looks like. */
const ZERO_AREAS = { body: 0, intel: 0, money: 0, spirit: 0, craft: 0, goal: 0 };

function questById(today, id) {
  return today.quests.find((quest) => quest.id === id);
}

test("empty log gives zeros and six undone quests", () => {
  const dir = tempDir();
  try {
    const today = rpgToday(dir, new Date(NOW));
    assert.deepEqual(today.areaXp, ZERO_AREAS);
    assert.equal(today.todayXp, 0);
    assert.deepEqual(
      today.quests.map((quest) => [quest.id, quest.done]),
      [
        ["meal", false],
        ["water", false],
        ["focus", false],
        ["mood", false],
        ["money", false],
        ["craft", false],
      ],
    );
    assert.equal(questById(today, "water").sub, "0/6");
    assert.equal(questById(today, "focus").sub, "0/25");
    assert.equal(questById(today, "craft").sub, "0/30");
    assert.equal(questById(today, "meal").sub, undefined);
    assert.deepEqual(today.paths.map((path) => [path.id, path.pct]), [
      ["house", 0],
      ["car", 0],
      ["study", 0],
      ["bakugan-buddy", 0],
      ["studio", 0],
    ]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a food event ticks meal and gives 3+5 body", () => {
  const dir = tempDir();
  try {
    log(dir, "food", { item: "pizza", meal: "lunch" });
    const today = rpgToday(dir, new Date(NOW));
    assert.equal(questById(today, "meal").done, true);
    assert.equal(today.areaXp.body, 3 + 5);
    assert.equal(today.todayXp, 8);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("water 2+4 glasses ticks water with sub 6/6", () => {
  const dir = tempDir();
  try {
    log(dir, "water", { glasses: 2 });
    log(dir, "water", { glasses: 4 });
    const today = rpgToday(dir, new Date(NOW));
    assert.equal(questById(today, "water").done, true);
    assert.equal(questById(today, "water").sub, "6/6");
    assert.equal(today.areaXp.body, 2 * XP_TABLE.water.xpPerGlass + 4 * XP_TABLE.water.xpPerGlass + 5);
    assert.equal(today.todayXp, 11);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("focus 10+15 minutes ticks focus with sub 25/25", () => {
  const dir = tempDir();
  try {
    log(dir, "focus", { minutes: 10, area: "intel" });
    log(dir, "focus", { minutes: 15, area: "intel" });
    const today = rpgToday(dir, new Date(NOW));
    assert.equal(questById(today, "focus").done, true);
    assert.equal(questById(today, "focus").sub, "25/25");
    assert.equal(today.areaXp.intel, 2 + 3 + 5);
    assert.equal(today.todayXp, 10);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("an undo event removes its event's XP", () => {
  const dir = tempDir();
  try {
    const food = log(dir, "food", { item: "soup", meal: null });
    log(dir, "undo", { of: food.id });
    const today = rpgToday(dir, new Date(NOW));
    assert.deepEqual(today.areaXp, ZERO_AREAS);
    assert.equal(today.todayXp, 0);
    assert.equal(questById(today, "meal").done, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("yesterday's events count in areaXp but not todayXp or quests", () => {
  const dir = tempDir();
  try {
    log(dir, "food", { item: "yesterday's pizza", meal: "dinner" }, { day: YESTERDAY });
    const today = rpgToday(dir, new Date(NOW));
    // 3 XP for the food plus yesterday's one-time +5 meal bonus, kept forever.
    assert.equal(today.areaXp.body, 8);
    assert.equal(today.todayXp, 0);
    assert.equal(questById(today, "meal").done, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("manual quest toggle on and off", () => {
  const dir = tempDir();
  try {
    log(dir, "quest", { questId: "meal", done: true });
    let today = rpgToday(dir, new Date(NOW));
    assert.equal(questById(today, "meal").done, true);
    assert.equal(today.areaXp.body, 5);
    assert.equal(today.todayXp, 5);

    log(dir, "quest", { questId: "meal", done: false });
    today = rpgToday(dir, new Date(NOW));
    assert.equal(questById(today, "meal").done, false);
    assert.equal(today.areaXp.body, 0);
    assert.equal(today.todayXp, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a later done:false never un-ticks a quest earned by real events", () => {
  const dir = tempDir();
  try {
    log(dir, "food", { item: "pizza", meal: "lunch" });
    log(dir, "quest", { questId: "meal", done: false });
    const today = rpgToday(dir, new Date(NOW));
    assert.equal(questById(today, "meal").done, true);
    assert.equal(today.areaXp.body, 8);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the quest bonus is paid once per day, not once per toggle", () => {
  const dir = tempDir();
  try {
    log(dir, "quest", { questId: "meal", done: true });
    log(dir, "quest", { questId: "meal", done: true });
    const today = rpgToday(dir, new Date(NOW));
    assert.equal(today.areaXp.body, 5);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("mood, money and craft feed their areas and quests", () => {
  const dir = tempDir();
  try {
    log(dir, "mood", { score: 4 });
    log(dir, "money", { amount: 1500, currency: "KZT", direction: "out", category: null, note: null });
    log(dir, "focus", { minutes: 30, area: "craft" });
    const today = rpgToday(dir, new Date(NOW));
    assert.equal(questById(today, "mood").done, true);
    assert.equal(today.areaXp.spirit, 3 + 5);
    assert.equal(questById(today, "money").done, true);
    assert.equal(today.areaXp.money, 2 + 5);
    assert.equal(questById(today, "craft").done, true);
    assert.equal(questById(today, "craft").sub, "30/30");
    assert.equal(today.areaXp.craft, 6 + 5);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a bad paths.json gives zeros and a good one is read and clamped", () => {
  const dir = tempDir();
  try {
    const rpgDir = path.join(dir, "rpg");
    fs.mkdirSync(rpgDir, { recursive: true });
    fs.writeFileSync(path.join(rpgDir, "paths.json"), "{not json");
    assert.deepEqual(rpgToday(dir, new Date(NOW)).paths.map((path) => path.pct), [0, 0, 0, 0, 0]);

    fs.writeFileSync(
      path.join(rpgDir, "paths.json"),
      JSON.stringify({ house: 50, car: 150, study: "x", "bakugan-buddy": 23, studio: -1 }),
    );
    assert.deepEqual(rpgToday(dir, new Date(NOW)).paths.map((path) => path.pct), [50, 100, 0, 23, 0]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("new event shapes are validated like the existing types", () => {
  assert.deepEqual(questEvent({ questId: "meal", done: true }), { ok: true, data: { questId: "meal", done: true } });
  assert.equal(questEvent({ questId: "nope", done: true }).ok, false);
  assert.equal(questEvent({ questId: "meal", done: "yes" }).ok, false);
  assert.equal(questEvent({ questId: "meal" }).ok, false);

  assert.deepEqual(focusEvent({ minutes: 25, area: "intel" }), { ok: true, data: { minutes: 25, area: "intel" } });
  assert.equal(focusEvent({ minutes: 0, area: "intel" }).ok, false);
  assert.equal(focusEvent({ minutes: 241, area: "intel" }).ok, false);
  assert.equal(focusEvent({ minutes: 10.5, area: "intel" }).ok, false);
  assert.equal(focusEvent({ minutes: 10, area: "body" }).ok, false);

  assert.deepEqual(waterEvent({ glasses: 3 }), { ok: true, data: { glasses: 3 } });
  assert.equal(waterEvent({ glasses: 0 }).ok, false);
  assert.equal(waterEvent({ glasses: 4 }).ok, false);
  assert.equal(waterEvent({}).ok, false);

  assert.deepEqual(moodEvent({ score: 5 }), { ok: true, data: { score: 5 } });
  assert.deepEqual(moodEvent({ score: 2, note: "  fine   day " }), { ok: true, data: { score: 2, note: "fine day" } });
  assert.equal(moodEvent({ score: 0 }).ok, false);
  assert.equal(moodEvent({ score: 6 }).ok, false);
  assert.equal(moodEvent({ score: 3, note: 42 }).ok, false);
});

test("every daily quest id lives in the quest table", () => {
  assert.deepEqual(
    DAILY_QUEST_DEFS.map((def) => def.id),
    ["meal", "water", "focus", "mood", "money", "craft"],
  );
});
