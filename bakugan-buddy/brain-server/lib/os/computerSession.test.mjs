import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createFakeAdapter } from "./computerAdapter.mjs";
import { CAREFUL_WARNING } from "./computerDeny.mjs";
import { createComputerSession, readComputerSettings } from "./computerSession.mjs";
import { reviewAction } from "./guard.mjs";
import { handleOsRoute, _setComputerSessionForTests } from "./routes.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

const SNAP = {
  elements: [
    { id: "e0", role: "AXButton", label: "New message", x: 10, y: 20, w: 100, h: 30 },
    { id: "e1", role: "AXTextField", label: "To:", x: 10, y: 60, w: 200, h: 24 },
    { id: "e2", role: "AXButton", label: "Send", x: 300, y: 400, w: 60, h: 30 },
  ],
};

const CLICK_E0 = { action: "click", target: "e0", targetLabel: "New message", why: "to compose", center: { x: 60, y: 35 } };

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "computer-session-"));
}

function makeSession(overrides = {}) {
  const dir = overrides.dir ?? tempDir();
  let t = 10_000;
  const clock = { now: () => t, advance: (ms) => { t += ms; } };
  const front = overrides.front ?? { app: "Mail", title: "Inbox" };
  const adapter = createFakeAdapter({
    frontmost: () => front,
    axSnapshot: () => SNAP,
    screenshot: (filePath) => {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, "fake-jpeg");
      return { ok: true, path: filePath };
    },
  });
  const escalateCalls = [];
  const gate =
    overrides.gate ??
    ((dataDir, usd) => ({ allowed: true, reason: "ok", spentTodayUsd: 0.12, capUsd: 1.0 }));
  const review =
    overrides.review ??
    (async () => ({ verdict: "ask", rule: "R8", why: "controlling your computer always needs your OK", needsConfirm: true, model: false }));
  const session = createComputerSession({
    dataDir: dir,
    adapter,
    proposer: overrides.proposer ?? { propose: async () => ({ ...CLICK_E0 }) },
    escalateProposer: async ({ prompt }) => {
      escalateCalls.push(prompt);
      if (overrides.escalateThrows) throw new Error("paid gateway unavailable");
      if (overrides.escalateAnswer) return overrides.escalateAnswer;
      return overrides.escalateRaw ?? '{"action":"click","target":"e0","why":"the paid model says click"}';
    },
    review,
    gate,
    now: clock.now,
  });
  return { session, dir, clock, adapter, front, escalateCalls, gate };
}

async function enabledSession(overrides = {}) {
  const made = makeSession(overrides);
  const result = await made.session.updateSettings({ enabled: true, confirmed: true });
  assert.equal(result.ok, true, "enabling must succeed");
  return made;
}

function readComputerLog(dir) {
  const files = fs.existsSync(path.join(dir, "computer")) ? fs.readdirSync(path.join(dir, "computer")) : [];
  return files
    .filter((name) => name.endsWith(".jsonl"))
    .flatMap((name) => fs.readFileSync(path.join(dir, "computer", name), "utf8").trim().split("\n"))
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

// ---------------------------------------------------------------- settings

test("settings: missing or invalid file means off", () => {
  const dir = tempDir();
  try {
    const defaults = readComputerSettings(dir);
    assert.equal(defaults.enabled, false);
    assert.equal(defaults.maxActions, 20);
    assert.equal(defaults.idleSeconds, 120);
    fs.mkdirSync(path.join(dir, "settings"), { recursive: true });
    fs.writeFileSync(path.join(dir, "settings", "computer.json"), "{not json", "utf8");
    assert.equal(readComputerSettings(dir).enabled, false);
    fs.mkdirSync(path.join(dir, "settings"), { recursive: true });
    fs.writeFileSync(path.join(dir, "settings", "computer.json"), JSON.stringify({ enabled: true, maxActions: 5, idleSeconds: 30 }));
    const loaded = readComputerSettings(dir);
    assert.equal(loaded.enabled, true);
    assert.equal(loaded.maxActions, 5);
    assert.equal(loaded.idleSeconds, 30);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("settings: enabling without the Да/Нет card refuses to write anything", async () => {
  const { session, dir } = makeSession();
  try {
    const result = await session.updateSettings({ enabled: true });
    assert.equal(result.ok, false);
    assert.equal(result.error, "confirm_first");
    assert.equal(fs.existsSync(path.join(dir, "settings", "computer.json")), false, "nothing may be written before the confirm");
    const off = await session.updateSettings({ enabled: false });
    assert.equal(off.ok, true, "switching off never needs a confirm");
    assert.equal(readComputerSettings(dir).enabled, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("only the settings route writes the file (source scan of lib/os and lib/coach)", () => {
  const libRoot = path.join(HERE, "..");
  const hitsFor = (pattern) => {
    const found = [];
    for (const sub of ["os", "coach"]) {
      for (const name of fs.readdirSync(path.join(libRoot, sub))) {
        if (!name.endsWith(".mjs") || name.endsWith(".test.mjs")) continue;
        const text = fs.readFileSync(path.join(libRoot, sub, name), "utf8");
        if (pattern.test(text)) found.push(path.join(sub, name));
      }
    }
    return found.sort();
  };
  assert.deepEqual(hitsFor(/computer\.json/), ["os/computerSession.mjs"], "only the session module may read/write the settings file");
  assert.deepEqual(hitsFor(/writeComputerSettings/), ["os/computerSession.mjs"], "the writer is defined and called only inside the session module, which only the settings route reaches");
});

// ---------------------------------------------------------------- session

test("disabled: start and step refuse and no adapter call happens", async () => {
  const { session, adapter } = makeSession();
  const start = await session.start({ goal: "write an email" });
  assert.deepEqual(start, { ok: false, error: "computer_off" });
  const step = await session.step();
  assert.deepEqual(step, { ok: false, error: "computer_off" });
  assert.equal(adapter.calls.length, 0);
  assert.equal(session.state().enabled, false);
});

test("stop always works, even when disabled", async () => {
  const { session } = makeSession();
  const result = await session.stop();
  assert.deepEqual(result, { ok: true, stopped: true });
  assert.equal(session.state().phase, "stopped");
});

test("one pending proposal at a time", async () => {
  const { session } = await enabledSession();
  await session.start({ goal: "write an email" });
  const first = await session.step();
  assert.equal(first.ok, true);
  assert.ok(first.proposalId);
  const second = await session.step();
  assert.equal(second.ok, false);
  assert.equal(second.error, "proposal_pending");
  assert.equal(second.proposal.proposalId, first.proposalId);
});

test("approval is single-use and executes the action from the snapshot centre", async () => {
  const { session, adapter } = await enabledSession();
  await session.start({ goal: "write an email" });
  const step = await session.step();
  assert.equal(step.ok, true);
  assert.equal(adapter.calls.some((call) => call[0] === "click"), false, "nothing runs before Да");
  const yes = await session.decide({ proposalId: step.proposalId, yes: true });
  assert.equal(yes.ok, true);
  assert.equal(yes.decision, "yes");
  const clicks = adapter.calls.filter((call) => call[0] === "click");
  assert.deepEqual(clicks, [["click", 60, 35]], "the click uses the centre of the element from the snapshot");
  const again = await session.decide({ proposalId: step.proposalId, yes: true });
  assert.equal(again.error, "no_pending", "the approval is single-use");
  assert.equal(adapter.calls.filter((call) => call[0] === "click").length, 1);
});

test("a decide for the wrong proposal id is refused", async () => {
  const { session, adapter } = await enabledSession();
  await session.start({ goal: "g" });
  await session.step();
  const wrong = await session.decide({ proposalId: "not-the-id", yes: true });
  assert.equal(wrong.error, "proposal_mismatch");
  assert.equal(adapter.calls.filter((call) => call[0] === "click").length, 0);
});

test("the approval expires after 60 s", async () => {
  const { session, adapter, clock } = await enabledSession();
  await session.start({ goal: "g" });
  const step = await session.step();
  clock.advance(60_001);
  const late = await session.decide({ proposalId: step.proposalId, yes: true });
  assert.equal(late.error, "expired");
  assert.equal(adapter.calls.filter((call) => call[0] === "click").length, 0);
});

test("a changed action fails the approval hash", async () => {
  const { session, adapter } = await enabledSession();
  await session.start({ goal: "g" });
  const step = await session.step();
  session._pending().action.target = "e9"; // tamper with the exact action
  const result = await session.decide({ proposalId: step.proposalId, yes: true });
  assert.equal(result.error, "approval_invalid");
  assert.equal(adapter.calls.filter((call) => call[0] === "click").length, 0);
});

test("the deny list runs again against a fresh frontmost before executing", async () => {
  const { session, adapter, front } = await enabledSession();
  await session.start({ goal: "g" });
  const step = await session.step();
  assert.equal(step.ok, true);
  front.app = "Terminal"; // the user switched apps between Да and execution
  const result = await session.decide({ proposalId: step.proposalId, yes: true });
  assert.equal(result.error, "denied");
  assert.equal(result.rule, "app");
  assert.equal(adapter.calls.filter((call) => call[0] === "click").length, 0);
  front.app = "Mail";
  const step2 = await session.step();
  assert.equal(step2.ok, true);
  front.title = "Bank login"; // the window changed between Да and execution
  const result2 = await session.decide({ proposalId: step2.proposalId, yes: true });
  assert.equal(result2.error, "denied");
  assert.equal(result2.rule, "money");
  assert.equal(adapter.calls.filter((call) => call[0] === "click").length, 0);
});

test("the action cap ends the session after maxActions executions", async () => {
  const { session, clock } = await enabledSession();
  await session.updateSettings({ enabled: true, confirmed: true, maxActions: 2 });
  await session.start({ goal: "g" });
  for (let i = 0; i < 2; i++) {
    const step = await session.step();
    const yes = await session.decide({ proposalId: step.proposalId, yes: true });
    assert.equal(yes.ok, true);
    clock.advance(1_000); // the 1 s spacing between executed actions
  }
  assert.equal(session.state().phase, "ended");
  const more = await session.step();
  assert.equal(more.error, "cap_reached");
});

test("the session ends after idleSeconds without a decision", async () => {
  const { session, clock } = await enabledSession();
  await session.updateSettings({ enabled: true, confirmed: true, idleSeconds: 10 });
  await session.start({ goal: "g" });
  const step = await session.step();
  clock.advance(11_000);
  const decide = await session.decide({ proposalId: step.proposalId, yes: true });
  assert.equal(decide.error, "session_ended");
  const next = await session.step();
  assert.equal(next.error, "session_ended");
});

test("at least one second between executed actions", async () => {
  const { session, adapter, clock } = await enabledSession();
  await session.start({ goal: "g" });
  const first = await session.step();
  await session.decide({ proposalId: first.proposalId, yes: true });
  const second = await session.step();
  clock.advance(500);
  const tooSoon = await session.decide({ proposalId: second.proposalId, yes: true });
  assert.equal(tooSoon.error, "too_soon");
  assert.equal(adapter.calls.filter((call) => call[0] === "click").length, 1);
  clock.advance(500);
  const ok = await session.decide({ proposalId: second.proposalId, yes: true });
  assert.equal(ok.ok, true);
  assert.equal(adapter.calls.filter((call) => call[0] === "click").length, 2);
});

test("stop kills any pending proposal at once", async () => {
  const { session, adapter } = await enabledSession();
  await session.start({ goal: "g" });
  await session.step();
  const stopped = await session.stop();
  assert.equal(stopped.stopped, true);
  const decide = await session.decide({ proposalId: "anything", yes: true });
  assert.equal(decide.error, "no_pending");
  assert.equal(adapter.calls.filter((call) => call[0] === "click").length, 0);
  assert.equal(session.state().phase, "stopped");
});

test("a guard block stops a proposal", async () => {
  const { session, adapter } = await enabledSession({
    review: async () => ({ verdict: "block", rule: "R1", why: "not allowed", needsConfirm: false, model: false }),
  });
  await session.start({ goal: "g" });
  const step = await session.step();
  assert.equal(step.ok, false);
  assert.equal(step.error, "blocked");
  assert.equal(session.state().proposal, null);
  assert.equal(adapter.calls.filter((call) => call[0] === "click").length, 0);
});

test("an ask from the model never auto-runs", async () => {
  const { session, adapter } = await enabledSession({
    proposer: { propose: async () => ({ action: "ask", why: "which window do you mean?" }) },
  });
  await session.start({ goal: "g" });
  const step = await session.step();
  assert.equal(step.ok, true);
  assert.equal(step.proposal.action, "ask");
  assert.equal(session.state().proposal, null, "an ask is not a pending action");
  assert.equal(adapter.calls.filter((call) => call[0] === "click").length, 0);
  assert.deepEqual(adapter.calls.map((call) => call[0]), ["frontmost", "axSnapshot"]);
});

test("the deny list stops a proposal before any Да/Нет", async () => {
  const { session, adapter } = await enabledSession({
    proposer: { propose: async () => ({ action: "click", target: "e0", targetLabel: "Delete", why: "clean up" }) },
  });
  await session.start({ goal: "g" });
  const step = await session.step();
  assert.equal(step.ok, false);
  assert.equal(step.error, "denied");
  assert.equal(step.rule, "click-label");
  assert.equal(session.state().proposal, null);
  assert.equal(adapter.calls.filter((call) => call[0] === "click").length, 0);
});

test("dangerous typed text is denied before any Да/Нет", async () => {
  const { session } = await enabledSession({
    proposer: { propose: async () => ({ action: "type", text: "sudo rm -rf /", why: "clean" }) },
  });
  await session.start({ goal: "g" });
  const step = await session.step();
  assert.equal(step.error, "denied");
  assert.equal(step.rule, "text");
});

test("a careful label still needs Да/Нет and carries the warning", async () => {
  const { session, adapter } = await enabledSession({
    proposer: { propose: async () => ({ action: "click", target: "e2", targetLabel: "Send", why: "send it", center: { x: 330, y: 415 } }) },
  });
  await session.start({ goal: "g" });
  const step = await session.step();
  assert.equal(step.ok, true);
  assert.equal(step.warn, CAREFUL_WARNING);
  assert.equal(adapter.calls.filter((call) => call[0] === "click").length, 0, "still needs Да");
  const yes = await session.decide({ proposalId: step.proposalId, yes: true });
  assert.equal(yes.ok, true);
  assert.equal(adapter.calls.filter((call) => call[0] === "click").length, 1);
});

test("rejecting with Нет logs the decision and runs nothing", async () => {
  const { session, adapter, dir } = await enabledSession();
  await session.start({ goal: "g" });
  const step = await session.step();
  const no = await session.decide({ proposalId: step.proposalId, yes: false });
  assert.equal(no.decision, "no");
  assert.equal(adapter.calls.filter((call) => call[0] === "click").length, 0);
  const lines = readComputerLog(dir);
  assert.ok(lines.some((line) => line.decision === "no"));
});

test("executed, expired and stopped outcomes land in the audit log", async () => {
  const { session, dir, clock } = await enabledSession();
  await session.start({ goal: "g" });
  const one = await session.step();
  await session.decide({ proposalId: one.proposalId, yes: true });
  const two = await session.step();
  clock.advance(60_001);
  await session.decide({ proposalId: two.proposalId, yes: true });
  const three = await session.step();
  await session.stop();
  const lines = readComputerLog(dir);
  assert.ok(lines.some((line) => line.decision === "yes" && line.verdict === "executed"));
  assert.ok(lines.some((line) => line.decision === "expired"));
  assert.ok(lines.some((line) => line.decision === "stopped"));
});

test("the real B3 guard answers ask for computer actions and audits them", async () => {
  const dir = tempDir();
  try {
    const { session } = await enabledSession({
      dir,
      review: (action) => reviewAction(action, { dataDir: dir, allowPaid: null }),
    });
    await session.start({ goal: "write an email" });
    const step = await session.step();
    assert.equal(step.ok, true);
    assert.ok(step.proposalId, "the guard asks, and the proposal waits for Да/Нет");
    const guardDir = path.join(dir, "guard");
    assert.ok(fs.existsSync(guardDir), "the guard audits the review");
    const text = fs.readdirSync(guardDir).map((name) => fs.readFileSync(path.join(guardDir, name), "utf8")).join("\n");
    assert.ok(text.includes("computer_click"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- escalation

test("escalation preview is redacted and shows the cost before anything is sent", async () => {
  const { session, escalateCalls } = await enabledSession();
  await session.start({ goal: "use sk-abcdef1234567890 to log in" });
  const step = await session.step();
  const preview = await session.escalatePreview({ proposalId: step.proposalId });
  assert.equal(preview.ok, true);
  assert.ok(!preview.preview.includes("sk-abcdef1234567890"));
  assert.ok(preview.estimateUsd > 0);
  assert.equal(preview.allowed, true);
  assert.equal(preview.spentTodayUsd, 0.12);
  assert.equal(escalateCalls.length, 0, "nothing is sent before Да");
  const mismatch = await session.escalatePreview({ proposalId: "wrong" });
  assert.equal(mismatch.error, "proposal_mismatch");
});

test("escalation confirm: Нет sends nothing, Да sends the exact preview text", async () => {
  const { session, escalateCalls } = await enabledSession();
  await session.start({ goal: "open the composer" });
  await session.step();
  const preview = await session.escalatePreview({});
  const no = await session.escalateConfirm({ yes: false });
  assert.equal(no.confirmed, false);
  assert.equal(escalateCalls.length, 0);
  const yes = await session.escalateConfirm({ yes: true });
  assert.equal(yes.ok, true);
  assert.equal(yes.escalated, true);
  assert.ok(yes.proposalId, "the paid answer becomes a normal Да/Нет proposal");
  assert.equal(escalateCalls.length, 1);
  assert.equal(escalateCalls[0], preview.preview, "the exact previewed text is what leaves the machine");
  assert.equal(session.state().proposal.proposalId, yes.proposalId);
});

test("over the daily cap the escalation is refused and nothing is sent", async () => {
  const { session, escalateCalls } = await enabledSession({
    gate: () => ({ allowed: false, reason: "over_cap", spentTodayUsd: 0.98, capUsd: 1.0 }),
  });
  await session.start({ goal: "g" });
  await session.step();
  const confirm = await session.escalateConfirm({ yes: true });
  assert.equal(confirm.ok, false);
  assert.equal(confirm.allowed, false);
  assert.equal(confirm.reason, "over_cap");
  assert.equal(escalateCalls.length, 0);
  const preview = await session.escalatePreview({});
  assert.equal(preview.allowed, false);
});

test("a confirmed paid escalation writes exactly one line to the shared paid ledger", async () => {
  const usage = { prompt_tokens: 1500, completion_tokens: 120 };
  const { session, dir } = await enabledSession({
    escalateAnswer: { text: '{"action":"click","target":"e0","why":"the paid model says click"}', usage },
  });
  try {
    await session.start({ goal: "open the composer" });
    await session.step();
    const yes = await session.escalateConfirm({ yes: true });
    assert.equal(yes.ok, true);
    assert.equal(yes.escalated, true, "the approved call still happens");

    const spendFile = path.join(dir, "spend", "paid.jsonl");
    const lines = fs
      .readFileSync(spendFile, "utf8")
      .split("\n")
      .filter((line) => line.trim());
    assert.equal(lines.length, 1, "one approved call, one ledger line, never two");
    const entry = JSON.parse(lines[0]);
    assert.equal(entry.src, "computer", "the line says where the money went");
    assert.ok(entry.usd > 0 && entry.usd < 0.01, "settled from the usage the gateway reported");
    // Settled once means the daily total moves by exactly that one amount.
    const spentTodayUsd = (await import("../coach/spendGate.mjs")).spentTodayUsd;
    assert.ok(Math.abs(spentTodayUsd(dir) - entry.usd) < 1e-9);
    // And no reservation is left holding room after the call finished.
    const inFlightCostUsd = (await import("../coach/spendGate.mjs")).inFlightCostUsd;
    assert.equal(inFlightCostUsd(), 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a paid escalation that fails releases its reservation and writes no spend", async () => {
  const { session, dir } = await enabledSession({ escalateThrows: true });
  try {
    await session.start({ goal: "open the composer" });
    await session.step();
    const yes = await session.escalateConfirm({ yes: true });
    assert.equal(yes.ok, false);
    assert.equal(yes.error, "escalate_failed");
    assert.equal(fs.existsSync(path.join(dir, "spend", "paid.jsonl")), false, "nothing was charged, nothing written");
    const inFlightCostUsd = (await import("../coach/spendGate.mjs")).inFlightCostUsd;
    assert.equal(inFlightCostUsd(), 0, "the refused call hands its room back");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a paid answer that is not json becomes an ask", async () => {
  const { session } = await enabledSession({ escalateRaw: "I think you should click Send" });
  await session.start({ goal: "g" });
  await session.step();
  const yes = await session.escalateConfirm({ yes: true });
  assert.equal(yes.ok, true);
  assert.equal(yes.proposal.action, "ask");
});

// ---------------------------------------------------------------- routes

function fakeRes() {
  const out = { status: 0, headers: {}, body: null };
  return {
    out,
    res: {
      writeHead(status, headers) {
        out.status = status;
        out.headers = headers || {};
      },
      end(body) {
        out.body = body;
      },
    },
  };
}

function routeCtx(pathname, dataDir, method = "GET", body = {}) {
  return {
    req: { method },
    url: new URL(`http://x${pathname}`),
    dataDir,
    readJson: async () => body,
    readBody: async () => Buffer.alloc(0),
    now: () => Date.now(),
  };
}

async function routeCall(pathname, dataDir, method, body) {
  const { res, out } = fakeRes();
  const handled = await handleOsRoute({ ...routeCtx(pathname, dataDir, method, body), res });
  return { handled, out };
}

test("routes: disabled start answers 403 computer_off and no adapter call happens", async () => {
  const { session, dir, adapter } = makeSession();
  _setComputerSessionForTests(session);
  try {
    const { handled, out } = await routeCall("/v1/computer/start", dir, "POST", { goal: "g" });
    assert.equal(handled, true);
    assert.equal(out.status, 403);
    assert.deepEqual(JSON.parse(out.body), { error: "computer_off" });
    assert.equal(adapter.calls.length, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("routes: settings needs the Да/Нет card, then start/step/decide/stop flow", async () => {
  const { session, dir } = makeSession();
  _setComputerSessionForTests(session);
  try {
    const noConfirm = await routeCall("/v1/computer/settings", dir, "POST", { enabled: true });
    assert.equal(noConfirm.out.status, 400);
    assert.deepEqual(JSON.parse(noConfirm.out.body), { error: "confirm_first" });
    assert.equal(fs.existsSync(path.join(dir, "settings", "computer.json")), false);

    const enable = await routeCall("/v1/computer/settings", dir, "POST", { enabled: true, confirmed: true, maxActions: 5, idleSeconds: 30 });
    assert.equal(enable.out.status, 200);
    const written = JSON.parse(fs.readFileSync(path.join(dir, "settings", "computer.json"), "utf8"));
    assert.deepEqual(written, { enabled: true, maxActions: 5, idleSeconds: 30 });

    const start = await routeCall("/v1/computer/start", dir, "POST", { goal: "write an email" });
    assert.equal(start.out.status, 200);
    assert.equal(JSON.parse(start.out.body).ok, true);

    const step = await routeCall("/v1/computer/step", dir, "POST", {});
    assert.equal(step.out.status, 200);
    const stepBody = JSON.parse(step.out.body);
    assert.ok(stepBody.proposalId);
    assert.equal(stepBody.step, 1);
    assert.equal(stepBody.maxActions, 5);
    assert.ok(stepBody.shotUrl.startsWith("/v1/computer/shot/"));
    assert.equal(stepBody.spentTodayUsd, 0.12);

    const decide = await routeCall("/v1/computer/decide", dir, "POST", { proposalId: stepBody.proposalId, yes: false });
    assert.equal(decide.out.status, 200);
    assert.equal(JSON.parse(decide.out.body).decision, "no");

    const stop = await routeCall("/v1/computer/stop", dir, "POST", {});
    assert.equal(JSON.parse(stop.out.body).stopped, true);

    const state = await routeCall("/v1/computer/state", dir, "GET", {});
    const stateBody = JSON.parse(state.out.body);
    assert.equal(stateBody.enabled, true);
    assert.equal(stateBody.phase, "stopped");
    assert.equal(stateBody.spentTodayUsd, 0.12);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("routes: the shot endpoint serves only pattern-matching files from the shots folder", async () => {
  const { session, dir } = makeSession();
  _setComputerSessionForTests(session);
  try {
    const shots = path.join(dir, "computer", "shots");
    fs.mkdirSync(shots, { recursive: true });
    const bytes = Buffer.from([0xff, 0xd8, 0x01, 0x02, 0xff, 0xd9]);
    fs.writeFileSync(path.join(shots, "abc12345.jpg"), bytes);
    const good = await routeCall("/v1/computer/shot/abc12345", dir, "GET", {});
    assert.equal(good.out.status, 200);
    assert.equal(good.out.headers["Content-Type"], "image/jpeg");
    assert.deepEqual(Buffer.from(good.out.body), bytes);
    const traversal = await routeCall("/v1/computer/shot/..%2F..%2Fsettings", dir, "GET", {});
    assert.equal(traversal.out.status, 404);
    const missing = await routeCall("/v1/computer/shot/nosuch.jpg", dir, "GET", {});
    assert.equal(missing.out.status, 404);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("routes: escalate returns the preview and confirm spends only after Да", async () => {
  const { session, dir, escalateCalls } = makeSession();
  _setComputerSessionForTests(session);
  try {
    await session.updateSettings({ enabled: true, confirmed: true });
    await session.start({ goal: "compose a letter" });
    await session.step();
    const preview = await routeCall("/v1/computer/escalate", dir, "POST", {});
    assert.equal(preview.out.status, 200);
    const previewBody = JSON.parse(preview.out.body);
    assert.equal(previewBody.ok, true);
    assert.ok(previewBody.preview.length > 0);
    assert.equal(previewBody.allowed, true);
    assert.equal(escalateCalls.length, 0);
    const confirm = await routeCall("/v1/computer/escalate/confirm", dir, "POST", { yes: true });
    const confirmBody = JSON.parse(confirm.out.body);
    assert.equal(confirmBody.ok, true);
    assert.equal(escalateCalls.length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
