import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCoachIntent, isSessionWord } from "./coach.ts";

test("start intents, English and Russian, with and without topic", () => {
  assert.deepEqual(parseCoachIntent("coach"), { kind: "start" });
  assert.deepEqual(parseCoachIntent("коуч"), { kind: "start" });
  assert.deepEqual(parseCoachIntent("coach merge the PR"), { kind: "start", topic: "merge the PR" });
  assert.deepEqual(parseCoachIntent("coach: merge the PR"), { kind: "start", topic: "merge the PR" });
  assert.deepEqual(parseCoachIntent("коуч, смержить пулреквест"), { kind: "start", topic: "смержить пулреквест" });
});

test("non-triggers stay null", () => {
  assert.equal(parseCoachIntent("coaching notes"), null);
  assert.equal(parseCoachIntent("what is a coach"), null);
  assert.equal(parseCoachIntent(""), null);
  assert.equal(parseCoachIntent("hello coach"), null, "only at the start of the message");
  assert.equal(parseCoachIntent("the coach helped me merge"), null);
});

test("stop, status, learned, save lesson", () => {
  assert.deepEqual(parseCoachIntent("stop coach"), { kind: "stop" });
  assert.deepEqual(parseCoachIntent("стоп коуч"), { kind: "stop" });
  assert.deepEqual(parseCoachIntent("coach status"), { kind: "status" });
  assert.deepEqual(parseCoachIntent("где я"), { kind: "status" });
  assert.deepEqual(parseCoachIntent("what have I learned"), { kind: "learned" });
  assert.deepEqual(parseCoachIntent("чему я научился"), { kind: "learned" });
  assert.deepEqual(parseCoachIntent("save lesson"), { kind: "saveLesson" });
  assert.deepEqual(parseCoachIntent("save lesson the PR was stacked"), { kind: "saveLesson", text: "the PR was stacked" });
  assert.deepEqual(parseCoachIntent("запомни урок"), { kind: "saveLesson" });
});

test("save example: whole-message phrases, and non-triggers", () => {
  for (const phrase of ["👍", "save example", "save as example", "сохрани как пример", "запомни ответ"]) {
    assert.deepEqual(parseCoachIntent(phrase), { kind: "saveExample" }, phrase);
  }
  assert.equal(parseCoachIntent("I like the example"), null);
  assert.equal(parseCoachIntent("👍 great job"), null, "extra text after the emoji is not a save");
  assert.equal(parseCoachIntent("save examples please"), null);
});

test("in-session words and the session-word flag", () => {
  for (const word of ["done", "готово", "ok", "дальше", "next"]) {
    assert.deepEqual(parseCoachIntent(word), { kind: "done" }, word);
  }
  assert.deepEqual(parseCoachIntent("back"), { kind: "back" });
  assert.deepEqual(parseCoachIntent("назад"), { kind: "back" });
  assert.deepEqual(parseCoachIntent("skip"), { kind: "skip" });
  assert.deepEqual(parseCoachIntent("why"), { kind: "why" });
  assert.ok(isSessionWord("done"));
  assert.ok(isSessionWord("skip"));
  assert.ok(!isSessionWord("start"));
  assert.ok(!isSessionWord("learned"));
});
