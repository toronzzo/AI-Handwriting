/**
 * Full chat log and a short running summary on the Agent drive.
 * Nothing here is committed. The model only sees a trimmed window.
 */
import fs from "node:fs";
import path from "node:path";

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

export function readHistory(root, limit = 40) {
  const dir = historyDir(root);
  const file = path.join(dir, "chat.jsonl");
  const summaryPath = path.join(dir, "summary.txt");
  const summary = fs.existsSync(summaryPath) ? fs.readFileSync(summaryPath, "utf8") : "";
  if (!fs.existsSync(file)) return { summary, messages: [] };
  const lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
  const start = lines.length > limit ? lines.length - limit : 0;
  const messages = [];
  for (let i = start; i < lines.length; i++) {
    try {
      messages.push(JSON.parse(lines[i]));
    } catch {
      /* skip a torn line */
    }
  }
  return { summary, messages };
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
