import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  addReminder,
  deleteReminder,
  dueReminders,
  escapeAppleScript,
  findReminder,
  loadReminders,
  missedOnStartup,
  notificationArgs,
  remindersPath,
  saveReminders,
  snoozedUntil,
  tick,
  updateReminder,
} from "./reminders.mjs";
import { formatDue } from "../../packages/alive/src/reminders.ts";

function drive() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "preyas-reminders-"));
  return { root, done: () => fs.rmSync(root, { recursive: true, force: true }) };
}

const NOW = new Date("2026-11-02T12:00:00+01:00").getTime();

test("a reminder is stored atomically and read back", () => {
  const { root, done } = drive();
  try {
    const saved = addReminder(
      root,
      { text: "call the vet", dueAt: "2026-11-03T08:00:00.000Z", repeat: "none", chatId: "c1" },
      NOW,
    );
    assert.equal(saved.status, "pending");
    assert.equal(saved.chatId, "c1");
    const file = remindersPath(root);
    assert.equal(fs.existsSync(file), true);
    assert.equal(fs.existsSync(`${file}.tmp`), false, "the temp file is renamed, not left behind");
    const back = loadReminders(root);
    assert.equal(back.length, 1);
    assert.equal(back[0].text, "call the vet");
    assert.equal(findReminder(root, saved.id).text, "call the vet");
    assert.equal(findReminder(root, "../etc"), null);
  } finally {
    done();
  }
});

test("an invalid reminder is normalised rather than crashing the store", () => {
  const { root, done } = drive();
  try {
    saveReminders(root, [
      { id: "a", text: "x", dueAt: "not a date", repeat: "hourly", status: "weird" },
    ]);
    const rows = loadReminders(root);
    assert.equal(rows[0].repeat, "none");
    assert.equal(rows[0].status, "pending");
    assert.ok(!Number.isNaN(new Date(rows[0].dueAt).getTime()));
  } finally {
    done();
  }
});

test("marking done, snoozing and deleting update the file", () => {
  const { root, done } = drive();
  try {
    const saved = addReminder(root, { text: "water", dueAt: new Date(NOW + 60_000).toISOString() }, NOW);
    assert.equal(updateReminder(root, saved.id, { action: "done" }, NOW).status, "done");
    const snoozed = updateReminder(root, saved.id, { action: "snooze", snooze: "10m" }, NOW);
    assert.equal(snoozed.status, "pending");
    assert.equal(snoozed.dueAt, new Date(NOW + 600_000).toISOString());
    assert.equal(snoozedUntil("1h", NOW), new Date(NOW + 3_600_000).toISOString());
    assert.equal(formatDue(new Date(snoozedUntil("tomorrow", NOW))), "Tue, Nov 3 at 09:00");
    assert.equal(updateReminder(root, "missing", { action: "done" }), null);
    assert.equal(deleteReminder(root, saved.id), true);
    assert.equal(deleteReminder(root, saved.id), false);
    assert.deepEqual(loadReminders(root), []);
  } finally {
    done();
  }
});

test("only due reminders fire, and a fired repeat schedules its next time", () => {
  const { root, done } = drive();
  try {
    const soon = addReminder(root, { text: "now", dueAt: new Date(NOW - 1000).toISOString() }, NOW);
    addReminder(root, { text: "later", dueAt: new Date(NOW + 3_600_000).toISOString() }, NOW);
    const daily = addReminder(
      root,
      { text: "daily", dueAt: new Date(NOW - 1000).toISOString(), repeat: "daily" },
      NOW,
    );
    const before = loadReminders(root);
    assert.equal(dueReminders(before, NOW).length, 2);
    const result = tick(root, { now: NOW });
    assert.equal(result.fired.length, 2);
    const after = loadReminders(root);
    assert.equal(after.find((row) => row.id === soon.id).status, "done");
    const repeat = after.find((row) => row.id === daily.id);
    assert.equal(repeat.status, "pending");
    assert.ok(new Date(repeat.dueAt).getTime() > NOW);
    assert.equal(after.find((row) => row.text === "later").status, "pending");
  } finally {
    done();
  }
});

test("tick notifies once through the injected notifier", () => {
  const { root, done } = drive();
  try {
    addReminder(root, { text: "stretch", dueAt: new Date(NOW - 1000).toISOString() }, NOW);
    const calls = [];
    tick(root, { now: NOW, notifyImpl: (title, body) => calls.push([title, body]) });
    assert.deepEqual(calls, [["Preyas", "stretch"]]);
  } finally {
    done();
  }
});

test("reminders missed while off are grouped into one message", () => {
  const { root, done } = drive();
  try {
    addReminder(root, { text: "first", dueAt: new Date(NOW - 7_200_000).toISOString() }, NOW);
    addReminder(root, { text: "second", dueAt: new Date(NOW - 3_600_000).toISOString() }, NOW);
    addReminder(root, { text: "future", dueAt: new Date(NOW + 3_600_000).toISOString() }, NOW);
    const message = missedOnStartup(loadReminders(root), NOW);
    assert.match(message, /Missed 2 reminders/);
    assert.match(message, /first/);
    assert.match(message, /second/);
    assert.doesNotMatch(message, /future/);
    assert.equal(missedOnStartup([], NOW), "");
    assert.match(missedOnStartup(loadReminders(root).slice(0, 1), NOW), /^Missed: first$/);
  } finally {
    done();
  }
});

test("notification text is escaped, never shell-built", () => {
  assert.equal(escapeAppleScript('say "hi"'), 'say \\"hi\\"');
  assert.equal(escapeAppleScript("back\\slash"), "back\\\\slash");
  assert.equal(escapeAppleScript("two\nlines"), "two lines");
  const args = notificationArgs("Preyas", 'call "the vet"');
  assert.equal(args[0], "-e");
  assert.match(args[1], /display notification "call \\"the vet\\""/);
  assert.match(args[1], /with title "Preyas"/);
  assert.doesNotMatch(args[1], /`|\$\(/);
});
