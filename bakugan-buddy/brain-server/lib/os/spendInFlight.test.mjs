import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { allowPaid, inFlightCostUsd, setInFlightCost, capUsd } from "../coach/spendGate.mjs";

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "preyas-spend-"));
}

/** A data dir with $0.60 of finished spend today and a $1.00 cap. */
function dataDirWithSpentSpend() {
  const dir = tempDir();
  const now = new Date();
  const history = path.join(dir, "history");
  fs.mkdirSync(history, { recursive: true });
  fs.writeFileSync(
    path.join(history, "chat.jsonl"),
    JSON.stringify({ t: now.getTime(), role: "assistant", content: "paid", who: "paid", costUsd: 0.6 }) + "\n",
  );
  fs.mkdirSync(path.join(dir, "settings"), { recursive: true });
  fs.writeFileSync(path.join(dir, "settings", "spend.json"), JSON.stringify({ dailyCapUsd: 1.0 }));
  return dir;
}

test("the cap blocks when finished spend plus in-flight cost exceeds it", () => {
  const dir = dataDirWithSpentSpend();
  try {
    const now = new Date();
    // Finished alone ($0.60) fits; a $0.45 task that is still running does not.
    assert.equal(allowPaid(dir, 0.0, now).allowed, true);
    assert.equal(allowPaid(dir, 0.0, now, 0.45).allowed, false);
    assert.equal(allowPaid(dir, 0.02, now, 0.45).allowed, false);
    // Finished plus in-flight leaves room for the next small estimate.
    assert.equal(allowPaid(dir, 0.05, now, 0.30).allowed, true);
    const blocked = allowPaid(dir, 0.0, now, 0.45);
    assert.equal(blocked.reason, "over_cap");
    assert.equal(blocked.inFlightUsd, 0.45);
    assert.equal(capUsd(dir), 1.0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the in-flight ledger sums running work and forgets finished work", () => {
  setInFlightCost("task:a", 0.4);
  setInFlightCost("task:b", 0.1);
  setInFlightCost("harness:h1", 0.25);
  assert.equal(inFlightCostUsd(), 0.75);
  setInFlightCost("task:a", 0); // finished: its spend is on disk now
  assert.equal(inFlightCostUsd(), 0.35);
  setInFlightCost("task:b", -1); // garbage is forgotten, not counted
  setInFlightCost("harness:h1", 0);
  assert.equal(inFlightCostUsd(), 0);
});

test("parallel tasks: the second one sees the first one's in-flight cost", () => {
  const dir = dataDirWithSpentSpend();
  try {
    const now = new Date();
    setInFlightCost("task:first", 0.5); // the first task accrued $0.50 so far
    // $0.60 finished + $0.50 in-flight + $0.02 estimate > $1.00 -> blocked.
    assert.equal(allowPaid(dir, 0.02, now, inFlightCostUsd()).allowed, false);
    // The same check without the ledger would wrongly allow it.
    assert.equal(allowPaid(dir, 0.02, now).allowed, false, "the ledger total is included by default");
    setInFlightCost("task:first", 0);
    assert.equal(allowPaid(dir, 0.02, now).allowed, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("every call site counts the ledger: a 3-argument allowPaid call sees in-flight costs", () => {
  const dir = dataDirWithSpentSpend();
  try {
    const now = new Date();
    setInFlightCost("task:first", 0.45);
    // Old call sites pass only (dataDir, estimate, now) — they must still
    // include the running work.
    assert.equal(allowPaid(dir, 0.0, now).allowed, false);
    setInFlightCost("task:first", 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
