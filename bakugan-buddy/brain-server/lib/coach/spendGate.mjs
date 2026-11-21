/**
 * Spend gate (the seed of the later Сторож guard): read-only view of what the
 * paid route cost today and the user's daily cap. Nothing here writes.
 *
 * Slice 13 (Harness) added the second spend file: the paid chat lines in
 * `history/chat.jsonl` and the Harness runs in `spend/harness.jsonl` are summed
 * together against the SAME cap, so there is only one daily limit for all paid
 * work.
 */
import fs from "node:fs";
import path from "node:path";

export const DEFAULT_CAP_USD = 1.0;

function dayKeyOf(ms) {
  const d = new Date(ms);
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

/** Sum one money field in a JSONL file for the local day; a missing/bad file counts 0. */
function sumMoneyFile(file, day, field) {
  let text = "";
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return 0; // missing file counts as nothing, never throws
  }
  let total = 0;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if (entry && typeof entry === "object" && dayKeyOf(Number(entry.t) || 0) !== day) continue;
      const cost = Number(entry && entry[field]);
      if (Number.isFinite(cost) && cost > 0) total += cost;
    } catch {
      /* bad line counts 0 */
    }
  }
  return total;
}

/** Sum of paid chat, Harness and tool-task cost for the local calendar day. */
export function spentTodayUsd(dataDir, now = new Date()) {
  if (!dataDir) return 0;
  const day = dayKeyOf(now instanceof Date ? now.getTime() : Number(now));
  const chat = sumMoneyFile(path.join(dataDir, "history", "chat.jsonl"), day, "costUsd");
  const harness = sumMoneyFile(path.join(dataDir, "spend", "harness.jsonl"), day, "usd");
  const tasks = sumMoneyFile(path.join(dataDir, "spend", "tasks.jsonl"), day, "usd");
  return chat + harness + tasks;
}

/** Append one tool-task spend line: <dataDir>/spend/tasks.jsonl {t, usd}. */
export function appendTaskSpend(dataDir, usd, now = new Date()) {
  const value = Number(usd);
  if (!dataDir || !Number.isFinite(value) || value <= 0) return;
  const dir = path.join(dataDir, "spend");
  fs.mkdirSync(dir, { recursive: true });
  const line = { t: (now instanceof Date ? now.getTime() : Number(now)) || Date.now(), usd: value };
  fs.appendFileSync(path.join(dir, "tasks.jsonl"), `${JSON.stringify(line)}\n`);
}

/** The daily cap from the spend setting; missing/invalid -> DEFAULT_CAP_USD. */
export function capUsd(dataDir) {
  if (!dataDir) return DEFAULT_CAP_USD;
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(dataDir, "settings", "spend.json"), "utf8"));
    const value = Number(parsed && parsed.dailyCapUsd);
    return Number.isFinite(value) && value > 0 ? value : DEFAULT_CAP_USD;
  } catch {
    return DEFAULT_CAP_USD;
  }
}

/**
 * Costs of work still running, keyed by owner ("task:<id>", "harness:<id>").
 * A running task registers its accrued gateway cost (and the harness its
 * worst-case estimate), so parallel or long runs count against the one daily
 * cap BEFORE their spend line is written to disk.
 */
const inFlight = new Map();

export function setInFlightCost(key, usd) {
  const value = Number(usd);
  if (!Number.isFinite(value) || value <= 0) inFlight.delete(String(key));
  else inFlight.set(String(key), value);
  return inFlightCostUsd();
}

/** The summed in-flight cost of everything still running. */
export function inFlightCostUsd() {
  let total = 0;
  for (const value of inFlight.values()) {
    if (Number.isFinite(value) && value > 0) total += value;
  }
  return total;
}

/** spent + in-flight + estimate must stay under the cap. Read-only. */
export function allowPaid(dataDir, estimateUsd, now = new Date(), inFlightUsd = 0) {
  const spent = spentTodayUsd(dataDir, now);
  const cap = capUsd(dataDir);
  const estimate = Number(estimateUsd) || 0;
  const running = Math.max(0, Number(inFlightUsd) || 0);
  if (spent + running + estimate > cap) {
    return { allowed: false, reason: "over_cap", spentTodayUsd: spent, inFlightUsd: running, capUsd: cap };
  }
  return { allowed: true, reason: "ok", spentTodayUsd: spent, inFlightUsd: running, capUsd: cap };
}
