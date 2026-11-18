import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadSkills } from "./skills.mjs";
import { renderStep } from "./render.mjs";
import { escalateReply, buildPaidPrompt, buildGrokBotText, PAID_PROMPT_MAX, GROK_TEXT_MAX } from "./escalate.mjs";
import { allowPaid, capUsd, spentTodayUsd, DEFAULT_CAP_USD } from "./spendGate.mjs";
import { createCoach } from "./engine.mjs";

const SEED_DIR = new URL("../../coach-seed", import.meta.url).pathname;

test("no match: honest reply with options and no command", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "coach-escalate-"));
  try {
    const skillsDir = path.join(dir, "coach", "skills");
    fs.mkdirSync(skillsDir, { recursive: true });
    const coach = createCoach({ dataDir: dir, skillsDir, seedDir: null, judge: async () => "unsure" });
    const reply = await coach.turn("coach make me a sandwich");
    assert.equal(reply.escalate, true);
    assert.match(reply.reply, /I do not have a skill for that yet/);
    assert.match(reply.reply, /Ask DeepSeek/);
    assert.match(reply.reply, /Ask Grok Bot/);
    assert.match(reply.reply, /save lesson/);
    assert.ok(!/Command:/i.test(reply.reply), "no command line in the escalate reply");
    assert.ok(!/(exec|spawn|child_process)/i.test(reply.reply));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("every rendered command equals a Command: line of its skill", () => {
  const entries = loadSkills(SEED_DIR);
  assert.ok(entries.length >= 6);
  for (const entry of entries) {
    const skill = entry.skill;
    for (let index = 1; index <= skill.steps.length; index++) {
      const step = skill.steps[index - 1];
      const rendered = renderStep(skill, index, { short: false });
      const renderedCommands = rendered.split("\n").filter((line) => line.startsWith("Command: ")).map((line) => line.slice("Command: ".length));
      assert.deepEqual(renderedCommands, step.commands, `${skill.name} step ${index}: rendered commands must match Command: lines exactly`);
    }
  }
});

test("buildPaidPrompt is at most 3000 chars and holds no secret", () => {
  const prompt = buildPaidPrompt({
    skillName: "Test",
    stepIndex: 2,
    stepTitle: "Check the checks",
    whatTried: "pasted sk-abcdef1234567890 into the wrong box",
    lastOutput: "Key=ghp_1234567890abcdef",
  });
  assert.ok(prompt.length <= PAID_PROMPT_MAX, `prompt is ${prompt.length} chars`);
  assert.ok(!prompt.includes("sk-abcdef1234567890"));
  assert.ok(!prompt.includes("ghp_1234567890abcdef"));
  assert.ok(!/ghp_[A-Za-z0-9]{8,}/.test(prompt));
  assert.match(prompt, /sk-\*\*\*/);
});

test("buildGrokBotText stays under the cap and is redacted", () => {
  const text = buildGrokBotText({ topic: "Bearer abcdefghijklmnop leaked in the log" });
  assert.ok(text.length <= GROK_TEXT_MAX);
  assert.ok(!text.includes("abcdefghijklmnop"));
});

test("escalateReply for a failing step names the skill and step", () => {
  const reply = escalateReply({ reason: "failed", skillName: "Test merge", stepIndex: 4 });
  assert.match(reply, /Test merge.*step 4/);
  assert.match(reply, /will not make up the next step/);
});

test("spendGate: over the cap blocks, missing settings file gives the default cap", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "coach-spend-"));
  try {
    const historyDir = path.join(dir, "history");
    fs.mkdirSync(historyDir, { recursive: true });
    const now = new Date();
    fs.writeFileSync(
      path.join(historyDir, "chat.jsonl"),
      [
        JSON.stringify({ t: now.getTime(), role: "assistant", content: "paid", who: "paid", model: "paid", costUsd: 0.9 }),
        JSON.stringify({ t: now.getTime() - 26 * 3600 * 1000, role: "assistant", content: "old", who: "paid", model: "paid", costUsd: 5 }), // yesterday: must not count
        "not json at all",
        "",
      ].join("\n"),
    );
    assert.equal(spentTodayUsd(dir, now), 0.9);
    assert.equal(capUsd(dir), DEFAULT_CAP_USD, "missing settings file -> default cap");
    const over = allowPaid(dir, 0.2, now);
    assert.equal(over.allowed, false, "0.9 + 0.2 > 1.00");
    assert.equal(over.reason, "over_cap");
    const under = allowPaid(dir, 0.05, now);
    assert.equal(under.allowed, true, "0.9 + 0.05 <= 1.00");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("spendGate: a raised cap in settings/spend.json applies at once", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "coach-spend-cap-"));
  try {
    const settingsDir = path.join(dir, "settings");
    fs.mkdirSync(settingsDir, { recursive: true });
    fs.writeFileSync(path.join(settingsDir, "spend.json"), JSON.stringify({ dailyCapUsd: 5 }));
    assert.equal(capUsd(dir), 5);
    const gate = allowPaid(dir, 2);
    assert.equal(gate.allowed, true);
    assert.equal(gate.capUsd, 5);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
