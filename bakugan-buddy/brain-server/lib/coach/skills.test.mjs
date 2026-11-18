import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseSkill, loadSkills, copySeedIfMissing } from "./skills.mjs";

const SEED_DIR = new URL("../../coach-seed", import.meta.url).pathname;

test("every seed file parses with zero errors and complete steps", () => {
  const entries = loadSkills(SEED_DIR);
  assert.ok(entries.length >= 6, `expected at least 6 seeds, got ${entries.length}`);
  for (const entry of entries) {
    assert.ok(entry.ok, `${entry.file}: ${entry.errors.join("; ")}`);
    assert.ok(entry.skill.steps.length > 0, `${entry.file}: no steps`);
    for (const step of entry.skill.steps) {
      assert.ok(step.do, `${entry.file} step ${step.n}: missing Do`);
      assert.ok(step.check, `${entry.file} step ${step.n}: missing Check`);
    }
  }
});

test("every Expect/Bad regex in the seeds compiles", () => {
  for (const entry of loadSkills(SEED_DIR)) {
    for (const step of entry.skill.steps) {
      for (const pattern of [...step.expects, ...step.bads]) {
        assert.ok(pattern.re, `${entry.file} step ${step.n}: regex does not compile: ${pattern.src}`);
      }
    }
  }
});

test("Danger and Ack flags parse from the seeds", () => {
  const entries = loadSkills(SEED_DIR);
  const review = entries.find((entry) => entry.skill.name === "Review and merge a PR").skill;
  const mergeStep = review.steps.find((step) => step.title === "Squash and merge");
  assert.equal(mergeStep.danger, true);
  const routine = entries.find((entry) => entry.skill.name === "Harness slice routine").skill;
  const ackStep = routine.steps.find((step) => step.title === "Open a fresh Harness chat");
  assert.equal(ackStep.ack, true);
});

test("a bad regex or missing name is reported, never thrown", () => {
  const badRegex = parseSkill(
    [
      "---",
      "name: Bad regex skill",
      "when: []",
      "risk: low",
      "version: 1",
      "---",
      "Intro.",
      "## Steps",
      "### 1. Do the thing",
      "Do: Run it.",
      "Check: It works.",
      "Expect: /(/",
    ].join("\n"),
    "bad-regex.md",
  );
  assert.equal(badRegex.ok, false);
  assert.ok(badRegex.errors.some((error) => error.includes("bad regex")));

  const noName = parseSkill(
    ["Intro.", "## Steps", "### 1. Do the thing", "Do: Run it.", "Check: It works."].join("\n"),
    "no-name.md",
  );
  assert.equal(noName.ok, false);
  assert.ok(noName.errors.some((error) => error.includes("missing frontmatter name")));
});

test("steps without Do or Check are reported", () => {
  const parsed = parseSkill(
    [
      "---",
      "name: Incomplete",
      "when: []",
      "risk: low",
      "version: 1",
      "---",
      "Intro.",
      "## Steps",
      "### 1. Missing check",
      "Do: Run it.",
    ].join("\n"),
    "incomplete.md",
  );
  assert.ok(parsed.errors.some((error) => error.includes("missing Check")));
});

test("mtime cache reloads an edited file", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "coach-skills-"));
  try {
    const file = path.join(dir, "a.md");
    const text = (doLine) =>
      ["---", "name: A skill", "when: []", "risk: low", "version: 1", "---", "Intro.", "## Steps", "### 1. Step one", doLine, "Check: It works."].join("\n");
    fs.writeFileSync(file, text("Do: Old step."));
    fs.utimesSync(file, new Date(2026, 0, 1), new Date(2026, 0, 1));
    const cache = new Map();
    const first = loadSkills(dir, cache);
    assert.equal(first[0].skill.steps[0].do, "Old step.");
    fs.writeFileSync(file, text("Do: New step."));
    fs.utimesSync(file, new Date(2026, 0, 2), new Date(2026, 0, 2));
    const second = loadSkills(dir, cache);
    assert.equal(second[0].skill.steps[0].do, "New step.");
    const third = loadSkills(dir, cache);
    assert.equal(third[0].skill.steps[0].do, "New step.");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("copySeedIfMissing copies once and never overwrites", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "coach-seed-copy-"));
  try {
    const first = copySeedIfMissing(SEED_DIR, dir);
    assert.ok(first.copied.includes("terminal-basics.md"));
    assert.ok(first.copied.includes("lessons.jsonl"));
    const lessonsPath = path.join(dir, "lessons.jsonl");
    const before = fs.readFileSync(lessonsPath, "utf8");
    fs.appendFileSync(lessonsPath, JSON.stringify({ v: 1, date: "2026-11-18", situation: "custom", cause: "", fix: "x", skill: "" }) + "\n");
    const skillsPath = path.join(dir, "terminal-basics.md");
    fs.appendFileSync(skillsPath, "\n# edited by the user\n");
    const second = copySeedIfMissing(SEED_DIR, dir);
    assert.equal(second.copied.length, 0, "nothing should be copied on the second run");
    assert.ok(fs.readFileSync(lessonsPath, "utf8").length > before.length, "existing lessons file must stay untouched");
    assert.ok(fs.readFileSync(skillsPath, "utf8").endsWith("edited by the user\n"), "existing skill must stay untouched");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
