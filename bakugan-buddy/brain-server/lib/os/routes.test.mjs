import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { handleOsRoute } from "./routes.mjs";
import { readEvents } from "./events.mjs";

function fakeRes() {
  const out = { status: 0, headers: {}, body: "" };
  return {
    out,
    res: {
      writeHead(status, headers) {
        out.status = status;
        out.headers = headers || {};
      },
      end(body) {
        out.body = String(body);
      },
    },
  };
}

/** A pinned time zone for route tests so "today" is the same on every machine. */
function pinTimeZone(dir) {
  fs.mkdirSync(path.join(dir, "settings"), { recursive: true });
  fs.writeFileSync(path.join(dir, "settings", "events.json"), JSON.stringify({ tz: "Europe/Warsaw", currency: "KZT" }));
}

function ctx({ pathname, dataDir, method = "GET", body = null, badJson = false, now = null }) {
  return {
    req: { method },
    url: { pathname },
    dataDir,
    readJson: badJson
      ? async () => {
          throw { status: 400, message: "bad json" };
        }
      : async () => JSON.parse(body ?? "{}"),
    readBody: async () => Buffer.from(body ?? ""),
    now: () => {
      if (typeof now === "function") {
        const value = now();
        return value instanceof Date ? value : new Date(value);
      }
      return now ? new Date(now) : new Date("2026-11-18T23:00:00.000Z");
    },
  };
}

test("GET /v1/persona answers with the persona view", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "os-routes-"));
  try {
    const { res, out } = fakeRes();
    const answered = await handleOsRoute({ ...ctx({ pathname: "/v1/persona", dataDir: dir }), res });
    assert.equal(answered, true);
    assert.equal(out.status, 200);
    const body = JSON.parse(out.body);
    assert.equal(typeof body.text, "string");
    assert.ok(body.text.length > 0);
    assert.equal(body.rev, 1);
    assert.equal(body.source, "default");
    assert.ok(body.text.includes("[[ASK_PAID]]"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("GET /v1/persona/versions lists revisions without the text", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "os-routes-versions-"));
  try {
    const { res, out } = fakeRes();
    const answered = await handleOsRoute({ ...ctx({ pathname: "/v1/persona/versions", dataDir: dir }), res });
    assert.equal(answered, true);
    const body = JSON.parse(out.body);
    assert.ok(Array.isArray(body.versions));
    for (const record of body.versions) {
      assert.equal(typeof record.rev, "number");
      assert.ok(!("text" in record), "revision lines carry no persona text");
    }
    assert.equal(body.versions.length, 0, "no persona loaded yet");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("an unknown path returns false", async () => {
  const { res } = fakeRes();
  const answered = await handleOsRoute({ ...ctx({ pathname: "/v1/nothing", dataDir: "" }), res });
  assert.equal(answered, false);
});

test("a broken dataDir never throws", async () => {
  const { res, out } = fakeRes();
  const answered = await handleOsRoute({ ...ctx({ pathname: "/v1/persona", dataDir: "/dev/null/persona" }), res });
  assert.equal(answered, true);
  assert.equal(out.status, 200);
  const body = JSON.parse(out.body);
  assert.equal(body.usedDefault, true);
  assert.ok(body.warnings.length > 0);
});

test("GET /v1/persona works when ctx.now returns a number (as proxy.mjs passes)", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "os-routes-now-"));
  try {
    let status = 0;
    let body = "";
    const res = { writeHead(code) { status = code; }, end(text) { body = text; } };
    const handled = await handleOsRoute({ req: { method: "GET" }, res, url: new URL("http://x/v1/persona"), dataDir, now: () => Date.now() });
    assert.equal(handled, true);
    assert.equal(status, 200);
    assert.equal(JSON.parse(body).rev, 1);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("route: GET /v1/rpg/today on an empty log answers zeros with six quests", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "os-rpg-"));
  try {
    pinTimeZone(dir);
    const { res, out } = fakeRes();
    const answered = await handleOsRoute({ ...ctx({ pathname: "/v1/rpg/today", dataDir: dir }), res });
    assert.equal(answered, true);
    assert.equal(out.status, 200);
    const body = JSON.parse(out.body);
    assert.deepEqual(body.areaXp, { body: 0, intel: 0, money: 0, spirit: 0, craft: 0, goal: 0 });
    assert.equal(body.todayXp, 0);
    assert.deepEqual(
      body.quests.map((quest) => [quest.id, quest.done]),
      [
        ["meal", false],
        ["water", false],
        ["focus", false],
        ["mood", false],
        ["money", false],
        ["craft", false],
      ],
    );
    assert.equal(body.paths.length, 5);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("route: POST /v1/rpg/water appends one event and returns the fresh today", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "os-rpg-water-"));
  try {
    pinTimeZone(dir);
    const { res, out } = fakeRes();
    const answered = await handleOsRoute({
      ...ctx({ pathname: "/v1/rpg/water", dataDir: dir, method: "POST", body: JSON.stringify({ glasses: 1 }) }),
      res,
    });
    assert.equal(answered, true);
    assert.equal(out.status, 200);
    const body = JSON.parse(out.body);
    const water = body.quests.find((quest) => quest.id === "water");
    assert.equal(water.sub, "1/6");
    assert.equal(water.done, false);
    assert.equal(body.areaXp.body, 1);
    const events = readEvents(dir);
    assert.equal(events.length, 1);
    assert.equal(events[0].type, "water");
    assert.deepEqual(events[0].data, { glasses: 1 });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("route: POST /v1/rpg/quest toggles a quest on and off", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "os-rpg-quest-"));
  try {
    pinTimeZone(dir);
    // Each post is its own request in real life, so the clock moves on.
    let nowMs = Date.parse("2026-11-18T23:00:00.000Z");
    const on = fakeRes();
    const onHandled = await handleOsRoute({
      ...ctx({
        pathname: "/v1/rpg/quest",
        dataDir: dir,
        method: "POST",
        body: JSON.stringify({ questId: "meal", done: true }),
        now: () => new Date(nowMs),
      }),
      res: on.res,
    });
    assert.equal(onHandled, true);
    const onBody = JSON.parse(on.out.body);
    assert.equal(onBody.quests.find((quest) => quest.id === "meal").done, true);
    assert.equal(onBody.areaXp.body, 5);

    nowMs += 1000;
    const off = fakeRes();
    await handleOsRoute({
      ...ctx({
        pathname: "/v1/rpg/quest",
        dataDir: dir,
        method: "POST",
        body: JSON.stringify({ questId: "meal", done: false }),
        now: () => new Date(nowMs),
      }),
      res: off.res,
    });
    const offBody = JSON.parse(off.out.body);
    assert.equal(offBody.quests.find((quest) => quest.id === "meal").done, false);
    assert.equal(offBody.areaXp.body, 0);
    assert.equal(readEvents(dir).length, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("route: POST /v1/rpg/focus 25 minutes ticks the focus quest", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "os-rpg-focus-"));
  try {
    pinTimeZone(dir);
    const { res, out } = fakeRes();
    await handleOsRoute({
      ...ctx({ pathname: "/v1/rpg/focus", dataDir: dir, method: "POST", body: JSON.stringify({ minutes: 25, area: "intel" }) }),
      res,
    });
    const body = JSON.parse(out.body);
    const focus = body.quests.find((quest) => quest.id === "focus");
    assert.equal(focus.done, true);
    assert.equal(focus.sub, "25/25");
    assert.equal(body.areaXp.intel, 10);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("route: POST /v1/rpg/mood saves the score and a cleaned note", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "os-rpg-mood-"));
  try {
    pinTimeZone(dir);
    const { res, out } = fakeRes();
    await handleOsRoute({
      ...ctx({ pathname: "/v1/rpg/mood", dataDir: dir, method: "POST", body: JSON.stringify({ score: 4, note: "  calm   day " }) }),
      res,
    });
    const body = JSON.parse(out.body);
    assert.equal(body.quests.find((quest) => quest.id === "mood").done, true);
    assert.equal(body.areaXp.spirit, 8);
    const events = readEvents(dir);
    assert.equal(events.length, 1);
    assert.deepEqual(events[0].data, { score: 4, note: "calm day" });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("route: bad rpg input is refused with 400 and writes nothing", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "os-rpg-bad-"));
  try {
    pinTimeZone(dir);
    const badBodies = [
      ["/v1/rpg/water", { glasses: 9 }],
      ["/v1/rpg/water", { glasses: 0 }],
      ["/v1/rpg/focus", { minutes: 300, area: "intel" }],
      ["/v1/rpg/focus", { minutes: 10, area: "body" }],
      ["/v1/rpg/quest", { questId: "nope", done: true }],
      ["/v1/rpg/quest", { questId: "meal", done: "yes" }],
      ["/v1/rpg/mood", { score: 9 }],
      ["/v1/rpg/mood", { score: 2, note: 42 }],
    ];
    for (const [pathname, body] of badBodies) {
      const { res, out } = fakeRes();
      await handleOsRoute({ ...ctx({ pathname, dataDir: dir, method: "POST", body: JSON.stringify(body) }), res });
      assert.equal(out.status, 400, `${pathname} ${JSON.stringify(body)} must be refused`);
    }
    const broken = fakeRes();
    await handleOsRoute({ ...ctx({ pathname: "/v1/rpg/mood", dataDir: dir, method: "POST", body: "{", badJson: true }), res: broken.res });
    assert.equal(broken.out.status, 400);
    assert.equal(readEvents(dir).length, 0, "nothing was written");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("route: a food event through POST /v1/events/log ticks meal in GET /v1/rpg/today", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "os-rpg-chain-"));
  try {
    pinTimeZone(dir);
    const log = fakeRes();
    await handleOsRoute({
      ...ctx({ pathname: "/v1/events/log", dataDir: dir, method: "POST", body: JSON.stringify({ text: "I ate a sandwich", src: "chat" }) }),
      res: log.res,
    });
    const logBody = JSON.parse(log.out.body);
    assert.equal(logBody.saved, true);

    const today = fakeRes();
    await handleOsRoute({ ...ctx({ pathname: "/v1/rpg/today", dataDir: dir }), res: today.res });
    const body = JSON.parse(today.out.body);
    assert.equal(body.quests.find((quest) => quest.id === "meal").done, true);
    assert.equal(body.areaXp.body, 8, "3 XP for the food plus the +5 meal bonus");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
