/**
 * Harness spend, recorded in one more append-only file.
 *
 * There is still ONE daily cap: this file only writes
 * `<dataDir>/spend/harness.jsonl`, and `coach/spendGate.mjs` sums it together
 * with the paid chat lines. Nothing here throws on a bad drive.
 */
import fs from "node:fs";
import path from "node:path";
import { DEFAULT_CAP_USD, allowPaid, capUsd, spentTodayUsd } from "../coach/spendGate.mjs";

export { DEFAULT_CAP_USD, allowPaid, capUsd, spentTodayUsd };

/** `<dataDir>/spend/harness.jsonl` */
export function harnessSpendPath(dataDir) {
  return path.join(String(dataDir), "spend", "harness.jsonl");
}

/**
 * recordHarnessSpend(dataDir, { runId, usd, basis, now }) appends one line:
 * `{ v: 1, t, runId, usd, basis }`. Missing or negative amounts are ignored.
 */
export function recordHarnessSpend(dataDir, { runId = "", usd = 0, basis = "", now = Date.now() } = {}) {
  const amount = Number(usd);
  if (!dataDir || !Number.isFinite(amount) || amount < 0) return null;
  try {
    const file = harnessSpendPath(dataDir);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const row = {
      v: 1,
      t: Number(now) || Date.now(),
      runId: String(runId || ""),
      usd: amount,
      basis: String(basis || ""),
    };
    fs.appendFileSync(file, `${JSON.stringify(row)}\n`);
    return row;
  } catch {
    return null; // a failing drive never breaks a finished run
  }
}

/** Read the recorded rows back (tests and the status line use this). */
export function readHarnessSpend(dataDir) {
  if (!dataDir) return [];
  const rows = [];
  let text = "";
  try {
    text = fs.readFileSync(harnessSpendPath(dataDir), "utf8");
  } catch {
    return rows;
  }
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line));
    } catch {
      /* a torn line counts 0 */
    }
  }
  return rows;
}
