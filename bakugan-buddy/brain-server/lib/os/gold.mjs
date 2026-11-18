/**
 * Gold examples store: append-only <dataDir>/gold/examples.jsonl. One object
 * per line; removal is a tombstone line. Nothing is ever rewritten.
 */
import fs from "node:fs";
import path from "node:path";
import { redactSecrets } from "../coach/redact.mjs";
import { newestChat, readChat } from "../chats.mjs";

export const Q_MAX = 600;
export const A_MAX = 1200;
export const CYRILLIC = /[а-яё]/gi;

/** Command replies must never become gold examples. */
const COMMAND_REPLY =
  /^(Saved to notes:|I don't have a note about|Reminder set for|I could not find anything|Saved:|Сохранено:|Saved as example|Step \d+ of|I will use:|Blocked by the guard|Daily limit reached|For Grok Bot|Lesson saved|You are in |What situation|The command is on screen|Coach)/i;

function makeId(ts) {
  const random = Math.random().toString(36).slice(2, 6);
  return `gx_${Number(ts).toString(36)}${random}`;
}

function normalizePair(q, a) {
  const flat = (value) => String(value ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  return `${flat(q)}\n${flat(a)}`;
}

function langOf(q, a) {
  const letters = `${q} ${a}`.replace(/[^a-zа-яё]/gi, "");
  const cyr = (letters.match(CYRILLIC) || []).length;
  return letters.length > 0 && cyr / letters.length > 0.3 ? "ru" : "en";
}

export function goldDir(dataDir) {
  return path.join(dataDir, "gold");
}

function goldFile(dataDir) {
  return path.join(goldDir(dataDir), "examples.jsonl");
}

/** All valid lines (including tombstones); torn lines are skipped. */
function readLines(dataDir) {
  const file = goldFile(dataDir);
  if (!fs.existsSync(file)) return [];
  const lines = [];
  for (const raw of fs.readFileSync(file, "utf8").split("\n")) {
    if (!raw.trim()) continue;
    try {
      const entry = JSON.parse(raw);
      if (entry && entry.v === 1) lines.push(entry);
    } catch {
      /* torn line */
    }
  }
  return lines;
}

/** Newest `limit` active examples. */
export function listExamples(dataDir, { limit = 300 } = {}) {
  if (!dataDir) return [];
  const lines = readLines(dataDir);
  const removed = new Set(lines.filter((line) => line.type === "remove" && line.of).map((line) => line.of));
  const examples = lines
    .filter((line) => line.id && !removed.has(line.id))
    .filter((line) => typeof line.q === "string" && typeof line.a === "string")
    .sort((left, right) => (right.ts || 0) - (left.ts || 0))
    .slice(0, limit)
    .map((line) => ({ id: line.id, q: line.q, a: line.a, lang: line.lang === "ru" ? "ru" : "en", ts: line.ts }));
  // The list must stay under 150 KB in total; drop the oldest when over.
  let total = 0;
  const kept = [];
  for (const example of examples) {
    total += JSON.stringify(example).length;
    if (total > 150 * 1024) break;
    kept.push(example);
  }
  return kept;
}

export function exampleStats(dataDir) {
  const examples = listExamples(dataDir, { limit: 10_000 });
  return {
    active: examples.length,
    ru: examples.filter((example) => example.lang === "ru").length,
    en: examples.filter((example) => example.lang === "en").length,
  };
}

/**
 * savePair(dataDir, {q, a, source, now}) -> {saved, id?, active?, reason?}.
 * Refuses: empty answer, [[ASK_PAID]] answers, command replies. Duplicates
 * (same normalised q + a, still active) are ignored.
 */
export function savePair(dataDir, { q, a, source = "chat", now = () => Date.now() } = {}) {
  if (!dataDir) return { saved: false, reason: "no data dir" };
  const question = redactSecrets(String(q ?? "").replace(/\s+/g, " ").trim()).slice(0, Q_MAX);
  const answer = redactSecrets(String(a ?? "").replace(/\s+/g, " ").trim()).slice(0, A_MAX);
  if (!question || !answer) return { saved: false, reason: "there is no question and answer pair to save" };
  if (answer.includes("[[ASK_PAID]]")) return { saved: false, reason: "that answer asks for a paid call; not saved" };
  if (COMMAND_REPLY.test(answer)) return { saved: false, reason: "that answer is a command reply, not a model answer" };

  const key = normalizePair(question, answer);
  for (const line of readLines(dataDir)) {
    if (line.id && !line.type && normalizePair(line.q, line.a) === key) {
      return { saved: false, reason: "already saved" };
    }
  }

  const ts = now instanceof Date ? now.getTime() : Number(now) || Date.now();
  const example = {
    v: 1,
    id: makeId(ts),
    ts,
    q: question,
    a: answer,
    lang: langOf(question, answer),
    source: String(source || "chat").slice(0, 20),
  };
  try {
    fs.mkdirSync(goldDir(dataDir), { recursive: true });
    fs.appendFileSync(goldFile(dataDir), JSON.stringify(example) + "\n");
  } catch {
    return { saved: false, reason: "the drive is not writable" };
  }
  return { saved: true, id: example.id, active: exampleStats(dataDir).active };
}

/** Tombstone one example; nothing is deleted. */
export function removeExample(dataDir, id, now = () => Date.now()) {
  if (!dataDir) return { removed: false, reason: "no data dir" };
  const ts = now instanceof Date ? now.getTime() : Number(now) || Date.now();
  const tombstone = { v: 1, type: "remove", of: String(id || ""), ts };
  try {
    fs.mkdirSync(goldDir(dataDir), { recursive: true });
    fs.appendFileSync(goldFile(dataDir), JSON.stringify(tombstone) + "\n");
    return { removed: true };
  } catch {
    return { removed: false, reason: "the drive is not writable" };
  }
}

/**
 * saveLastPair(dataDir) — the newest chat's last MODEL answer plus the user
 * message before it. Command replies (addLocal) and other shapes are refused.
 * The labels found in the app: real local replies carry who "preyas" and
 * model "preyas", paid replies who "paid" and model "deepseek-flash"; several
 * command replies reuse model "preyas", so the content check also applies.
 */
export function saveLastPair(dataDir, now = () => Date.now()) {
  if (!dataDir) return { saved: false, reason: "no data dir" };
  try {
    const chat = newestChat(dataDir);
    if (!chat) return { saved: false, reason: "there is no chat to save from" };
    const book = readChat(dataDir, chat.id, 200);
    const rows = book ? book.messages : [];
    for (let i = rows.length - 1; i >= 0; i--) {
      const row = rows[i];
      const isAssistant = row.role === "assistant" && (row.who === "preyas" || row.who === "paid");
      const hasModel = row.model === "preyas" || row.model === "deepseek-flash";
      if (!isAssistant || !hasModel) continue;
      if (COMMAND_REPLY.test(String(row.content || ""))) continue;
      let question = "";
      for (let j = i - 1; j >= 0; j--) {
        if (rows[j].role === "user") {
          question = String(rows[j].content || "");
          break;
        }
      }
      return savePair(dataDir, { q: question, a: String(row.content || ""), source: "chat", now });
    }
    return { saved: false, reason: "the last messages have no model answer to save" };
  } catch {
    return { saved: false, reason: "could not read the last chat" };
  }
}
