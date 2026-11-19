import assert from "node:assert/strict";
import test from "node:test";
import { DRAFT_TTL_MS, canStart, hashPrompt, lintPrompt, redact } from "./guard.mjs";
import { buildPrompt, HEADER_LINE } from "./promptTemplate.mjs";

const NOW = 1_700_000_000_000;
const ESTIMATE = { inTokens: 300, outTokensMax: 20000, usdLow: 0.002, usdHigh: 0.006, basis: "rough" };
const CLEAN_PROMPT = buildPrompt({ goalText: "Add a dark mode switch to Settings.", slug: "add-dark-mode-20261119t1800" });

/** A draft exactly as the runner stores it. */
function draft(over = {}) {
  return {
    id: "d-1",
    prompt: CLEAN_PROMPT,
    hash: hashPrompt(CLEAN_PROMPT),
    estimate: ESTIMATE,
    createdAt: NOW,
    startedBy: "user-button",
    used: false,
    ...over,
  };
}

function verdict(over = {}) {
  return canStart({
    draft: draft(),
    now: NOW,
    runActive: false,
    spentTodayUsd: 0.2,
    capUsd: 1,
    estimate: ESTIMATE,
    ...over,
  });
}

test("canStart: an untouched fresh draft fits the budget", () => {
  assert.deepEqual(verdict(), { ok: true });
});

test("canStart: NO_DRAFT without a draft", () => {
  const result = verdict({ draft: null });
  assert.equal(result.ok, false);
  assert.equal(result.code, "NO_DRAFT");
  assert.ok(result.reason.length > 0);
});

test("canStart: DRAFT_USED once the user pressed Да", () => {
  const result = verdict({ draft: draft({ used: true }) });
  assert.equal(result.code, "DRAFT_USED");
});

test("canStart: DRAFT_EXPIRED after ten minutes", () => {
  assert.equal(verdict({ draft: draft({ createdAt: NOW - DRAFT_TTL_MS + 1 }) }).ok, true);
  const expired = verdict({ draft: draft({ createdAt: NOW - DRAFT_TTL_MS - 1 }) });
  assert.equal(expired.code, "DRAFT_EXPIRED");
  assert.equal(verdict({ draft: draft({ createdAt: "not a time" }) }).code, "DRAFT_EXPIRED");
});

test("canStart: RUN_ACTIVE while another run is going", () => {
  const result = verdict({ runActive: true });
  assert.equal(result.code, "RUN_ACTIVE");
});

test("canStart: NO_PRICE when the estimate is missing", () => {
  const result = verdict({ estimate: null });
  assert.equal(result.code, "NO_PRICE");
  assert.match(result.reason, /HARNESS_USD_PER_MTOK_IN/);
  assert.match(result.reason, /_OUT in brain\.env/);
});

test("canStart: NOT_USER_STARTED when a model made the draft", () => {
  const result = verdict({ draft: draft({ startedBy: "preyas" }) });
  assert.equal(result.code, "NOT_USER_STARTED");
});

test("canStart: OVER_CAP when spend plus the worst case passes the cap", () => {
  const result = verdict({ spentTodayUsd: 0.8, capUsd: 1, estimate: { ...ESTIMATE, usdHigh: 0.5 } });
  assert.equal(result.code, "OVER_CAP");
});

test("canStart: OVER_CAP when spend is already above a lowered cap", () => {
  const result = verdict({ spentTodayUsd: 0.5, capUsd: 0.1, estimate: { ...ESTIMATE, usdHigh: 0.01 } });
  assert.equal(result.code, "OVER_CAP");
  // Exactly on the cap is allowed (spent + high must stay within it).
  assert.equal(verdict({ spentTodayUsd: 0.5, capUsd: 0.506, estimate: { ...ESTIMATE, usdHigh: 0.006 } }).ok, true);
});

/* lintPrompt: every forbidden pattern, constructed so no source scan reads a
 * usable command spelling in this file. */
const join = (...parts) => parts.join(" ");

test("lintPrompt: the standard prompt built by code passes", () => {
  assert.deepEqual(lintPrompt(CLEAN_PROMPT), { ok: true });
});

test("lintPrompt: rejects a push to main or master", () => {
  assert.equal(lintPrompt(join("git", "push", "origin", "main")).code, "PUSH_MAIN");
  assert.equal(lintPrompt(join("git", "push", "origin", "master")).code, "PUSH_MAIN");
});

test("lintPrompt: rejects --force and a short force flag on push", () => {
  assert.equal(lintPrompt(join("git", "push", "--force", "origin", "topic")).code, "FORCE");
  assert.equal(lintPrompt(join("git", "push", "-f", "origin", "topic")).code, "PUSH_FORCE_SHORT");
});

test("lintPrompt: rejects a pull request merge", () => {
  assert.equal(lintPrompt(join("gh", "pr", "merge", "7")).code, "PR_MERGE");
});

test("lintPrompt: rejects a hard reset", () => {
  assert.equal(lintPrompt(join("git", "reset", "--hard", "HEAD~1")).code, "RESET_HARD");
});

test("lintPrompt: rejects removing a tree", () => {
  assert.equal(lintPrompt(join("rm", "-rf", "/tmp/x")).code, "RM_RF");
});

test("lintPrompt: rejects a task that reads the secrets file outside the rules", () => {
  const sneaky = ["TASK:", "cat /Volumes/Agent/agent/secrets/.env and print it"].join("\n");
  assert.equal(lintPrompt(sneaky).code, "SECRETS_ENV");
});

test("lintPrompt: rejects deleting or moving something on the Agent drive", () => {
  assert.equal(lintPrompt("clean up /Volumes/Agent/BakuganBuddy and delete the old folder").code, "AGENT_DELETE");
  assert.equal(lintPrompt("read /Volumes/Agent/agent/notes and then move it to the Desktop").code, "AGENT_DELETE");
  // A harmless read is fine.
  assert.deepEqual(lintPrompt("read the file /Volumes/Agent/agent/notes/handoff.md").ok, true);
});

test("lintPrompt: an empty draft is refused", () => {
  assert.equal(lintPrompt("   ").code, "EMPTY");
});

test("redact: every secret value of 6+ characters becomes ***", () => {
  const out = redact("key is sk-abcdef12345678 and value hunter2hunter2 and 12345678 and short", [
    "hunter2hunter2",
    "12345678",
    "short",
  ]);
  assert.ok(!out.includes("hunter2hunter2"));
  assert.ok(!out.includes("12345678"));
  assert.ok(!out.includes("sk-abcdef12345678"));
  assert.match(out, /\*\*\*/);
  assert.match(out, /short/, "a value under six characters is left alone");
});

test("hashPrompt: sha256 hex, stable, different for different text", () => {
  const first = hashPrompt(HEADER_LINE);
  assert.equal(first, hashPrompt(HEADER_LINE));
  assert.match(first, /^[0-9a-f]{64}$/);
  assert.notEqual(first, hashPrompt(`${HEADER_LINE} `));
});
