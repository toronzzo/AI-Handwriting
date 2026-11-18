import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createCoach } from "./engine.mjs";

const LIB_DIR = new URL(".", import.meta.url).pathname;
const WRITE_CALLS = /\b(writeFileSync|appendFileSync|mkdirSync|renameSync|copyFileSync|rmSync|rmdirSync|unlinkSync|createWriteStream)\s*\(/g;
const FORBIDDEN_TARGETS = /(chat\.jsonl|history|vault|settings\/spend|"\/Volumes|\/Volumes\/Agent|memory")/;

test("source scan: no child_process, exec or spawn anywhere in lib/coach", () => {
  const files = fs.readdirSync(LIB_DIR).filter((name) => name.endsWith(".mjs") && !name.endsWith(".test.mjs"));
  assert.ok(files.length >= 9, `expected the coach modules, got ${files.join(", ")}`);
  for (const name of files) {
    const source = fs.readFileSync(path.join(LIB_DIR, name), "utf8");
    assert.ok(!/child_process/.test(source), `${name} imports child_process`);
    assert.ok(!/\bexec\s*\(/.test(source), `${name} calls exec(`);
    assert.ok(!/\bspawn\s*\(/.test(source), `${name} calls spawn(`);
    assert.ok(!/\bexecFile\b/.test(source), `${name} calls execFile`);
  }
});

test("source scan: coach code writes only inside the coach folder", () => {
  const files = fs.readdirSync(LIB_DIR).filter((name) => name.endsWith(".mjs") && !name.endsWith(".test.mjs"));
  for (const name of files) {
    const source = fs.readFileSync(path.join(LIB_DIR, name), "utf8");
    // Engine/scanner helpers may reference write patterns in comments; only
    // scan actual call sites.
    const lines = source.split("\n");
    for (const line of lines) {
      const stripped = line.replace(/\/\/.*$/, "").replace(/\/\*[\s\S]*?\*\//g, "");
      for (const match of stripped.matchAll(WRITE_CALLS)) {
        const rest = stripped.slice(match.index + match[0].length, match.index + match[0].length + 120);
        assert.ok(!FORBIDDEN_TARGETS.test(rest), `${name}: write outside the coach folder: ${line.trim().slice(0, 120)}`);
      }
    }
  }
});

test('"coach run it for me": never runs anything, says the user does it', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "coach-safety-"));
  try {
    const skillsDir = path.join(dir, "coach", "skills");
    fs.mkdirSync(skillsDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillsDir, "danger.md"),
      [
        "---",
        "name: Dangerous thing",
        "when: [\"run it for me\"]",
        "escalate_if: []",
        "risk: danger",
        "version: 1",
        "---",
        "Something risky.",
        "## Steps",
        "",
        "### 1. Do the risky thing",
        "Do: You do the risky thing.",
        "Why: Practice.",
        "Command: `rm -rf /tmp/coach-demo`",
        "Danger: yes",
        "Check: The folder is gone.",
        "Expect: /gone/",
      ].join("\n"),
    );
    const coach = createCoach({ dataDir: dir, skillsDir, seedDir: null, judge: async () => "unsure" });
    // The skill is danger-level and only ever SHOWS the command; nothing runs.
    const start = await coach.turn("coach run it for me");
    assert.match(start.reply, /Step 1 of 1/);
    assert.match(start.reply, /Careful:/);
    // And a topic with no skill is refused honestly.
    const none = await coach.turn("coach order the pizza");
    assert.match(none.reply, /never run anything myself/);
    assert.match(none.reply, /you do the steps/);
    assert.ok(!/Command:/i.test(none.reply));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the coach reply path never invents a command not in the skill", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "coach-cmd-"));
  try {
    const skillsDir = path.join(dir, "coach", "skills");
    fs.mkdirSync(skillsDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillsDir, "one.md"),
      [
        "---",
        "name: One",
        "when: [\"do one\"]",
        "escalate_if: []",
        "risk: low",
        "version: 1",
        "---",
        "One skill.",
        "## Steps",
        "",
        "### 1. Step one",
        "Do: Run one.",
        "Why: Practice.",
        "Command: `pwd`",
        "Check: It prints a path.",
        "Expect: /^\\//m",
      ].join("\n"),
    );
    const coach = createCoach({ dataDir: dir, skillsDir, seedDir: null, judge: async () => "unsure" });
    const start = await coach.turn("coach do one");
    const retry = await coach.turn("definitely not a path");
    const replies = [start.reply, retry.reply].join("\n");
    const commands = new Set(replies.split("\n").filter((line) => line.startsWith("Command: ")));
    assert.deepEqual([...commands], ["Command: `pwd`"], "only the skill's own command may appear");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
