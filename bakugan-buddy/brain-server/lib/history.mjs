/**
 * Full chat log and a short running summary on the Agent drive.
 * Nothing here is committed. The model only sees a trimmed window.
 */
import fs from "node:fs";
import path from "node:path";
import { partnerFromTurns } from "../../packages/alive/src/chatTurn.ts";

const SUMMARY_MAX = 800;

export function historyDir(root) {
  return path.join(root, "history");
}

export function appendHistory(root, entry) {
  const dir = historyDir(root);
  fs.mkdirSync(dir, { recursive: true });
  const line = {
    t: entry.t || Date.now(),
    role: entry.role || "user",
    content: String(entry.content || ""),
    who: entry.who || "",
    model: entry.model || "",
    costUsd: typeof entry.costUsd === "number" ? entry.costUsd : null,
    thinking: entry.thinking ? String(entry.thinking) : "",
  };
  fs.appendFileSync(path.join(dir, "chat.jsonl"), JSON.stringify(line) + "\n");
  const summaryPath = path.join(dir, "summary.txt");
  const prev = fs.existsSync(summaryPath) ? fs.readFileSync(summaryPath, "utf8") : "";
  const bit = `${line.who || line.role}: ${line.content.replace(/\s+/g, " ").slice(0, 180)}`;
  let next = prev ? `${prev}\n${bit}` : bit;
  if (next.length > SUMMARY_MAX) next = next.slice(next.length - SUMMARY_MAX);
  fs.writeFileSync(summaryPath, next);
  return { summary: next };
}

/**
 * Copy chat lines from another root into dest. Skips lines already present.
 * Does not delete or edit the source file. Safe to run twice.
 */
export function mergeHistoryFiles(destRoot, otherRoot) {
  if (!destRoot || !otherRoot) return { added: 0 };
  if (path.resolve(destRoot) === path.resolve(otherRoot)) return { added: 0 };
  const otherFile = path.join(historyDir(otherRoot), "chat.jsonl");
  if (!fs.existsSync(otherFile)) return { added: 0 };
  const destDir = historyDir(destRoot);
  fs.mkdirSync(destDir, { recursive: true });
  const destFile = path.join(destDir, "chat.jsonl");
  const have = new Set();
  if (fs.existsSync(destFile)) {
    for (const line of fs.readFileSync(destFile, "utf8").split("\n")) {
      if (line) have.add(line);
    }
  }
  const extra = [];
  for (const line of fs.readFileSync(otherFile, "utf8").split("\n")) {
    if (!line || have.has(line)) continue;
    have.add(line);
    extra.push(line);
  }
  if (extra.length === 0) return { added: 0 };
  const prefix = fs.existsSync(destFile) && !fs.readFileSync(destFile, "utf8").endsWith("\n") ? "\n" : "";
  fs.appendFileSync(destFile, prefix + extra.join("\n") + "\n");
  return { added: extra.length };
}

export function readHistory(root, limit = 40) {
  const dir = historyDir(root);
  const file = path.join(dir, "chat.jsonl");
  const summaryPath = path.join(dir, "summary.txt");
  const summary = fs.existsSync(summaryPath) ? fs.readFileSync(summaryPath, "utf8") : "";
  if (!fs.existsSync(file)) return { summary, messages: [], partner: partnerFromTurns(0) };
  const lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
  let userTurns = 0;
  const parsed = [];
  for (let i = 0; i < lines.length; i++) {
    try {
      const row = JSON.parse(lines[i]);
      parsed.push(row);
      if (row.role === "user" || row.who === "user") userTurns += 1;
    } catch {
      /* skip a torn line */
    }
  }
  const start = parsed.length > limit ? parsed.length - limit : 0;
  return { summary, messages: parsed.slice(start), partner: partnerFromTurns(userTurns) };
}

/** Read the key file without returning the secret. */
export function paidAvailability(envText) {
  const text = String(envText || "");
  const match = text.match(/^DEEPSEEK_API_KEY=(.*)$/m);
  const key = match ? match[1].trim() : "";
  const offPeakOnly = /^DEEPSEEK_OFF_PEAK_ONLY=1\s*$/m.test(text);
  if (!key || key === "changeme" || key === '""' || key === "''") {
    return { available: false, offPeakOnly, reason: "No DeepSeek key in secrets/.env on the Agent drive" };
  }
  return {
    available: true,
    offPeakOnly,
    reason: offPeakOnly ? "DeepSeek flash, off-peak only" : "DeepSeek flash",
  };
}
