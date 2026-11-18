import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { appendLesson, loadLessons, cleanLessonField, localDay } from "./lessons.mjs";
import { redactSecrets } from "./redact.mjs";
import { createCoach } from "./engine.mjs";

test("appendLesson is append-only and skips torn lines on load", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "coach-lessons-"));
  try {
    const file = path.join(dir, "lessons.jsonl");
    const list = [];
    appendLesson(file, list, { date: "2026-11-18", situation: "first situation", cause: "", fix: "first fix", skill: "Test" });
    const before = fs.readFileSync(file, "utf8");
    appendLesson(file, list, { date: null, situation: "second situation", cause: "cause two", fix: "fix two", skill: "Test" }, () => new Date(2026, 10, 19, 12).getTime());
    const after = fs.readFileSync(file, "utf8");
    assert.ok(after.startsWith(before), "existing bytes must be untouched");
    assert.equal(after.split("\n").filter(Boolean).length, 2);
    // Torn line is skipped.
    fs.appendFileSync(file, "{v:1, broken\n");
    const loaded = loadLessons(file);
    assert.equal(loaded.length, 2);
    assert.equal(loaded[1].date, "2026-11-19", "date falls back to the local day of now()");
    assert.equal(loaded[0].cause, "");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("lesson fields are capped and a pasted secret is redacted", () => {
  const lesson = { date: "2026-11-18", situation: "x".repeat(500), cause: "token sk-1234567890abcdef was in the log", fix: "Bearer abcdefghijklmnop leaked", skill: "Test" };
  const cleaned = cleanLessonField(lesson.situation);
  assert.equal(cleaned.length, 400);
  const cause = cleanLessonField(lesson.cause);
  assert.ok(!cause.includes("sk-1234567890abcdef"));
  assert.match(cause, /sk-\*\*\*/);
  const fix = cleanLessonField(lesson.fix);
  assert.ok(!fix.includes("abcdefghijklmnop"));
  assert.match(fix, /Bearer \*\*\*/);
});

test("redactSecrets hides KEY/TOKEN/PASSWORD/SECRET lines and token shapes", () => {
  const text = [
    "OPENAI_KEY=sk-abcdef1234567890",
    "TOKEN: ghp_1234567890abcdef",
    "PASSWORD = hunter2secret",
    "plain text stays",
  ].join("\n");
  const out = redactSecrets(text);
  assert.ok(!out.includes("sk-abcdef1234567890"));
  assert.ok(!out.includes("ghp_1234567890abcdef"));
  assert.ok(!out.includes("hunter2secret"));
  assert.match(out, /OPENAI_KEY=\*\*\*/);
  assert.match(out, /plain text stays/);
});

test("guided capture collects situation, cause, fix and saves one line", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "coach-capture-"));
  try {
    const skillsDir = path.join(dir, "coach", "skills");
    fs.mkdirSync(skillsDir, { recursive: true });
    const coach = createCoach({ dataDir: dir, skillsDir, seedDir: null, judge: async () => "unsure" });
    const start = await coach.turn("save lesson");
    assert.match(start.reply, /What situation/);
    const sit = await coach.turn("the PR had a conflict after squash");
    assert.match(sit.reply, /What went wrong/);
    const cause = await coach.turn("skip");
    assert.match(cause.reply, /What fixed it/);
    const fix = await coach.turn("a fresh branch from main");
    assert.match(fix.reply, /Lesson saved/);
    const file = path.join(dir, "coach", "lessons.jsonl");
    const loaded = loadLessons(file);
    assert.equal(loaded.length, 1);
    assert.match(loaded[0].situation, /PR had a conflict/);
    assert.equal(loaded[0].cause, "");
    assert.match(loaded[0].fix, /fresh branch/);
    assert.equal(loaded[0].skill, "");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("lesson line appears before the first step of a skill", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "coach-lesson-line-"));
  try {
    const skillsDir = path.join(dir, "coach", "skills");
    fs.mkdirSync(skillsDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillsDir, "merge.md"),
      [
        "---",
        "name: Merge",
        "when: [\"merge the pr\"]",
        "risk: low",
        "version: 1",
        "---",
        "Merging a PR.",
        "## Steps",
        "",
        "### 1. Open the PR",
        "Do: Open it.",
        "Why: To see it.",
        "Check: You see it.",
        "Expect: /^open$/",
      ].join("\n"),
    );
    const coach = createCoach({ dataDir: dir, skillsDir, seedDir: null, judge: async () => "unsure" });
    await coach.turn("save lesson");
    await coach.turn("the merge button was grey after squash");
    await coach.turn("skip");
    await coach.turn("wait for CI and refresh");
    const reply = await coach.turn("coach merge the pr");
    assert.match(reply.reply, new RegExp(`I remember a lesson from ${localDay(new Date())}`));
    assert.match(reply.reply, /merge button was grey/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("localDay formats the local calendar date", () => {
  assert.equal(localDay(new Date(2026, 10, 18, 23, 59)), "2026-11-18");
  assert.equal(localDay(new Date(2026, 0, 5)), "2026-01-05");
});
