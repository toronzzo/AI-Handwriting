/**
 * Spend gate (the seed of the later Сторож guard): read-only view of what the
 * paid route cost today and the user's daily cap. Nothing here writes.
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

/** Sum of costUsd in history/chat.jsonl for the local calendar day. */
export function spentTodayUsd(dataDir, now = new Date()) {
  if (!dataDir) return 0;
  const file = path.join(dataDir, "history", "chat.jsonl");
  let text = "";
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return 0; // missing file counts as nothing, never throws
  }
  const day = dayKeyOf(now instanceof Date ? now.getTime() : Number(now));
  let total = 0;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if (entry && typeof entry === "object" && dayKeyOf(Number(entry.t) || 0) !== day) continue;
      const cost = Number(entry && entry.costUsd);
      if (Number.isFinite(cost) && cost > 0) total += cost;
    } catch {
      /* bad line counts 0 */
    }
  }
  return total;
}

/** The daily cap from settings/spend.json; missing/invalid -> DEFAULT_CAP_USD. */
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

/** spent + estimate must stay under the cap. Read-only. */
export function allowPaid(dataDir, estimateUsd, now = new Date()) {
  const spent = spentTodayUsd(dataDir, now);
  const cap = capUsd(dataDir);
  const estimate = Number(estimateUsd) || 0;
  if (spent + estimate > cap) {
    return { allowed: false, reason: "over_cap", spentTodayUsd: spent, capUsd: cap };
  }
  return { allowed: true, reason: "ok", spentTodayUsd: spent, capUsd: cap };
}
