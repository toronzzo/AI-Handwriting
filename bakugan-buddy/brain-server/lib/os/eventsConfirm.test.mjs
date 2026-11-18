import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { appendEvent, makeId } from "./events.mjs";
import { confirmLine, createSendMemory, formatAmount, formatMinutes, logParsedEvents, normalizeSentence, undoEvents } from "./eventsConfirm.mjs";
import { parseEvents } from "./eventsParse.mjs";

const TZ = "Europe/Warsaw";
const NOW = new Date("2026-11-18T11:00:00.000Z").getTime();

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "confirm-test-"));
}

function logOne(dir, text, now = NOW) {
  const parsed = parseEvents(text, { now, tz: TZ, currency: "KZT", recent: [] });
  return logParsedEvents(dir, parsed, { src: "chat", rawText: text, ts: parsed.ts })[0];
}

test("confirmLine: money, food, stomach, sleep, book, film — English", () => {
  const money = { type: "money", data: { amount: 1500, currency: "KZT", direction: "out", category: "coffee", note: null } };
  assert.equal(confirmLine([money], "en"), "Saved: −1\u00A0500 KZT coffee. Undo for 10 s.");
  const inMoney = { type: "money", data: { amount: 300000, currency: "KZT", direction: "in", category: "salary", note: null } };
  assert.equal(confirmLine([inMoney], "en"), "Saved: +300\u00A0000 KZT salary. Undo for 10 s.");
  const food = { type: "food", data: { item: "pizza", meal: "lunch" } };
  const stomach = { type: "stomach", data: { level: 2, words: ["pain"], foodId: "evt_x" }, _afterItem: null };
  assert.equal(confirmLine([food, stomach], "en"), "Saved: pizza (lunch) and stomach: pain. Undo for 10 s.");
  const sleep = { type: "sleep", data: { minutes: 435, bedtime: null, wake: null } };
  assert.equal(confirmLine([sleep], "en"), "Saved: sleep 7h 15m. Undo for 10 s.");
  const book = { type: "book", data: { title: "Dune", pages: 30, status: "reading", rating: null } };
  assert.equal(confirmLine([book], "en"), "Saved: book: Dune, 30 pages. Undo for 10 s.");
  const film = { type: "film", data: { title: "Dune 2", rating: 8, status: "watched" } };
  assert.equal(confirmLine([film], "en"), "Saved: film: Dune 2, 8/10. Undo for 10 s.");
});

test("confirmLine: Russian text, and the 'after <item>' stomach link", () => {
  const money = { type: "money", data: { amount: 2500, currency: "KZT", direction: "out", category: "transport", note: null } };
  assert.equal(confirmLine([money], "потратил 2 500 тг на такси"), "Сохранено: −2\u00A0500 KZT transport. Отменить можно 10 с.");
  const stomach = { type: "stomach", data: { level: 2, words: ["pain"], foodId: "evt_one" }, _afterItem: "pizza" };
  assert.equal(confirmLine([stomach], "en"), "Saved: stomach: pain after pizza. Undo for 10 s.");
});

test("formatAmount and formatMinutes", () => {
  assert.equal(formatAmount(1500), "1\u00A0500");
  assert.equal(formatAmount(300000), "300\u00A0000");
  assert.equal(formatAmount(6.5), "6.5");
  assert.equal(formatMinutes(420), "7h");
  assert.equal(formatMinutes(440), "7h 20m");
  assert.equal(formatMinutes(45), "45m");
});

test("undo window with injected time: 9.9 s ok, 10.6 s refused, double undo refused", () => {
  const dir = tempDir();
  try {
    const t0 = NOW;
    const event = { v: 1, id: "evt_a", ts: t0, day: "2026-11-18", type: "money", data: { amount: 100, currency: "KZT", direction: "out", category: null, note: null }, src: "chat", raw: "", parser: "p1" };
    appendEvent(dir, event);
    const ok = undoEvents(dir, ["evt_a"], t0 + 9900, { tz: TZ });
    assert.deepEqual(ok.undone, ["evt_a"]);
    const second = undoEvents(dir, ["evt_a"], t0 + 9901, { tz: TZ });
    assert.deepEqual(second.undone, []);
    assert.equal(second.refused[0].reason, "already undone");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  const dir2 = tempDir();
  try {
    const t0 = NOW;
    appendEvent(dir2, { v: 1, id: "evt_b", ts: t0, day: "2026-11-18", type: "food", data: { item: "x", meal: null }, src: "chat", raw: "", parser: "p1" });
    const late = undoEvents(dir2, ["evt_b"], t0 + 10600, { tz: TZ });
    assert.deepEqual(late.undone, []);
    assert.equal(late.refused[0].reason, "It is saved. Corrections come in a later version.");
    const unknown = undoEvents(dir2, ["evt_zzz"], t0, { tz: TZ });
    assert.equal(unknown.refused[0].reason, "unknown id");
  } finally {
    fs.rmSync(dir2, { recursive: true, force: true });
  }
});

test("idempotent double-send memory: 10 s window", () => {
  const memory = createSendMemory();
  memory.put("chat\ni ate", { saved: true, ids: ["evt_1"] }, NOW);
  assert.deepEqual(memory.lookup("chat\ni ate", NOW + 9999), { saved: true, ids: ["evt_1"] });
  assert.equal(memory.lookup("chat\ni ate", NOW + 10001), null);
  assert.equal(normalizeSentence("  Coffee   1500₸ "), "coffee 1500₸");
});

test("logParsedEvents resolves the same-sentence food link and stores no transient fields", () => {
  const dir = tempDir();
  try {
    const parsed = parseEvents("ate pizza, stomach hurts", { now: NOW, tz: TZ, currency: "KZT", recent: [] });
    const events = logParsedEvents(dir, parsed, { src: "chat", rawText: "ate pizza, stomach hurts", ts: parsed.ts });
    assert.equal(events.length, 2);
    const [food, stomach] = events;
    assert.equal(stomach.data.foodId, food.id, "stomach links to the real food id");
    const stored = JSON.parse(fs.readFileSync(path.join(dir, "events", "2026-11.jsonl"), "utf8").split("\n")[0]);
    assert.ok(!("ref" in stored), "ref never stored");
    assert.ok(!("_afterItem" in stored), "transient fields never stored");
    assert.ok(!JSON.stringify(stored.data).includes("@food0"));
    assert.equal(stored.raw, "ate pizza, stomach hurts");
    assert.equal(stored.parser, "p1");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the undo event itself is a normal append", () => {
  const dir = tempDir();
  try {
    const id = logOne(dir, "coffee 1500₸").id;
    const file = path.join(dir, "events", "2026-11.jsonl");
    const before = fs.readFileSync(file, "utf8");
    const result = undoEvents(dir, [id], NOW, { tz: TZ });
    assert.equal(result.undone.length, 1);
    const after = fs.readFileSync(file, "utf8");
    assert.ok(after.startsWith(before));
    const lines = after.trim().split("\n");
    const undoLine = JSON.parse(lines[lines.length - 1]);
    assert.equal(undoLine.type, "undo");
    assert.equal(undoLine.data.of, id);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("makeId is unique enough and stable in shape", () => {
  const a = makeId(NOW);
  const b = makeId(NOW);
  assert.match(a, /^evt_[0-9a-z]+$/);
  assert.notEqual(a, b);
});
