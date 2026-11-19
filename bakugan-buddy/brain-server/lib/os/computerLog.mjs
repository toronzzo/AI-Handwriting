/**
 * B6 computer control: the audit log. Append-only JSONL, one file per day at
 * <dataDir>/computer/YYYY-MM-DD.jsonl. Every line is { v:1, ts, sessionId,
 * n, action, verdict, decision, result, ms } with the action redacted.
 * Screenshot bytes NEVER go into the log; screenshots live in
 * <dataDir>/computer/shots/<id>.jpg and only this feature's own files older
 * than 24 h may be removed by purgeOldShots. Nothing else is ever deleted.
 */
import fs from "node:fs";
import path from "node:path";
import { redactSecrets } from "../coach/redact.mjs";

export const SHOT_ID_PATTERN = /^[a-zA-Z0-9-]{6,64}$/;
export const SHOT_MAX_AGE_MS = 24 * 3600 * 1000;

export function computerDir(dataDir) {
  return path.join(dataDir, "computer");
}

export function shotsDir(dataDir) {
  return path.join(computerDir(dataDir), "shots");
}

/** "YYYY-MM-DD" for the local calendar day. */
export function dayName(now = new Date()) {
  const d = now instanceof Date ? now : new Date(Number(now) || Date.now());
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

export function logFilePath(dataDir, now = new Date()) {
  return path.join(computerDir(dataDir), `${dayName(now)}.jsonl`);
}

/** Only ids this feature created: short, alphanumeric with dashes. */
export function validShotId(id) {
  return typeof id === "string" && SHOT_ID_PATTERN.test(id);
}

export function shotFilePath(dataDir, id) {
  if (!validShotId(id)) return null;
  return path.join(shotsDir(dataDir), `${id}.jpg`);
}

/**
 * Append one audit line. The action is JSON with every secret redacted.
 * A log failure never throws: the action still runs, the log is best-effort.
 */
export function appendComputerLog(dataDir, entry, now = new Date()) {
  if (!dataDir) return false;
  const line = {
    v: 1,
    ts: now instanceof Date ? now.getTime() : Number(now),
    sessionId: String(entry.sessionId || ""),
    n: Number(entry.n) || 0,
    action: redactSecrets(
      typeof entry.action === "string" ? entry.action : JSON.stringify(entry.action ?? {}),
    ),
    verdict: String(entry.verdict || ""),
    decision: String(entry.decision || ""),
    result: entry.result === undefined ? "" : String(entry.result).slice(0, 500),
    ms: Number(entry.ms) || 0,
  };
  try {
    fs.mkdirSync(computerDir(dataDir), { recursive: true });
    fs.appendFileSync(logFilePath(dataDir, now), `${JSON.stringify(line)}\n`, "utf8");
    return true;
  } catch {
    return false;
  }
}

/**
 * Remove only files in the shots folder that this feature created (the id
 * pattern) and that are older than maxAgeMs. Everything else is left alone.
 * Returns the number of files removed.
 */
export function purgeOldShots(dataDir, now = new Date(), maxAgeMs = SHOT_MAX_AGE_MS) {
  if (!dataDir) return 0;
  const dir = shotsDir(dataDir);
  let removed = 0;
  const cutoff = (now instanceof Date ? now.getTime() : Number(now)) - maxAgeMs;
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return 0;
  }
  for (const name of names) {
    const match = name.match(/^([a-zA-Z0-9-]{6,64})\.jpg$/);
    if (!match || !validShotId(match[1])) continue;
    const file = path.join(dir, name);
    try {
      const stat = fs.statSync(file);
      if (!stat.isFile() || stat.mtimeMs > cutoff) continue;
      fs.unlinkSync(file);
      removed += 1;
    } catch {
      /* a busy or vanished file is left alone */
    }
  }
  return removed;
}
