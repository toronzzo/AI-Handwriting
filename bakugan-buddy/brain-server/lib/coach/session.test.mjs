import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createCoach } from "./engine.mjs";

const MERGE_SKILL = [
  "---",
  "name: Test merge",
  "when: [\"merge the pr\"]",
  "escalate_if: []",
  "risk: low",
  "version: 1",
  "---",
  "Merge a test PR.",
  "## Steps",
  "",
  "### 1. Open the PR page",
  "Do: Open the PR.",
  "Why: Everything is there.",
  "Check: The base is main.",
  "Expect: /into\\s+main/i",
  "",
  "### 2. Check the checks",
  "Do: Look at the checks.",
  "Why: Red is broken.",
  "Check: Every check is green.",
  "Expect: /all checks passed|pass\\b/i",
  "Bad: /fail/i",
  "Fail-hint: Paste the failing check name.",
  "",
  "### 3. Look at files",
  "Do: Look at the files.",
  "Why: They must match the prompt.",
  "Check: The files match.",
  "Expect: /^files look fine$/",
  "",
  "### 4. Check mergeability",
  "Do: Look at the merge box.",
  "Why: Conflicts block merging.",
  "Check: It says no conflicts.",
  "Expect: /no conflicts/i",
  "",
  "### 5. Squash and merge",
  "Do: Click squash and merge.",
  "Why: One commit per slice.",
  "Command: `gh pr merge <n> --squash`",
  "Danger: yes",
  "Check: The page shows Merged.",
  "Expect: /merged/i",
  "",
  "### 6. Confirm it is on main",
  "Do: Run the check command.",
  "Why: Double check.",
  "Check: It prints MERGED.",
  "Expect: /\"state\"\\s*:\\s*\"MERGED\"/",
  "",
  "### 7. Hand over",
  "Do: Hand over to pull.",
  "Why: The Mac needs a pull.",
  "Check: You are ready.",
  "Ack: yes",
].join("\n");

function makeCoach(skillText = MERGE_SKILL, judge = async () => "unsure") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "coach-session-"));
  const skillsDir = path.join(dir, "coach", "skills");
  fs.mkdirSync(skillsDir, { recursive: true });
  fs.writeFileSync(path.join(skillsDir, "test-merge.md"), skillText);
  const coach = createCoach({ dataDir: dir, skillsDir, seedDir: null, judge });
  return { coach, dir };
}

function stepOf(reply) {
  const match = reply.match(/^Step (\d+) of (\d+):/m);
  return match ? { step: Number(match[1]), of: Number(match[2]) } : null;
}

function assertOneStep(reply) {
  const count = (reply.match(/^Step \d+ of /gm) || []).length;
  assert.ok(count <= 1, `expected at most one step line, got ${count}: ${reply}`);
}

test("start: one step per reply, honest lead-in", async () => {
  const { coach } = makeCoach();
  const first = await coach.turn("coach merge the pr");
  assert.equal(first.handled, true);
  assert.match(first.reply, /I will use: Test merge/);
  assertOneStep(first.reply);
  assert.equal(stepOf(first.reply).step, 1);
  assert.equal(first.state.mode, "skill");
});

test("random text on an Expect step does not advance", async () => {
  const { coach } = makeCoach();
  await coach.turn("coach merge the pr");
  const reply = await coach.turn("hello there");
  assert.equal(reply.state.step, 1);
  assert.match(reply.reply, /Not quite/);
});

test("a matching paste advances exactly one step", async () => {
  const { coach } = makeCoach();
  await coach.turn("coach merge the pr");
  const reply = await coach.turn("wants to merge 1 commit into main from harness/x");
  assert.equal(reply.state.step, 2);
  assert.equal(stepOf(reply.reply).step, 2);
  assertOneStep(reply.reply);
});

test("Bad blocks and two Bads escalate", async () => {
  const { coach } = makeCoach();
  await coach.turn("coach merge the pr");
  await coach.turn("wants to merge into main");
  const first = await coach.turn("a check failed");
  assert.equal(first.state.step, 2);
  assert.match(first.reply, /Not quite/);
  const second = await coach.turn("the CI failed");
  assert.equal(second.state.step, 2, "still on step 2");
  assert.equal(second.escalate, true);
  assert.match(second.reply, /will not make up the next step/);
  // A good paste after escalation still advances.
  const good = await coach.turn("all checks passed");
  assert.equal(good.state.step, 3);
});

test("back, skip, why, where am I work at any time", async () => {
  const { coach } = makeCoach();
  await coach.turn("coach merge the pr");
  await coach.turn("wants to merge into main");
  const back = await coach.turn("back");
  assert.equal(back.state.step, 1);
  const skip = await coach.turn("skip");
  assert.equal(skip.state.step, 2);
  const why = await coach.turn("why");
  assert.match(why.reply, /Why: Red is broken/);
  const where = await coach.turn("where am I");
  assert.match(where.reply, /Test merge, step 2 of 7/);
});

test("a Danger step cannot be skipped", async () => {
  const { coach } = makeCoach();
  await coach.turn("coach merge the pr");
  await coach.turn("wants to merge into main");
  await coach.turn("all checks passed");
  await coach.turn("files look fine");
  const atFour = await coach.turn("no conflicts here");
  assert.equal(atFour.state.step, 5);
  assert.match(atFour.reply, /Careful:/);
  const skip = await coach.turn("skip");
  assert.equal(skip.state.step, 5, "Danger step must not be skipped");
  assert.match(skip.reply, /cannot be skipped/);
});

test("stop ends the session, coach resumes a fresh one", async () => {
  const { coach } = makeCoach();
  await coach.turn("coach merge the pr");
  const stop = await coach.turn("stop");
  assert.equal(stop.state.mode, "off");
  assert.match(stop.reply, /Coach stopped/);
  const again = await coach.turn("coach merge the pr");
  assert.equal(again.state.step, 1);
});

test("finishing counts toward learned; two completions go short", async () => {
  const { coach, dir } = makeCoach();
  const complete = async () => {
    await coach.turn("coach merge the pr");
    await coach.turn("wants to merge into main");
    await coach.turn("all checks passed");
    await coach.turn("files look fine");
    await coach.turn("no conflicts here");
    await coach.turn("merged");
    await coach.turn('"state":"MERGED"');
    const finish = await coach.turn("done");
    assert.equal(finish.state.mode, "off");
  };
  await complete();
  assert.equal(coach.state().learnedCount, 1, "one skill completed once is listed but not learned");
  const secondFinish = await (async () => {
    await coach.turn("coach merge the pr");
    await coach.turn("wants to merge into main");
    await coach.turn("all checks passed");
    await coach.turn("files look fine");
    await coach.turn("no conflicts here");
    await coach.turn("merged");
    await coach.turn('"state":"MERGED"');
    return coach.turn("done");
  })();
  assert.match(secondFinish.reply, /You have learned Test merge/);
  // Third run: steps render short (no Why) but "why" still answers.
  const third = await coach.turn("coach merge the pr");
  assert.doesNotMatch(third.reply, /^Why:/m);
  const why = await coach.turn("why");
  assert.match(why.reply, /Why: Everything is there/);
  // Learned persists on the drive across a new engine instance.
  const secondCoach = createCoach({ dataDir: dir, skillsDir: path.join(dir, "coach", "skills"), seedDir: null, judge: async () => "unsure" });
  assert.equal(secondCoach.state().learnedCount, 1);
  assert.equal(secondCoach.skills()[0].learned, true);
});

test("judge verdicts: unsure never advances, ok advances, two bads escalate", async () => {
  const skill = [
    "---",
    "name: Judge me",
    "when: [\"do the thing\"]",
    "escalate_if: []",
    "risk: low",
    "version: 1",
    "---",
    "A judge step.",
    "## Steps",
    "",
    "### 1. Do the thing",
    "Do: Run it.",
    "Why: Because.",
    "Check: It works.",
  ].join("\n");

  const unsure = makeCoach(skill, async () => "unsure");
  await unsure.coach.turn("coach do the thing");
  const first = await unsure.coach.turn("anything at all");
  assert.equal(first.state.step, 1, "unsure must never advance");
  assert.match(first.reply, /Not quite/);

  const ok = makeCoach(skill, async () => "ok");
  await ok.coach.turn("coach do the thing");
  const done = await ok.coach.turn("whatever");
  assert.equal(done.state.mode, "off", "ok finishes the single-step skill");
  assert.match(done.reply, /completed/);

  const bad = makeCoach(skill, async () => "bad");
  await bad.coach.turn("coach do the thing");
  await bad.coach.turn("one");
  const second = await bad.coach.turn("two");
  assert.equal(second.escalate, true, "two bad judge verdicts escalate");
});
