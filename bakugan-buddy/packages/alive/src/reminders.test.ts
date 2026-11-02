import assert from "node:assert/strict";
import test from "node:test";
import {
  addLocalDays,
  formatDue,
  isReminderRequest,
  localParts,
  nextOccurrence,
  nextWeekday,
  parseReminder,
  snoozeUntil,
  warsawWallTime,
} from "./reminders.ts";

/** Monday 2 Nov 2026, 12:00 in Warsaw (CET, +01:00). */
const NOW = new Date("2026-11-02T12:00:00+01:00");

function due(phrase: string, now: Date = NOW) {
  const parsed = parseReminder(phrase, now);
  assert.equal(parsed.ok, true, `${phrase} should parse: ${parsed.ok ? "" : parsed.reason}`);
  if (!parsed.ok) throw new Error("unreachable");
  return parsed;
}

test("the common phrases land on the right wall-clock time", () => {
  assert.equal(due("remind me tomorrow at 9 to call the vet").text, "call the vet");
  assert.equal(due("remind me tomorrow at 9 to call the vet").label, "Tue, Nov 3 at 09:00");
  assert.equal(due("remind me Friday about the deadline").label, "Fri, Nov 6 at 09:00");
  assert.equal(due("remind me Friday about the deadline").text, "the deadline");
  assert.equal(due("remind me in 2 hours to stretch").label, "Mon, Nov 2 at 14:00");
  assert.equal(due("every Monday at 8 standup").label, "Mon, Nov 9 at 08:00");
  assert.equal(due("every Monday at 8 standup").repeat, "weekly");
  assert.equal(due("on Nov 10 at 18:00 dinner").label, "Tue, Nov 10 at 18:00");
  assert.equal(due("tonight take the bins out").label, "Mon, Nov 2 at 19:00");
  assert.equal(due("this evening call mom").label, "Mon, Nov 2 at 19:00");
  assert.equal(due("9pm movie").label, "Mon, Nov 2 at 21:00");
});

test("default slots are used when no clock time is given", () => {
  assert.equal(due("remind me tomorrow").label, "Tue, Nov 3 at 09:00");
  assert.equal(due("remind me this afternoon").label, "Mon, Nov 2 at 14:00");
  assert.equal(due("remind me this evening").label, "Mon, Nov 2 at 19:00");
  assert.equal(due("every day at 7 coffee").repeat, "daily");
  assert.equal(due("every weekday at 7 gym").repeat, "weekdays");
});

test("a time that already passed today moves to tomorrow", () => {
  assert.equal(due("remind me at 9").label, "Tue, Nov 3 at 09:00");
  assert.equal(due("remind me at 18:30").label, "Mon, Nov 2 at 18:30");
});

test("Russian basics work", () => {
  const parsed = due("напомни завтра в 9 позвонить маме");
  assert.equal(parsed.label, "Tue, Nov 3 at 09:00");
  assert.equal(parsed.text, "позвонить маме");
});

test("a message with no time is refused instead of guessed", () => {
  for (const phrase of ["remind me to buy milk", "what are my reminders", "tell me a story", ""]) {
    const parsed = parseReminder(phrase, NOW);
    assert.equal(parsed.ok, false, phrase);
    assert.equal(parsed.ok ? "" : parsed.reason, "no-time");
  }
  assert.equal(parseReminder("remind me tomorrow", NOW).ok, true);
});

test("only reminder-shaped messages are considered", () => {
  assert.equal(isReminderRequest("remind me tomorrow at 9"), true);
  assert.equal(isReminderRequest("every Monday at 8"), true);
  assert.equal(isReminderRequest("on Nov 10 at 18:00"), true);
  assert.equal(isReminderRequest("9pm movie"), true);
  assert.equal(isReminderRequest("what are my reminders"), false);
  assert.equal(isReminderRequest("why do I run every monday"), false);
});

test("Europe/Warsaw keeps the same wall clock across the DST change", () => {
  const beforeDst = warsawWallTime(2026, 10, 24, 9, 0);
  const afterDst = warsawWallTime(2026, 10, 26, 9, 0);
  assert.equal(beforeDst.toISOString(), "2026-10-24T07:00:00.000Z", "CEST is +02:00");
  assert.equal(afterDst.toISOString(), "2026-10-26T08:00:00.000Z", "CET is +01:00");
  assert.equal(formatDue(beforeDst), "Sat, Oct 24 at 09:00");
  assert.equal(formatDue(afterDst), "Mon, Oct 26 at 09:00");
  // The switch happens at 03:00 on Oct 25, so 09:00 that day is already CET.
  assert.equal(warsawWallTime(2026, 10, 25, 9, 0).toISOString(), "2026-10-25T08:00:00.000Z");
  // A weekly reminder crossing the switch keeps 09:00 local.
  const weekly = parseReminder("every Sunday at 9 standup", new Date("2026-10-20T12:00:00+02:00"));
  assert.equal(weekly.ok, true);
  if (weekly.ok) {
    assert.equal(weekly.label, "Sun, Oct 25 at 09:00");
    assert.equal(weekly.dueAt.toISOString(), "2026-10-25T08:00:00.000Z");
    const next = nextOccurrence({ dueAt: weekly.dueAt.toISOString(), repeat: "weekly" }, weekly.dueAt);
    assert.equal(formatDue(next), "Sun, Nov 1 at 09:00");
    assert.equal(next.toISOString(), "2026-11-01T08:00:00.000Z", "the second Sunday is CET");
  }
});

test("repeating reminders schedule their next occurrence", () => {
  const daily = { dueAt: "2026-11-02T08:00:00.000Z", repeat: "daily" as const };
  assert.equal(nextOccurrence(daily, new Date("2026-11-02T09:00:00+01:00")).toISOString(), "2026-11-03T08:00:00.000Z");
  const weekdays = { dueAt: "2026-11-06T07:00:00.000Z", repeat: "weekdays" as const }; // Friday
  const nextMonday = nextOccurrence(weekdays, new Date("2026-11-06T09:00:00+01:00"));
  assert.equal(localParts(nextMonday).day, 9, "skips the weekend");
  const once = { dueAt: "2026-11-05T08:00:00.000Z", repeat: "none" as const };
  assert.equal(nextOccurrence(once, new Date()).toISOString(), once.dueAt);
});

test("next weekday counts today only when the time has not passed", () => {
  assert.equal(formatDue(nextWeekday(NOW, 1, 15, 0)), "Mon, Nov 2 at 15:00", "Monday 15:00 is still ahead");
  assert.equal(formatDue(nextWeekday(NOW, 1, 8, 0)), "Mon, Nov 9 at 08:00", "Monday 08:00 already passed");
  assert.equal(formatDue(nextWeekday(NOW, 5, 9, 0)), "Fri, Nov 6 at 09:00");
});

test("snooze offers ten minutes, an hour, or tomorrow morning", () => {
  const base = { dueAt: NOW.toISOString() };
  assert.equal(snoozeUntil(base, "10m", NOW).toISOString(), new Date(NOW.getTime() + 600_000).toISOString());
  assert.equal(snoozeUntil(base, "1h", NOW).toISOString(), new Date(NOW.getTime() + 3_600_000).toISOString());
  assert.equal(formatDue(snoozeUntil(base, "tomorrow", NOW)), "Tue, Nov 3 at 09:00");
});

test("local day arithmetic keeps the wall clock across DST", () => {
  const saturday = warsawWallTime(2026, 10, 24, 9, 0);
  assert.equal(formatDue(addLocalDays(saturday, 2)), "Mon, Oct 26 at 09:00");
  assert.equal(addLocalDays(saturday, 2).toISOString(), "2026-10-26T08:00:00.000Z");
});
