import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CAP_MAX_USD,
  CAP_MIN_USD,
  DEFAULT_CAP_USD,
  SAVE_CONFIRM,
  SPEND_SETTING_PATH,
  checkSpendSaveRequest,
  readSpendSetting,
  validateCap,
  writeSpendSetting,
} from "./settings.mjs";
import { allowPaid, capUsd, spentTodayUsd } from "../coach/spendGate.mjs";
import { createHarnessRunner } from "./runner.mjs";
import { FakeAdapter } from "./adapter.mjs";
import { createActivityHub } from "../activity.mjs";
import { recordHarnessSpend } from "./spend.mjs";

const PRICES = {
  HARNESS_USD_PER_MTOK_IN: "0.14",
  HARNESS_USD_PER_MTOK_OUT: "25",
  HARNESS_OUT_TOKENS_MAX: "20000",
};

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "preyas-harness-settings-"));
}

async function waitTerminal(runner, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = runner.status().state;
    if (state !== "running") return state;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return runner.status().state;
}

function makeRunner(dir, adapter) {
  return createHarnessRunner({
    dataDir: dir,
    adapter,
    hub: createActivityHub({ dataDir: dir }),
    readSecrets: () => ({ env: {}, values: [] }),
    summarize: async () => "Ran the fake task.",
    draftTask: async () => "Add a dark mode switch to Settings.",
  });
}

test("validateCap accepts numbers and numeric strings within $0.10..$20", () => {
  for (const [input, expected] of [
    [0.1, 0.1],
    [0.1, 0.1],
    [1, 1],
    ["2.5", 2.5],
    [20, 20],
    ["0,5", 0.5],
    [0.555, 0.56],
    ["20.00", 20],
  ]) {
    const checked = validateCap(input);
    assert.equal(checked.ok, true, `${input} should be accepted`);
    assert.equal(checked.value, expected, `${input} should become ${expected}`);
  }
});

test("validateCap rejects out-of-bounds, negative, NaN, text and empty", () => {
  for (const input of [0.09, 20.01, -1, "abc", Number.NaN, "", "   ", null, undefined, true, {}]) {
    const checked = validateCap(input);
    assert.equal(checked.ok, false, `${String(input)} should be rejected`);
    assert.ok(checked.error.length > 0);
  }
});

test("write then read gives the same value and the exact file shape", () => {
  const dir = tempDir();
  try {
    const written = writeSpendSetting(dir, "2.5", 1_700_000_000_000);
    assert.equal(written.ok, true);
    assert.equal(written.dailyCapUsd, 2.5);
    const raw = JSON.parse(fs.readFileSync(path.join(dir, SPEND_SETTING_PATH), "utf8"));
    assert.deepEqual(Object.keys(raw).sort(), ["dailyCapUsd", "updatedAt"]);
    assert.equal(raw.dailyCapUsd, 2.5);
    assert.equal(raw.updatedAt, 1_700_000_000_000);
    // A brand new read (as a new runner instance would do) sees the same value.
    assert.equal(readSpendSetting(dir).dailyCapUsd, 2.5);
    assert.equal(capUsd(dir), 2.5);
    const runner = makeRunner(dir, new FakeAdapter({ env: PRICES, delayMs: 1 }));
    assert.equal(runner.status().capUsd, 2.5);
    // Rounding is applied on the way in.
    assert.equal(writeSpendSetting(dir, 0.555).ok, true);
    assert.equal(capUsd(dir), 0.56);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a corrupt or missing setting file gives the $1.00 default", () => {
  const dir = tempDir();
  try {
    assert.equal(readSpendSetting(dir).dailyCapUsd, DEFAULT_CAP_USD);
    assert.equal(capUsd(dir), DEFAULT_CAP_USD);
    fs.mkdirSync(path.join(dir, "settings"), { recursive: true });
    fs.writeFileSync(path.join(dir, "settings", "spend.json"), "{not json");
    assert.equal(readSpendSetting(dir).dailyCapUsd, DEFAULT_CAP_USD);
    fs.writeFileSync(path.join(dir, "settings", "spend.json"), JSON.stringify({ dailyCapUsd: "abc" }));
    assert.equal(readSpendSetting(dir).dailyCapUsd, DEFAULT_CAP_USD);
    fs.writeFileSync(path.join(dir, "settings", "spend.json"), JSON.stringify({ dailyCapUsd: -3 }));
    assert.equal(readSpendSetting(dir).dailyCapUsd, DEFAULT_CAP_USD);
    assert.equal(DEFAULT_CAP_USD, 1);
    assert.equal(CAP_MIN_USD, 0.1);
    assert.equal(CAP_MAX_USD, 20);
    assert.equal(SAVE_CONFIRM, "save");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the guard uses a new cap at once: raise lets a run through, lower blocks it", async () => {
  const dir = tempDir();
  try {
    const adapter = new FakeAdapter({
      env: PRICES,
      delayMs: 1,
      steps: [{ tool: "read_file", detail: "docs/HARNESS_CLI.md", delayMs: 1 }],
      usd: 0.002,
    });
    const runner = makeRunner(dir, adapter);
    recordHarnessSpend(dir, { runId: "old", usd: 0.6, basis: "test" });
    assert.equal(spentTodayUsd(dir), 0.6);

    // Default $1.00: 0.60 + up to ~0.50 is over the cap.
    const first = await runner.draft("add dark mode", "");
    assert.equal(first.canStart.code, "OVER_CAP");
    assert.equal((await runner.approve(first.draft.id, "yes")).code, "OVER_CAP");
    assert.equal(adapter.runCalls, 0, "nothing was spawned");

    // Raise to $2.00: the same spend now fits.
    assert.equal(writeSpendSetting(dir, 2).ok, true);
    const second = await runner.draft("add dark mode", "");
    assert.deepEqual(second.canStart, { ok: true });
    const started = await runner.approve(second.draft.id, "yes");
    assert.equal(started.ok, true);
    assert.equal(await waitTerminal(runner), "done");
    assert.equal(adapter.runCalls, 1);
    assert.equal(runner.status().capUsd, 2);

    // Lower below today's spend: allowed to save, then OVER_CAP and no run.
    assert.equal(writeSpendSetting(dir, 0.1).ok, true);
    assert.equal(capUsd(dir), 0.1);
    assert.equal(allowPaid(dir, 0).allowed, false);
    const third = await runner.draft("add dark mode", "");
    assert.equal(third.canStart.code, "OVER_CAP");
    assert.equal((await runner.approve(third.draft.id, "yes")).code, "OVER_CAP");
    assert.equal(adapter.runCalls, 1, "still nothing was spawned");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the POST route logic refuses a missing or wrong confirm and bad amounts", () => {
  assert.equal(checkSpendSaveRequest({ dailyCapUsd: 2 }).ok, false);
  assert.equal(checkSpendSaveRequest({ dailyCapUsd: 2, confirm: "nope" }).ok, false);
  assert.equal(checkSpendSaveRequest({ dailyCapUsd: 2, confirm: "SAVE" }).ok, false);
  assert.equal(checkSpendSaveRequest({ dailyCapUsd: 0.05, confirm: "save" }).ok, false);
  assert.deepEqual(checkSpendSaveRequest({ dailyCapUsd: "2.5", confirm: "save" }), { ok: true, value: 2.5 });
});

/* ------------------------------------------------------------------ */
/* Source scans: Preyas' tool path can never write the limit.          */
/* ------------------------------------------------------------------ */

const BRAIN_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const HARNESS_ROOT = path.join(BRAIN_ROOT, "lib", "harness");
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".expo", "models"]);

function walk(dir, out = [], skip = SKIP_DIRS) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (skip.has(entry.name)) continue;
      walk(full, out, skip);
    } else {
      out.push(full);
    }
  }
  return out;
}

function relBrain(file) {
  return path.relative(BRAIN_ROOT, file).split(path.sep).join("/");
}

test("the paid chat route checks the daily limit before it sends anything", () => {
  // Wiring scan: the gate has its own tests, this one keeps the route honest.
  // A paid turn must reserve room before pipeChatCompletion, settle from the
  // brain's own ledger, and free that room on every exit path.
  const proxy = fs.readFileSync(path.join(BRAIN_ROOT, "proxy.mjs"), "utf8");
  const paidChat = proxy.slice(proxy.indexOf('url.pathname === "/v1/chat/completions"'));
  const gateAt = paidChat.indexOf("beginPaidChat(");
  const sendAt = paidChat.indexOf('"http://127.0.0.1:4000/v1/chat/completions"');
  assert.ok(gateAt > 0, "the paid chat route consults the spend gate and reserves room");
  assert.ok(sendAt > 0, "the paid chat route still forwards to the gateway");
  assert.ok(gateAt < sendAt, "the gate runs before the gateway call");
  assert.match(paidChat, /res, 402/, "a refused paid chat answers 402");
  assert.match(paidChat, /appendPaidSpend/, "the app's number is never the ledger");
  assert.match(paidChat, /paidTurn.release\(\)/, "every exit path frees the reservation");
  assert.ok(
    paidChat.indexOf("paidTurn.release()") > paidChat.indexOf("pipeChatCompletion("),
    "the release runs after the call, in the finally block",
  );

  // The paid status the app renders must not offer a route the cap will refuse.
  const paidStatus = proxy.slice(proxy.indexOf('url.pathname === "/v1/paid"'));
  assert.match(paidStatus, /paidRoomStatus\(dataDir\)/, "the paid status reads the same cap");
  assert.match(paidStatus, /status.available = false/, "over the cap the route is reported off");

  const spendGate = fs.readFileSync(path.join(BRAIN_ROOT, "lib", "coach", "spendGate.mjs"), "utf8");
  assert.ok(
    spendGate.includes('path.join(dataDir, "spend", "paid.jsonl")'),
    "today's paid spend is read from the brain's ledger",
  );
  assert.ok(
    !spendGate.includes('path.join(dataDir, "history", "chat.jsonl")'),
    "a cost the client reported may not decide the cap",
  );
});

test("writeSpendSetting and settings/spend.json live only in settings.mjs, its test and proxy.mjs", () => {
  const allowed = new Set([
    "lib/harness/settings.mjs",
    "lib/harness/settings.test.mjs",
    "proxy.mjs",
  ]);
  const literal = ["settings", "spend.json"].join("/");
  const files = walk(path.join(BRAIN_ROOT, "lib")).filter((file) => file.endsWith(".mjs"));
  files.push(path.join(BRAIN_ROOT, "proxy.mjs"));
  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    const rel = relBrain(file);
    if (text.includes("writeSpendSetting")) {
      assert.ok(allowed.has(rel), `${rel} may not touch writeSpendSetting`);
    }
    // Production code may not name the setting file; existing test titles may
    // mention it (the cap-writer itself is still checked everywhere above).
    if (text.includes(literal) && !rel.endsWith(".test.mjs")) {
      assert.ok(allowed.has(rel), `${rel} may not name the spend setting file`);
    }
  }
});

test("taskRunner, chats, briefing and reminders can never set the cap", () => {
  for (const rel of ["lib/taskRunner.mjs", "lib/chats.mjs", "lib/briefing.mjs", "lib/reminders.mjs"]) {
    const text = fs.readFileSync(path.join(BRAIN_ROOT, rel), "utf8");
    assert.ok(!text.includes("writeSpendSetting"), `${rel} imports the cap writer`);
    assert.ok(!text.includes("lib/harness"), `${rel} imports lib/harness at all`);
    assert.ok(!text.includes("settings/spend"), `${rel} names the spend setting`);
  }
});
