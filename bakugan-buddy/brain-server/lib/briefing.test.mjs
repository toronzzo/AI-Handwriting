import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  DEFAULT_TIME,
  EMPTY_OPENING,
  FALLBACK_OPENING,
  buildBriefing,
  buildItems,
  briefingPayload,
  cleanOpening,
  dayKey,
  deadlineDate,
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
} from "./briefing.mjs";
import { addNote } from "./notes.mjs";
import { addReminder } from "./reminders.mjs";
import { newTask, saveTask } from "./tasks.mjs";
import { saveDeck } from "./study.mjs";

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

function fakeModel(content) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return { ok: true, json: async () => ({ choices: [{ message: { content } }] }) };
  };
  return { calls, fetchImpl };
}

const withOneReminder = () => ({
  day: "2026-11-02",
  overdue: [],
  today: [{ text: "call the vet", dueAt: "2026-11-02T15:00:00.000Z" }],
  deadlines: [],
  vaultNotes: [],
  tasks: [],
  documents: [],
  studyDue: 0,
});

test("junk chat notes never reach the briefing", async () => {
  const { root, done } = drive();
  try {
    // What the local extractor saved from a chat about a partner's press.
    const decision = addNote(root, { text: "Partner pressed 1.5 to confirm the conversation duration", kind: "decision" }, NOW.getTime());
    const idea = addNote(root, { text: "Partner wants to proceed with the plan", kind: "idea" }, NOW.getTime());
    const facts = gatherFacts(root, { now: NOW });
    assert.equal(facts.recent, undefined, "recent decisions and ideas are gone from the facts");
    const model = fakeModel("Morning, partner! Here's your day.");
    const briefing = await writeBriefing(facts, { llamaUrl: "http://llama", fetchImpl: model.fetchImpl });
    const shown = briefingPayload(briefing).text;
    assert.deepEqual(briefing.items, [], "chat noise is not a briefing item");
    assert.equal(briefing.opening, EMPTY_OPENING);
    assert.ok(!shown.includes("Partner pressed 1.5"), shown);
    assert.ok(!shown.includes("proceed with the plan"), shown);
    assert.ok(!shown.includes(decision.text) && !shown.includes(idea.text));
    assert.equal(model.calls.length, 0, "an empty day does not ask the model");
  } finally {
    done();
  }
});

test("a model that writes items is rejected and the facts stay untouched", async () => {
  const facts = withOneReminder();
  const model = fakeModel("- Partner is ready to press 1.5.\n- Focus on training and battles");
  const briefing = await writeBriefing(facts, { llamaUrl: "http://llama", fetchImpl: model.fetchImpl });
  assert.equal(briefing.model, false, "a bullet list is not an opening line");
  assert.equal(briefing.opening, FALLBACK_OPENING);
  assert.deepEqual(briefing.items, ["16:00: call the vet"], "items come only from code");
  assert.ok(!briefingPayload(briefing).text.includes("press 1.5"));
});

test("the model only sees the count and kinds, never the item texts", async () => {
  const facts = withOneReminder();
  const model = fakeModel("Morning, partner! Let's get going.");
  const briefing = await writeBriefing(facts, { llamaUrl: "http://llama", fetchImpl: model.fetchImpl });
  assert.equal(briefing.model, true);
  assert.equal(briefing.opening, "Morning, partner! Let's get going.");
  const sent = JSON.stringify(model.calls[0].body);
  assert.ok(!sent.includes("call the vet"), "the item text never reaches the model");
  assert.ok(sent.includes("1 thing"));
  assert.ok(sent.includes("reminders due today"));
  assert.equal(model.calls[0].body.temperature, 0.4);
  assert.equal(model.calls[0].body.max_tokens, 40);
  assert.deepEqual(model.calls[0].body.chat_template_kwargs, { enable_thinking: false });
});

test("openings are validated: one line, short, no digits, no bullets", () => {
  assert.equal(cleanOpening("Morning, partner! Ready for today?"), "Morning, partner! Ready for today?");
  assert.equal(cleanOpening("- Morning, partner!"), "");
  assert.equal(cleanOpening("You have 3 things today."), "");
  assert.equal(cleanOpening("First line\nSecond line"), "");
  assert.equal(cleanOpening("x".repeat(121)), "");
  assert.equal(cleanOpening("   "), "");
  assert.equal(cleanOpening(""), "");
  // Newlines inside a rejected reply must not leak into the opening.
  assert.equal(cleanOpening("Good morning\n- invented item"), "");
});

test("a down model gives the fixed fallback opening", async () => {
  const down = await writeBriefing(withOneReminder(), {
    llamaUrl: "http://llama",
    fetchImpl: async () => {
      throw new Error("model down");
    },
  });
  assert.equal(down.model, false);
  assert.equal(down.opening, FALLBACK_OPENING);
  assert.deepEqual(down.items, ["16:00: call the vet"]);
});

test("an empty day says so plainly, with no filler", async () => {
  const facts = { day: "2026-11-02", overdue: [], today: [], deadlines: [], vaultNotes: [], tasks: [], documents: [], studyDue: 0 };
  const briefing = buildBriefing(facts);
  assert.deepEqual(briefing.items, []);
  assert.equal(briefing.empty, true);
  assert.equal(briefing.opening, "Nothing on your plate today — quiet waters.");
  assert.equal(briefing.opening, EMPTY_OPENING);
  const payload = briefingPayload(briefing);
  assert.equal(payload.text, EMPTY_OPENING);
  for (const filler of ["no overdue", "no tasks", "overdue tasks reported"]) {
    assert.ok(!payload.text.toLowerCase().includes(filler));
  }
});

test("items are capped at six with a +N more tail, most urgent first", () => {
  const facts = {
    day: "2026-11-02",
    overdue: [{ text: "overdue one", dueAt: "2026-11-01T08:00:00.000Z" }],
    today: [{ text: "today one", dueAt: "2026-11-02T15:00:00.000Z" }, { text: "today two", dueAt: "2026-11-02T18:00:00.000Z" }],
    deadlines: [{ text: "Exam Nov 5" }],
    vaultNotes: [{ text: "a" }],
    tasks: [{ title: "t1" }],
    documents: [{ name: "memo.docx" }],
    studyDue: 3,
  };
  const items = buildItems(facts);
  assert.equal(items.length, 7, "six items plus the tail");
  assert.equal(items[0], "Overdue: overdue one");
  assert.equal(items[1], "16:00: today one");
  assert.equal(items[2], "19:00: today two");
  assert.equal(items[3], "Deadline Nov 5: Exam Nov 5");
  assert.equal(items[4], "3 flashcards due today");
  assert.equal(items[6], "+2 more", "seven real items, six shown");
  assert.equal(buildBriefing(facts).empty, false);
});

test("the briefing is saved as a markdown record and a json, once per day", () => {
  const { root, done } = drive();
  try {
    assert.equal(hasBriefingToday(root, NOW), false);
    assert.equal(readBriefing(root, "2026-11-02"), null);
    const briefing = { day: "2026-11-02", opening: FALLBACK_OPENING, items: ["one", "two"], empty: false };
    const file = saveBriefing(root, briefing);
    assert.equal(fs.existsSync(`${file}.tmp`), false);
    const md = fs.readFileSync(file, "utf8");
    assert.ok(md.startsWith("# Briefing 2026-11-02\n\n"), md);
    assert.match(md, /- one/);
    assert.match(md, /- two/);
    assert.equal(fs.existsSync(path.join(root, "memory", "briefings", "2026-11-02.json")), true);
    assert.deepEqual(readBriefing(root, "2026-11-02"), {
      day: "2026-11-02",
      opening: FALLBACK_OPENING,
      items: ["one", "two"],
      empty: false,
    });
    assert.equal(hasBriefingToday(root, NOW), true);
    assert.equal(hasBriefingToday(root, new Date("2026-11-03T07:00:00.000Z")), false);
    assert.equal(readLastBriefingDay(root), "2026-11-02");
    // Text handed to the app has no heading at all.
    assert.ok(!briefingPayload(briefing).text.includes("#"));
    assert.deepEqual(Object.keys(briefingPayload(briefing)).sort(), ["day", "empty", "items", "opening", "text"]);
  } finally {
    done();
  }
});

test("notes changed in the Obsidian vault are counted since the last briefing", () => {
  const { root, done } = drive();
  try {
    addNote(root, { text: "Vault note one today", kind: "fact", sourceChatId: "obsidian" }, NOW.getTime());
    addNote(root, { text: "Vault note two today", kind: "fact", sourceChatId: "obsidian" }, NOW.getTime() - 3_600_000);
    addNote(root, { text: "Vault task today", kind: "todo", sourceChatId: "obsidian" }, NOW.getTime());
    addNote(root, { text: "Chat note today", kind: "fact", sourceChatId: "chat-1" }, NOW.getTime());
    const facts = gatherFacts(root, { now: NOW, lastBriefingDay: "2026-11-01" });
    assert.equal(facts.vaultNotes.length, 2);
    assert.ok(buildItems(facts).includes("2 notes changed in your Obsidian vault"));
    const laterSameDay = gatherFacts(root, { now: new Date("2026-11-02T12:00:00.000Z"), lastBriefingDay: "2026-11-01" });
    assert.equal(laterSameDay.vaultNotes.length, 2, "same day as the last briefing day still counts");
    const fresh = gatherFacts(root, { now: NOW, lastBriefingDay: "", notes: [
      { text: "Vault note one today", kind: "fact", sourceChatId: "obsidian", created: NOW.getTime() },
      { text: "Vault note two today", kind: "fact", sourceChatId: "obsidian", created: NOW.getTime() - 3_600_000 },
      { text: "Vault note yesterday", kind: "fact", sourceChatId: "obsidian", created: NOW.getTime() - 30 * 3_600_000 },
    ] });
    assert.equal(fresh.vaultNotes.length, 2, "no previous briefing: today's vault notes count, yesterday's do not");
    const sameDay = gatherFacts(root, { now: NOW, lastBriefingDay: "" });
    assert.equal(sameDay.vaultNotes.length, 2, "the same day's notes still count");
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

test("the notification line is the first item, or the opening when empty", () => {
  assert.equal(topLine({ opening: "Morning!", items: ["Overdue: call the vet", "16:00: stretch"] }), "Overdue: call the vet");
  assert.equal(topLine({ opening: EMPTY_OPENING, items: [] }), EMPTY_OPENING);
  assert.equal(topLine({ opening: "", items: [] }), "Your briefing is ready.");
  assert.equal(topLine(null), "Your briefing is ready.");
  assert.equal(dayKey(NOW), "2026-11-02");
  assert.equal(dayKey(new Date("2026-11-02T23:30:00.000Z")), "2026-11-03", "Warsaw has moved past midnight");
});
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
    const items = buildItems(facts);
    assert.ok(items.some((line) => line === "Overdue: overdue call"));
    assert.ok(items.some((line) => line === "16:00: today stretch"), "today's reminder carries Warsaw time");
    assert.ok(!items.some((line) => line.includes("next week")));
    assert.ok(!items.some((line) => line.includes("finished")));
  } finally {
    done();
  }
});

test("deadlines use a seven-day window and carry their date", () => {
  const { root, done } = drive();
  try {
    addNote(root, { text: "Ship arena Nov 5", kind: "deadline" }, NOW.getTime());
    addNote(root, { text: "Far deadline Dec 20", kind: "deadline" }, NOW.getTime());
    addNote(root, { text: "Old deadline Oct 1", kind: "deadline" }, NOW.getTime());
    addNote(root, { text: "A fact", kind: "fact" }, NOW.getTime());

    const facts = gatherFacts(root, { now: NOW });
    assert.deepEqual(facts.deadlines.map((row) => row.text), ["Ship arena Nov 5"]);
    assert.equal(new Date(deadlineDate("Far deadline Dec 20")).toISOString(), "2026-12-20T11:00:00.000Z", "noon Warsaw");
    // Day 7 is inside the window, day 8 is not.
    const items = buildItems(facts);
    assert.ok(items.includes("Deadline Nov 5: Ship arena Nov 5"), `got ${JSON.stringify(items)}`);
    assert.ok(!items.some((line) => line.includes("Dec 20")));
    assert.ok(!items.some((line) => line.includes("Oct 1")));
  } finally {
    done();
  }
});

test("deadline window is exactly seven days, counted in Warsaw days", () => {
  const { root, done } = drive();
  try {
    // Nov 2 + 7 days = Nov 9: still shown. Nov 10 is one day too far.
    addNote(root, { text: "Last day Nov 9", kind: "deadline" }, NOW.getTime());
    addNote(root, { text: "Too far Nov 10", kind: "deadline" }, NOW.getTime());
    addNote(root, { text: "Explicit 2026-11-09", kind: "deadline" }, NOW.getTime());
    const facts = gatherFacts(root, { now: NOW });
    assert.deepEqual(facts.deadlines.map((row) => row.text).sort(), ["Explicit 2026-11-09", "Last day Nov 9"]);
    const items = buildItems(facts);
    assert.ok(items.includes("Deadline Nov 9: Last day Nov 9"));
    assert.ok(items.includes("Deadline Nov 9: Explicit 2026-11-09"));
  } finally {
    done();
  }
});

test("the Warsaw day boundary decides which day a reminder is on", () => {
  const { root, done } = drive();
  try {
    // 23:30 Warsaw on Mon 2 Nov is 22:30Z; 00:30 Warsaw on Tue 3 Nov is 23:30Z.
    reminderAt(root, "late monday", "2026-11-02T22:30:00.000Z");
    reminderAt(root, "early tuesday", "2026-11-02T23:30:00.000Z");
    const monday = gatherFacts(root, { now: NOW });
    assert.deepEqual(monday.today.map((row) => row.text), ["late monday"], "still Monday in Warsaw");
    const tuesday = gatherFacts(root, { now: new Date("2026-11-03T07:00:00.000Z") });
    assert.deepEqual(tuesday.today.map((row) => row.text), ["early tuesday"]);
    assert.deepEqual(tuesday.overdue.map((row) => row.text), ["late monday"]);
    assert.equal(dayKey(new Date("2026-11-02T23:30:00.000Z")), "2026-11-03");
    assert.equal(dayKey(new Date("2026-11-02T22:30:00.000Z")), "2026-11-02");
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

test("flashcards due today get one line in the briefing", () => {
  const { root, done } = drive();
  try {
    const now = NOW.getTime();
    const deck = {
      id: "d1",
      title: "Arena",
      language: "en",
      createdAt: now,
      updatedAt: now,
      quizzes: [],
      cards: [
        { id: "a", question: "q1", answer: "a1", source: "", due: now - 1000, interval: 0, ease: 2.5, reps: 0, lapses: 0, createdAt: now },
        { id: "b", question: "q2", answer: "a2", source: "", due: now - 1000, interval: 0, ease: 2.5, reps: 0, lapses: 0, createdAt: now },
        { id: "c", question: "q3", answer: "a3", source: "", due: now + 86_400_000, interval: 0, ease: 2.5, reps: 0, lapses: 0, createdAt: now },
      ],
    };
    saveDeck(root, deck);
    const facts = gatherFacts(root, { now: NOW });
    assert.equal(facts.studyDue, 2);
    assert.ok(buildItems(facts).some((line) => line === "2 flashcards due today"));
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

