import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { handleOsRoute } from "./routes.mjs";
import { parseEvents } from "./eventsParse.mjs";
import {
  appendEvent,
  crisisLine,
  dayKey,
  makeId,
  noonInZone,
  readEvents,
  readSettings,
  summarizeDay,
} from "./events.mjs";
import { logParsedEvents } from "./eventsConfirm.mjs";

const TZ = "Europe/Warsaw";
const NOW = new Date("2026-11-18T11:00:00.000Z").getTime();

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "events-test-"));
}

function route({ pathname, dataDir, body, method = "GET", now = NOW, badJson = false }) {
  const out = { status: 0, headers: {}, body: "" };
  const res = {
    writeHead(status, headers) {
      out.status = status;
      out.headers = headers || {};
    },
    end(chunk) {
      out.body = String(chunk);
    },
  };
  const ctx = {
    req: { method },
    url: new URL(`http://localhost${pathname}`),
    dataDir,
    now: () => now,
    readJson: badJson
      ? async () => {
          throw { status: 400, message: "bad json" };
        }
      : async () => JSON.parse(body ?? "{}"),
    readBody: async () => Buffer.from(body ?? ""),
  };
  return { ctx, res, out };
}

function allTextUnder(dir) {
  const texts = [];
  const walk = (current) => {
    for (const name of fs.readdirSync(current)) {
      const full = path.join(current, name);
      if (fs.statSync(full).isDirectory()) walk(full);
      else texts.push(fs.readFileSync(full, "utf8"));
    }
  };
  walk(dir);
  return texts.join("\n");
}

test("append-only: bytes only grow, undo does not rewrite", () => {
  const dir = tempDir();
  try {
    const event = {
      v: 1,
      id: makeId(NOW),
      ts: NOW,
      day: "2026-11-18",
      type: "money",
      data: { amount: 100, currency: "KZT", direction: "out", category: null, note: null },
      src: "tool",
      raw: "x",
      parser: "p1",
    };
    appendEvent(dir, event);
    const file = path.join(dir, "events", "2026-11.jsonl");
    const before = fs.readFileSync(file, "utf8");
    appendEvent(dir, { v: 1, id: makeId(NOW + 1), ts: NOW + 1, day: "2026-11-18", type: "undo", data: { of: event.id }, src: "manual", raw: "", parser: "undo" });
    const after = fs.readFileSync(file, "utf8");
    assert.ok(after.startsWith(before), "earlier bytes must stay untouched");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("torn lines are skipped and undone events are excluded", () => {
  const dir = tempDir();
  try {
    const file = path.join(dir, "events", "2026-11.jsonl");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const a = { v: 1, id: "evt_a", ts: NOW, day: "2026-11-18", type: "food", data: { item: "pizza", meal: null }, src: "tool", raw: "", parser: "p1" };
    const b = { v: 1, id: "evt_b", ts: NOW + 1, day: "2026-11-18", type: "food", data: { item: "soup", meal: null }, src: "tool", raw: "", parser: "p1" };
    const undo = { v: 1, id: "evt_u", ts: NOW + 2, day: "2026-11-18", type: "undo", data: { of: "evt_a" }, src: "manual", raw: "", parser: "undo" };
    fs.writeFileSync(file, [JSON.stringify(a), "{v:1, broken", JSON.stringify(b), JSON.stringify(undo), ""].join("\n"));
    const events = readEvents(dir);
    assert.equal(events.length, 1, "torn line skipped, undone event dropped");
    assert.equal(events[0].id, "evt_b");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("month rollover: day 31 Jan and 1 Feb land in different files", () => {
  const dir = tempDir();
  try {
    const jan = { v: 1, id: "evt_jan", ts: Date.UTC(2026, 0, 31, 23, 30), day: "2026-01-31", type: "food", data: { item: "x", meal: null }, src: "tool", raw: "", parser: "p1" };
    const feb = { v: 1, id: "evt_feb", ts: Date.UTC(2026, 1, 1, 0, 30), day: "2026-02-01", type: "food", data: { item: "y", meal: null }, src: "tool", raw: "", parser: "p1" };
    appendEvent(dir, jan);
    appendEvent(dir, feb);
    assert.ok(fs.existsSync(path.join(dir, "events", "2026-01.jsonl")));
    assert.ok(fs.existsSync(path.join(dir, "events", "2026-02.jsonl")));
    assert.equal(readEvents(dir).length, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("dayKey and noonInZone agree on the local day", () => {
  // 2026-11-18 23:30 Warsaw is still 2026-11-18; noon of that day exists.
  const ts = Date.UTC(2026, 10, 18, 22, 30);
  assert.equal(dayKey(ts, TZ), "2026-11-18");
  const noon = noonInZone(2026, 11, 18, TZ);
  assert.equal(dayKey(noon, TZ), "2026-11-18");
  const hour = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "2-digit", hourCycle: "h23" }).format(new Date(noon));
  assert.equal(Number(hour), 12);
});

test("summarizeDay: money per currency and direction, sleep minutes, pages, counts", () => {
  const dir = tempDir();
  try {
    const events = [
      { v: 1, id: "e1", ts: NOW, day: "2026-11-18", type: "money", data: { amount: 1500, currency: "KZT", direction: "out", category: "coffee", note: null }, src: "tool", raw: "", parser: "p1" },
      { v: 1, id: "e2", ts: NOW, day: "2026-11-18", type: "money", data: { amount: 300000, currency: "KZT", direction: "in", category: "salary", note: null }, src: "tool", raw: "", parser: "p1" },
      { v: 1, id: "e3", ts: NOW, day: "2026-11-18", type: "money", data: { amount: 10, currency: "USD", direction: "out", category: null, note: null }, src: "tool", raw: "", parser: "p1" },
      { v: 1, id: "e4", ts: NOW, day: "2026-11-18", type: "sleep", data: { minutes: 420, bedtime: null, wake: null }, src: "tool", raw: "", parser: "p1" },
      { v: 1, id: "e5", ts: NOW, day: "2026-11-18", type: "book", data: { title: "Dune", pages: 30, status: "reading", rating: null }, src: "tool", raw: "", parser: "p1" },
      { v: 1, id: "e6", ts: NOW, day: "2026-11-18", type: "food", data: { item: "pizza", meal: null }, src: "tool", raw: "", parser: "p1" },
      { v: 1, id: "e7", ts: NOW, day: "2026-11-17", type: "food", data: { item: "old", meal: null }, src: "tool", raw: "", parser: "p1" },
    ];
    for (const event of events) appendEvent(dir, event);
    const summary = summarizeDay(dir, "2026-11-18", { tz: TZ });
    assert.equal(summary.money.out, 1510);
    assert.equal(summary.money.in, 300000);
    assert.deepEqual(summary.money.byCurrency.KZT, { out: 1500, in: 300000 });
    assert.deepEqual(summary.money.byCurrency.USD, { out: 10, in: 0 });
    assert.equal(summary.sleepMinutes, 420);
    assert.equal(summary.pages, 30);
    assert.equal(summary.foodCount, 1, "only the events of that day");
    assert.equal(summary.bookCount, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("redaction: a pasted sk- key never lands in raw", () => {
  const dir = tempDir();
  try {
    const parsed = parseEvents("paid 100 with key sk-abcdef1234567890", { now: NOW, tz: TZ, currency: "KZT", recent: [] });
    logParsedEvents(dir, parsed, { src: "chat", rawText: "paid 100 with key sk-abcdef1234567890", ts: parsed.ts });
    const stored = readEvents(dir, { raw: true });
    assert.equal(stored.length, 1);
    assert.ok(!stored[0].raw.includes("sk-abcdef1234567890"));
    assert.match(stored[0].raw, /sk-\*\*\*/);
    assert.ok(stored[0].raw.length <= 300);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("invalid settings file -> defaults; crisis template has no phone number", () => {
  const dir = tempDir();
  try {
    const settingsDir = path.join(dir, "settings");
    fs.mkdirSync(settingsDir, { recursive: true });
    fs.writeFileSync(path.join(settingsDir, "events.json"), "{not json");
    const settings = readSettings(dir);
    assert.equal(settings.currency, "KZT");
    assert.ok(settings.tz.length > 0);
    assert.equal(crisisLine(dir), "I am not a doctor. Please contact your local emergency number or someone you trust now.");
    fs.writeFileSync(path.join(settingsDir, "crisis.json"), JSON.stringify({ line: "Call your trusted person." }));
    assert.equal(crisisLine(dir), "Call your trusted person.");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("route: POST /v1/events/log saves one event and confirms", async () => {
  const dir = tempDir();
  try {
    const { ctx, res, out } = route({ pathname: "/v1/events/log", dataDir: dir, method: "POST", body: JSON.stringify({ text: "coffee 1500₸" }) });
    const answered = await handleOsRoute({ ...ctx, res });
    assert.equal(answered, true);
    assert.equal(out.status, 200);
    const body = JSON.parse(out.body);
    assert.equal(body.saved, true);
    assert.equal(body.ids.length, 1);
    assert.match(body.line, /Saved: −1\u00A0500 KZT coffee\. Undo for 10 s\./);
    assert.equal(readEvents(dir).length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("route: idempotent double-send returns the first result, nothing new written", async () => {
  const dir = tempDir();
  try {
    const body = JSON.stringify({ text: "tea 500₸", src: "chat" });
    const first = route({ pathname: "/v1/events/log", dataDir: dir, method: "POST", body });
    await handleOsRoute({ ...first.ctx, res: first.res });
    const firstId = JSON.parse(first.out.body).ids[0];
    const second = route({ pathname: "/v1/events/log", dataDir: dir, method: "POST", body });
    await handleOsRoute({ ...second.ctx, res: second.res });
    assert.equal(JSON.parse(second.out.body).ids[0], firstId, "the double send returns the first result");
    assert.equal(readEvents(dir).length, 1, "the double send wrote nothing new");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("route: ask and crisis answers write nothing", async () => {
  const dir = tempDir();
  try {
    const ask = route({ pathname: "/v1/events/log", dataDir: dir, method: "POST", body: JSON.stringify({ text: "I spent a lot" }) });
    await handleOsRoute({ ...ask.ctx, res: ask.res });
    assert.deepEqual(JSON.parse(ask.out.body), { saved: false, ask: "How much?" });
    const crisis = route({ pathname: "/v1/events/log", dataDir: dir, method: "POST", body: JSON.stringify({ text: "I want to kill myself" }) });
    await handleOsRoute({ ...crisis.ctx, res: crisis.res });
    const parsed = JSON.parse(crisis.out.body);
    assert.equal(parsed.saved, false);
    assert.equal(parsed.crisis, true);
    assert.ok(!allTextUnder(dir).includes("kill myself"), "the crisis sentence was written nowhere");
    assert.equal(readEvents(dir).length, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("route: bad JSON and long text are refused", async () => {
  const dir = tempDir();
  try {
    const bad = route({ pathname: "/v1/events/log", dataDir: dir, method: "POST", body: "{", badJson: true });
    await handleOsRoute({ ...bad.ctx, res: bad.res });
    assert.equal(bad.out.status, 400);
    const long = route({ pathname: "/v1/events/log", dataDir: dir, method: "POST", body: JSON.stringify({ text: "x".repeat(2001) }) });
    await handleOsRoute({ ...long.ctx, res: long.res });
    assert.equal(long.out.status, 400);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("route: undo, list, raw flag and summary", async () => {
  const dir = tempDir();
  try {
    const log = route({ pathname: "/v1/events/log", dataDir: dir, method: "POST", body: JSON.stringify({ text: "bread 300₸", src: "chat" }) });
    await handleOsRoute({ ...log.ctx, res: log.res });
    const id = JSON.parse(log.out.body).ids[0];

    const undo = route({ pathname: "/v1/events/undo", dataDir: dir, method: "POST", body: JSON.stringify({ ids: [id] }) });
    await handleOsRoute({ ...undo.ctx, res: undo.res });
    assert.deepEqual(JSON.parse(undo.out.body).undone, [id]);
    assert.equal(readEvents(dir).length, 0, "undone event is gone from reads");

    const again = route({ pathname: "/v1/events/undo", dataDir: dir, method: "POST", body: JSON.stringify({ ids: [id] }) });
    await handleOsRoute({ ...again.ctx, res: again.res });
    assert.deepEqual(JSON.parse(again.out.body).undone, []);
    assert.equal(JSON.parse(again.out.body).refused[0].reason, "already undone");

    const list = route({ pathname: "/v1/events?raw=1", dataDir: dir });
    await handleOsRoute({ ...list.ctx, res: list.res });
    const listBody = JSON.parse(list.out.body);
    assert.ok(Array.isArray(listBody.events));

    const summary = route({ pathname: "/v1/events/summary?day=2026-11-18", dataDir: dir });
    await handleOsRoute({ ...summary.ctx, res: summary.res });
    assert.equal(JSON.parse(summary.out.body).day, "2026-11-18");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
