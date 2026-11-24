/// <reference types="node" />
import assert from "node:assert/strict";
import test from "node:test";
import { CHAT_COMMANDS, matchingCommands, parseChatCommand, parseWhen } from "./commands.ts";

const NOW = new Date("2026-11-24T20:00:00");

test("only known commands are commands", () => {
  assert.deepEqual(parseChatCommand("/remind call mom at 18:00"), { name: "remind", args: "call mom at 18:00" });
  assert.deepEqual(parseChatCommand("/find dentist"), { name: "find", args: "dentist" });
  assert.equal(parseChatCommand("/nope hi"), null);
  assert.equal(parseChatCommand("hello"), null);
  assert.equal(parseChatCommand("  "), null);
});

test("the palette narrows as the user types", () => {
  assert.deepEqual(matchingCommands("/").map((c) => c.name), ["remember", "remind", "find"]);
  assert.deepEqual(matchingCommands("/re").map((c) => c.name), ["remember", "remind"]);
  assert.deepEqual(matchingCommands("/fi").map((c) => c.name), ["find"]);
  assert.deepEqual(matchingCommands("hello"), []);
  assert.equal(CHAT_COMMANDS.length, 3);
});

test("in 20m is twenty minutes from now, and leaves the words alone", () => {
  const when = parseWhen("call mom in 20m", NOW);
  assert.equal(when.text, "call mom");
  assert.equal(when.due.getTime(), NOW.getTime() + 20 * 60_000);
});

test("in 2h is two hours", () => {
  assert.equal(parseWhen("tea in 2h", NOW).due.getTime(), NOW.getTime() + 2 * 3_600_000);
});

test("a clock time later today stays today, an earlier one moves to tomorrow", () => {
  const later = parseWhen("call mom at 21:30", NOW);
  assert.equal(later.text, "call mom");
  assert.equal(later.due.getHours(), 21);
  assert.equal(later.due.getDate(), 24);

  const past = parseWhen("call mom at 09:00", NOW);
  assert.equal(past.due.getHours(), 9);
  assert.equal(past.due.getDate(), 25);
});

test("tomorrow 9:30 is tomorrow morning", () => {
  const when = parseWhen("stretch tomorrow 9:30", NOW);
  assert.equal(when.text, "stretch");
  assert.equal(when.due.getDate(), 25);
  assert.equal(when.due.getHours(), 9);
  assert.equal(when.due.getMinutes(), 30);
});

test("no time at all means an hour from now, and the text is untouched", () => {
  const when = parseWhen("buy milk", NOW);
  assert.equal(when.text, "buy milk");
  assert.equal(when.due.getTime(), NOW.getTime() + 3_600_000);
});
