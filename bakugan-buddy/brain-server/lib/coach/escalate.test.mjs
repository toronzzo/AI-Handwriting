import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadSkills } from "./skills.mjs";
import { renderStep } from "./render.mjs";
import { escalateReply, buildPaidPrompt, buildGrokBotText, PAID_PROMPT_MAX, GROK_TEXT_MAX } from "./escalate.mjs";
import {
  allowPaid,
  appendPaidSpend,
  beginPaidChat,
  capUsd,
  inFlightCostUsd,
  paidChatEstimateUsd,
  paidChatGate,
  paidRoomStatus,
  setInFlightCost,
  spentTodayUsd,
  DEFAULT_CAP_USD,
} from "./spendGate.mjs";
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
    const spendDir = path.join(dir, "spend");
    fs.mkdirSync(spendDir, { recursive: true });
    const now = new Date();
    fs.writeFileSync(
      path.join(spendDir, "paid.jsonl"),
      [
        JSON.stringify({ t: now.getTime(), usd: 0.9 }),
        JSON.stringify({ t: now.getTime() - 26 * 3600 * 1000, usd: 5 }), // yesterday: must not count
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

test("paid chat gate: the app's reported cost is not what the cap reads", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "paid-chat-gate-"));
  try {
    const now = new Date();
    // What the old code trusted: a costUsd the client put on a chat row.
    const historyDir = path.join(dir, "history");
    fs.mkdirSync(historyDir, { recursive: true });
    fs.writeFileSync(
      path.join(historyDir, "chat.jsonl"),
      JSON.stringify({ t: now.getTime(), role: "assistant", content: "paid", who: "paid", costUsd: 900 }) + "\n",
    );
    assert.equal(spentTodayUsd(dir, now), 0, "a client-reported cost is not spend");
    const afterReport = paidChatGate(dir, 0, now);
    assert.equal(afterReport.allowed, true, "reporting a cost cannot block the cap by itself");
    assert.equal(afterReport.capUsd, DEFAULT_CAP_USD);

    // What the brain writes after a turn is spend, and it blocks the next one.
    appendPaidSpend(dir, 0.1, "chat", now);
    assert.equal(spentTodayUsd(dir, now), 0.1);
    appendPaidSpend(dir, 0.9, "chat", now);
    const blocked = paidChatGate(dir, 4000, now);
    assert.equal(blocked.allowed, false, "1.00 of finished spend leaves no room");
    assert.equal(blocked.reason, "over_cap");
    assert.equal(blocked.spentTodayUsd, 1);
    assert.ok(blocked.estimateUsd > 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("paid chat gate: allowed under the cap, denied at the cap, estimate is never zero", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "paid-chat-room-"));
  try {
    const now = new Date();
    const empty = paidChatGate(dir, 0, now);
    assert.equal(empty.allowed, true, "a fresh day has room");
    assert.equal(empty.spentTodayUsd, 0);
    assert.ok(empty.estimateUsd > 0, "an unreadable body still reserves the output ceiling");

    // A long request costs more than a short one, and both are bounded above
    // by the 2048-token output ceiling plus the prompt.
    assert.ok(paidChatEstimateUsd(4000) > paidChatEstimateUsd(0));
    assert.ok(paidChatEstimateUsd(0) > 0);

    appendPaidSpend(dir, 0.5, "chat", now);
    const roomy = paidChatGate(dir, 4000, now);
    assert.equal(roomy.allowed, true, "0.5 + one turn fits $1.00");
    assert.equal(roomy.capUsd, DEFAULT_CAP_USD);

    // A raised cap is the same setting the other paid routes use, not a new one.
    const settingsDir = path.join(dir, "settings");
    fs.mkdirSync(settingsDir, { recursive: true });
    fs.writeFileSync(path.join(settingsDir, "spend.json"), JSON.stringify({ dailyCapUsd: 2 }));
    assert.equal(paidChatGate(dir, 4000, now).allowed, true);
    assert.equal(paidChatGate(dir, 4000, now).capUsd, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("paid chat gate: work still running counts, exactly like the task runner", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "paid-chat-flight-"));
  try {
    const now = new Date();
    fs.mkdirSync(path.join(dir, "settings"), { recursive: true });
    fs.writeFileSync(path.join(dir, "settings", "spend.json"), JSON.stringify({ dailyCapUsd: 1 }));
    setInFlightCost("test:paid-chat", 0.999);
    const blocked = paidChatGate(dir, 0, now);
    assert.equal(blocked.allowed, false, "a turn already running holds the room it needs");
    assert.ok(blocked.inFlightUsd > 0.99);
    setInFlightCost("test:paid-chat", 0);
    assert.equal(paidChatGate(dir, 0, now).allowed, true, "released room is room again");
  } finally {
    setInFlightCost("test:paid-chat", 0);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("beginPaidChat: reservations stop two paid turns spending the same last cents", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "paid-chat-reserve-"));
  const started = [];
  try {
    const now = new Date();
    fs.mkdirSync(path.join(dir, "settings"), { recursive: true });
    fs.writeFileSync(path.join(dir, "settings", "spend.json"), JSON.stringify({ dailyCapUsd: 1 }));
    // Leave room for exactly two turns at the reserved estimate, so a third
    // running turn is the one that must be refused.
    const estimate = paidChatEstimateUsd(0);
    assert.ok(estimate > 0);
    appendPaidSpend(dir, 1 - 2.5 * estimate, "chat", now);
    const first = beginPaidChat(dir, 0, now);
    const second = beginPaidChat(dir, 0, now);
    const third = beginPaidChat(dir, 0, now);
    started.push(first, second, third);
    assert.equal(first.ok, true, "the first turn reserves the room it needs");
    assert.equal(second.ok, true, "the second still fits");
    assert.equal(third.ok, false, "the third would spend room two running turns already hold");
    assert.equal(third.gate.reason, "over_cap");
    first.release();
    const afterRelease = beginPaidChat(dir, 0, now);
    started.push(afterRelease);
    assert.equal(afterRelease.ok, true, "a finished turn hands its room back");
  } finally {
    for (const begun of started) begun.release();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("beginPaidChat: a refused turn reserves nothing and release is idempotent", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "paid-chat-refuse-"));
  try {
    const now = new Date();
    fs.mkdirSync(path.join(dir, "settings"), { recursive: true });
    fs.writeFileSync(path.join(dir, "settings", "spend.json"), JSON.stringify({ dailyCapUsd: 1 }));
    appendPaidSpend(dir, 5, "chat", now);
    const refused = beginPaidChat(dir, 4000, now);
    assert.equal(refused.ok, false, "a capped day refuses before anything is reserved");
    assert.equal(inFlightCostUsd(), 0, "a refused turn leaves no reservation behind");
    refused.release();
    assert.equal(inFlightCostUsd(), 0, "releasing a refusal is harmless");

    const allowed = beginPaidChat(dir, 0, new Date(now.getTime() + 1));
    assert.equal(allowed.ok, false, "the cap still applies");
    allowed.release();
    allowed.release();
    assert.equal(inFlightCostUsd(), 0, "release can run on every exit path, twice");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("paidRoomStatus: the UI is told the truth about a capped day", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "paid-chat-status-"));
  try {
    const now = new Date();
    fs.mkdirSync(path.join(dir, "settings"), { recursive: true });
    fs.writeFileSync(path.join(dir, "settings", "spend.json"), JSON.stringify({ dailyCapUsd: 1 }));
    const open = paidRoomStatus(dir, now);
    assert.equal(open.allowed, true);
    assert.equal(open.reason, "ok");
    assert.equal(open.capUsd, 1);
    assert.equal(open.spentTodayUsd, 0);

    appendPaidSpend(dir, 1.5, "chat", now);
    const closed = paidRoomStatus(dir, now);
    assert.equal(closed.allowed, false, "over the cap the paid route is not offered");
    assert.equal(closed.reason, "over_cap");
    assert.equal(Math.round(closed.spentTodayUsd * 100) / 100, 1.5);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("beginPaidChat: with no Agent drive there is no ledger, so nothing is sent", () => {
  const begun = beginPaidChat(null, 4000);
  assert.equal(begun.ok, false, "an uncountable paid turn is refused");
  assert.equal(begun.gate.reason, "no_ledger");
  begun.release();
  assert.equal(inFlightCostUsd(), 0);
  const status = paidRoomStatus(null);
  assert.equal(status.allowed, false, "and the UI is told the route is off");
  assert.equal(status.reason, "no_ledger");
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
