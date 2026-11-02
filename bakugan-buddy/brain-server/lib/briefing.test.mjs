import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  DEFAULT_TIME,
  factLines,
  gatherFacts,
  hasBriefingToday,
  loadSettings,
  readBriefing,
  readLastBriefingDay,
  saveBriefing,
  saveSettings,
  scheduledAt,
  shouldRun,
  topLine,
  validTime,
  writeBriefing,
  dayKey,
} from "./briefing.mjs";
import { addNote } from "./notes.mjs";
import { addReminder } from "./reminders.mjs";
import { newTask, saveTask } from "./tasks.mjs";

/** Monday 2 Nov 2026, 09:00 Warsaw (CET). */
const NOW = new Date("2026-11-02T08:00:00.000Z");

function drive() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "preyas-briefing-"));
  fs.mkdirSync(path.join(root, "memory"), { recursive: true });
  return { root, done: () => fs.rmSync(root, { recursive: true, force: true }) };
}

function reminderAt(root, text, iso, extra = {}) {
  return addReminder(root, { text, dueAt: iso, repeat: "none", chatId: "c1", ...extra }, NOW.getTime());
}

test("gathering separates overdue from today and ignores later reminders", () => {
  const { root, done } = drive();
  try {
    reminderAt(root, "overdue call", "2026-11-01T08:00:00.000Z"); // Sunday
    reminderAt(root, "today stretch", "2026-11-02T15:00:00.000Z");
    reminderAt(root, "next week", "2026-11-09T08:00:00.000Z");
    const finished = reminderAt(root, "finished", "2026-11-02T06:00:00.000Z");
    const reminders = JSON.parse(fs.readFileSync(path.join(root, "memory", "reminders.json"), "utf8"));
    for (const row of reminders.reminders) if (row.id === finished.id) row.status = "done";
    fs.writeFileSync(path.join(root, "memory", "reminders.json"), JSON.stringify(reminders));

    const facts = gatherFacts(root, { now: NOW });
    assert.deepEqual(facts.overdue.map((row) => row.text), ["overdue call"]);
    assert.deepEqual(facts.today.map((row) => row.text), ["today stretch"]);
    const lines = factLines(facts);
    assert.ok(lines.some((line) => line.startsWith("Overdue:")));
    assert.ok(lines.some((line) => line.includes("Today 16:00")));
    assert.ok(!lines.some((line) => line.includes("next week")));
    assert.ok(!lines.some((line) => line.includes("finished")));
  } finally {
    done();
  }
});

test("deadlines use a seven-day window and recent notes only look back two days", () => {
  const { root, done } = drive();
  try {
    addNote(root, { text: "Ship arena Nov 5", kind: "deadline" }, NOW.getTime());
    addNote(root, { text: "Far deadline Dec 20", kind: "deadline" }, NOW.getTime());
    addNote(root, { text: "Old deadline Oct 1", kind: "deadline" }, NOW.getTime());
    addNote(root, { text: "Use local models", kind: "decision" }, NOW.getTime() - 3_600_000);
    addNote(root, { text: "Ancient decision", kind: "decision" }, NOW.getTime() - 5 * 86_400_000);
    addNote(root, { text: "Aquos idea", kind: "idea" }, NOW.getTime() - 3_600_000);
    addNote(root, { text: "A fact", kind: "fact" }, NOW.getTime());

    const facts = gatherFacts(root, { now: NOW });
    assert.deepEqual(facts.deadlines.map((row) => row.text), ["Ship arena Nov 5"]);
    const recent = facts.recent.map((row) => row.text).sort();
    assert.deepEqual(recent, ["Aquos idea", "Use local models"]);
    assert.equal(facts.recent.length, 2);
  } finally {
    done();
  }
});

test("unfinished tasks and paused tasks are listed, finished ones are not", () => {
  const { root, done } = drive();
  try {
    const paused = newTask(root, { title: "plan my week", steps: [{ text: "one" }] });
    paused.status = "paused";
    saveTask(root, paused);
    const finished = newTask(root, { title: "old chore", steps: [{ text: "one" }] });
    finished.status = "done";
    saveTask(root, finished);
    const facts = gatherFacts(root, { now: NOW });
    assert.deepEqual(facts.tasks.map((task) => task.title), ["plan my week"]);
  } finally {
    done();
  }
});

test("documents added since the last briefing are listed", () => {
  const { root, done } = drive();
  try {
    const inbox = path.join(root, "documents");
    fs.mkdirSync(inbox, { recursive: true });
    fs.writeFileSync(path.join(inbox, "new.txt"), "hello");
    fs.utimesSync(path.join(inbox, "new.txt"), NOW, NOW);
    const withoutHistory = gatherFacts(root, { now: NOW, documentsInbox: inbox, lastBriefingDay: "" });
    assert.equal(withoutHistory.documents.length, 0, "no previous briefing means nothing is new");
    const withHistory = gatherFacts(root, { now: NOW, documentsInbox: inbox, lastBriefingDay: "2026-11-01" });
    assert.deepEqual(withHistory.documents.map((file) => file.name), ["new.txt"]);
    const old = gatherFacts(root, { now: NOW, documentsInbox: inbox, lastBriefingDay: "2026-11-02" });
    assert.equal(old.documents.length, 0);
  } finally {
    done();
  }
});

test("the model writes the briefing and the plain list is the fallback", async () => {
  const facts = {
    overdue: [],
    today: [{ text: "call the vet", dueAt: "2026-11-02T15:00:00.000Z" }],
    deadlines: [],
    recent: [],
    tasks: [],
    documents: [],
  };
  const good = await writeBriefing(facts, {
    llamaUrl: "http://llama",
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "- Call the vet first, partner.\n- That is all." } }] }),
    }),
  });
  assert.equal(good.model, true);
  assert.match(good.text, /Call the vet first/);

  const down = await writeBriefing(facts, {
    llamaUrl: "http://llama",
    fetchImpl: async () => {
      throw new Error("model down");
    },
  });
  assert.equal(down.model, false);
  assert.match(down.text, /Today 16:00: call the vet/);

  const empty = await writeBriefing({ overdue: [], today: [], deadlines: [], recent: [], tasks: [], documents: [] }, {});
  assert.match(empty.text, /Nothing urgent/);
});

test("the briefing is saved once per day and read back", () => {
  const { root, done } = drive();
  try {
    assert.equal(hasBriefingToday(root, NOW), false);
    const file = saveBriefing(root, "2026-11-02", "- one\n- two");
    assert.equal(fs.existsSync(`${file}.tmp`), false);
    assert.match(readBriefing(root, "2026-11-02"), /- one/);
    assert.equal(hasBriefingToday(root, NOW), true);
    assert.equal(hasBriefingToday(root, new Date("2026-11-03T07:00:00.000Z")), false);
    assert.equal(readLastBriefingDay(root), "2026-11-02");
  } finally {
    done();
  }
});

test("the schedule fires after the time, once, and catches up the same day", () => {
  const settings = { briefingTime: "08:30", briefingOn: true };
  const before = new Date("2026-11-02T07:20:00.000Z"); // 08:20 Warsaw
  const after = new Date("2026-11-02T07:45:00.000Z"); // 08:45 Warsaw
  assert.equal(shouldRun(before, settings, false), false, "too early");
  assert.equal(shouldRun(after, settings, false), true, "time passed");
  assert.equal(shouldRun(after, settings, true), false, "already done today");
  assert.equal(shouldRun(after, { briefingTime: "08:30", briefingOn: false }, false), false, "turned off");
  const later = new Date("2026-11-02T20:00:00.000Z"); // 21:00 Warsaw, woke late
  assert.equal(shouldRun(later, settings, false), true, "same-day catch-up");
  assert.equal(shouldRun(new Date("2026-11-03T07:00:00.000Z"), settings, true), false, "yesterday does not count");
  const midnight = scheduledAt(NOW, "08:30");
  assert.equal(midnight.toISOString(), "2026-11-02T07:30:00.000Z", "08:30 CET is 07:30Z");
});

test("settings parse, validate and default", () => {
  const { root, done } = drive();
  try {
    assert.deepEqual(loadSettings(root), { briefingTime: DEFAULT_TIME, briefingOn: true });
    assert.equal(saveSettings(root, { briefingTime: "9:05" }).briefingTime, "09:05");
    assert.equal(saveSettings(root, { briefingOn: false }).briefingOn, false);
    assert.equal(loadSettings(root).briefingTime, "09:05");
    assert.equal(saveSettings(root, { briefingTime: "25:00" }).briefingTime, "09:05", "bad times are ignored");
    assert.equal(validTime("7:5"), "");
    assert.equal(validTime("07:05"), "07:05");
  } finally {
    done();
  }
});

test("the notification line is the first fact without its bullet", () => {
  assert.equal(topLine("- Overdue: call the vet\n- Today 16:00: stretch"), "Overdue: call the vet");
  assert.equal(topLine(""), "Your briefing is ready.");
  assert.equal(dayKey(NOW), "2026-11-02");
  assert.equal(dayKey(new Date("2026-11-02T23:30:00.000Z")), "2026-11-03", "Warsaw has moved past midnight");
});
