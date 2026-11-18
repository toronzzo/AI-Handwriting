/**
 * Сторож audit log: append-only, one line per review:
 * {v:1, ts, kind, source, verdict, rule, why, argsPreview, model}.
 * Secrets are redacted with the Coach slice's redactor. A write failure
 * never changes the verdict (callers wrap in try/catch).
 */
import fs from "node:fs";
import path from "node:path";
import { redactSecrets } from "../coach/redact.mjs";

function dayOf(ms) {
  const d = new Date(ms);
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

/** Appends one audit line to <dataDir>/guard/YYYY-MM-DD.jsonl. */
export function appendGuardLog(dataDir, entry) {
  const day = dayOf(Number(entry.ts) || Date.now());
  const dir = path.join(dataDir, "guard");
  fs.mkdirSync(dir, { recursive: true });
  const line = {
    v: 1,
    ts: Number(entry.ts) || Date.now(),
    kind: String(entry.kind || ""),
    source: String(entry.source || ""),
    verdict: String(entry.verdict || ""),
    rule: String(entry.rule || ""),
    why: String(entry.why || ""),
    argsPreview: redactSecrets(String(entry.argsPreview || "")).slice(0, 200),
    model: Boolean(entry.model),
  };
  fs.appendFileSync(path.join(dir, `${day}.jsonl`), JSON.stringify(line) + "\n");
  return line;
}

/** Audit lines for one day ("YYYY-MM-DD"); torn lines are skipped. */
export function readGuardLog(dataDir, day) {
  const dir = path.join(dataDir, "guard");
  if (!fs.existsSync(dir)) return [];
  const lines = [];
  for (const name of fs.readdirSync(dir).sort()) {
    if (!/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(name)) continue;
    if (day && name !== `${day}.jsonl`) continue;
    for (const raw of fs.readFileSync(path.join(dir, name), "utf8").split("\n")) {
      if (!raw.trim()) continue;
      try {
        const entry = JSON.parse(raw);
        if (entry && entry.v === 1) lines.push(entry);
      } catch {
        /* torn line */
      }
    }
  }
  return lines;
}
