import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadSkills } from "./skills.mjs";
import { findSkill, searchLessons, normalizeQuery } from "./retrieve.mjs";
import { loadLessons } from "./lessons.mjs";

const SEED_DIR = new URL("../../coach-seed", import.meta.url).pathname;
const entries = loadSkills(SEED_DIR);

function pick(query) {
  return findSkill(entries, query);
}

test("English and Russian queries find the right skill", () => {
  const cases = [
    ["how do I merge the PR", "Review and merge a PR"],
    ["как смержить пулреквест", "Review and merge a PR"],
    ["my PR has conflicts", "Fix a stacked PR conflict"],
    ["restart preyas", "Restart Preyas"],
    ["what is cd", "Terminal basics"],
    ["paste the next harness prompt", "Harness slice routine"],
    ["after merge update the app", "Pull and refresh"],
  ];
  for (const [query, name] of cases) {
    const found = pick(query);
    assert.equal(found.confidence, "high", `"${query}" should be high confidence, got ${found.confidence}`);
    assert.equal(found.skill.name, name, `"${query}" should pick ${name}, got ${found.skill?.name}`);
  }
});

test("an unrelated question matches nothing", () => {
  const found = pick("what is the weather in Gdansk");
  assert.equal(found.confidence, "none");
  assert.equal(found.skill, null);
});

test("normaliseQuery is lowercase and punctuation-free", () => {
  assert.equal(normalizeQuery("How do I merge the PR?"), "how do i merge the pr");
  assert.equal(normalizeQuery("как смержить, пулреквест!"), "как смержить пулреквест");
});

test("lesson search finds the seed lesson for a squash conflict", () => {
  const lessons = loadLessons(new URL("../../coach-seed/lessons.seed.jsonl", import.meta.url).pathname);
  const hits = searchLessons(lessons, "PR has conflicts after squash", 2);
  assert.ok(hits.length > 0, "expected at least one lesson hit");
  assert.ok(hits[0].lesson.situation.includes("PRs"), `unexpected lesson: ${hits[0].lesson.situation}`);
  assert.ok(hits[0].score > 0);
});

test("lesson search with temp lessons ranks situation + cause + fix", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "coach-lessons-search-"));
  try {
    const file = path.join(dir, "lessons.jsonl");
    fs.writeFileSync(
      file,
      [
        JSON.stringify({ v: 1, date: "2026-11-01", situation: "npm install failed because node_modules was missing", cause: "", fix: "run npm install", skill: "" }),
        JSON.stringify({ v: 1, date: "2026-11-02", situation: "the page stayed white after refresh", cause: "old bundle cached", fix: "hard reload", skill: "" }),
        "",
      ].join("\n"),
    );
    const lessons = loadLessons(file);
    const hits = searchLessons(lessons, "the page is white after I refresh", 1);
    assert.equal(hits[0].lesson.date, "2026-11-02");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
