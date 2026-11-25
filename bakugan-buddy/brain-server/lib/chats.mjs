/**
 * Saved conversations on the Agent drive.
 *
 * Each chat is its own file, `history/chats/<id>.jsonl`, with one JSON turn per
 * line. `history/index.json` lists them newest first: id, title, created,
 * updated. The short summary in `history/summary.txt` stays global on purpose:
 * a new chat starts with an empty window but Preyas still remembers the old
 * ones. Nothing here is committed; the drive is the only store.
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { partnerFromAreas } from "../../packages/alive/src/rpgLevel.ts";
import { appendSummary, historyDir, normalizeEntry, writeTextAtomic } from "./history.mjs";
import { rpgToday } from "./os/rpg.mjs";

export const NEW_CHAT_TITLE = "New chat";
export const FIRST_CHAT_TITLE = "First chat";
export const TITLE_MAX = 40;
const RENAME_MAX = 80;
const ID_RE = /^[A-Za-z0-9_-]+$/;

export function chatsDir(root) {
  return path.join(historyDir(root), "chats");
}

export function indexPath(root) {
  return path.join(historyDir(root), "index.json");
}

export function assertId(id) {
  if (typeof id !== "string" || !ID_RE.test(id)) throw new Error("bad chat id");
  return id;
}

export function chatFile(root, id) {
  return path.join(chatsDir(root), `${assertId(id)}.jsonl`);
}

/** First user message, collapsed to one line and trimmed for the list. */
export function titleFrom(text, max = TITLE_MAX) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) return NEW_CHAT_TITLE;
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max).trimEnd()}…`;
}

function recoveredChat(root, name) {
  const id = name.slice(0, -".jsonl".length);
  if (!ID_RE.test(id)) return null;
  const file = chatFile(root, id);
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    return null;
  }
  let title = NEW_CHAT_TITLE;
  try {
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      if (!line) continue;
      const row = JSON.parse(line);
      if (row.role === "user" || row.who === "user") {
        title = titleFrom(row.content);
        break;
      }
    }
  } catch {
    /* a torn recovered chat still deserves its place in the list */
  }
  const created = Math.round(stat.birthtimeMs || stat.mtimeMs || Date.now());
  const updated = Math.round(stat.mtimeMs || created);
  return { id, title, created, updated };
}

/** Rebuild the list from the chat files after a torn or missing index. */
export function recoverIndex(root) {
  const dir = chatsDir(root);
  if (!fs.existsSync(dir)) return { chats: [] };
  const chats = fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".jsonl"))
    .map((name) => recoveredChat(root, name))
    .filter(Boolean);
  return { chats: writeIndex(root, chats) };
}

export function readIndex(root) {
  const file = indexPath(root);
  if (!fs.existsSync(file)) return { chats: [] };
  try {
    const body = JSON.parse(fs.readFileSync(file, "utf8"));
    const chats = Array.isArray(body?.chats) ? body.chats : [];
    return {
      chats: chats
        .filter((chat) => chat && typeof chat.id === "string" && ID_RE.test(chat.id))
        .map((chat) => ({
          id: chat.id,
          title: String(chat.title || NEW_CHAT_TITLE),
          created: Number(chat.created) || 0,
          updated: Number(chat.updated) || 0,
        })),
    };
  } catch {
    // A torn index must never make every saved chat disappear.
    return recoverIndex(root);
  }
}

export function writeIndex(root, chats) {
  const dir = historyDir(root);
  fs.mkdirSync(dir, { recursive: true });
  const ordered = [...chats].sort((a, b) => b.updated - a.updated);
  const file = indexPath(root);
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, JSON.stringify({ chats: ordered }, null, 2) + "\n");
  fs.renameSync(temp, file);
  return ordered;
}

/**
 * First start: copy the old single-file log into a chat called "First chat".
 * The source `history/chat.jsonl` is copied, never moved or deleted.
 */
export function migrateLegacy(root) {
  if (fs.existsSync(indexPath(root))) return { migrated: false, id: null };
  fs.mkdirSync(chatsDir(root), { recursive: true });
  const legacy = path.join(historyDir(root), "chat.jsonl");
  if (!fs.existsSync(legacy)) {
    writeIndex(root, []);
    return { migrated: false, id: null };
  }
  const id = "first";
  fs.copyFileSync(legacy, chatFile(root, id));
  const stat = fs.statSync(legacy);
  const created = Math.round(stat.birthtimeMs || stat.mtimeMs || Date.now());
  const updated = Math.round(stat.mtimeMs || created);
  writeIndex(root, [{ id, title: FIRST_CHAT_TITLE, created, updated }]);
  return { migrated: true, id };
}

/** Index entries, newest first. Runs the one-time migration. */
export function listChats(root) {
  migrateLegacy(root);
  return readIndex(root).chats;
}

function findChat(root, id) {
  assertId(id);
  return readIndex(root).chats.find((chat) => chat.id === id) || null;
}

/** Keep `updated` strictly increasing so the list order never depends on ties. */
function nextStamp(chats, wanted) {
  const newest = chats.reduce((max, chat) => Math.max(max, chat.updated || 0), 0);
  return Math.max(wanted, newest + 1);
}

export function createChat(root, title = NEW_CHAT_TITLE) {
  migrateLegacy(root);
  const index = readIndex(root);
  const now = nextStamp(index.chats, Date.now());
  const chat = {
    id: randomUUID(),
    title: titleFrom(title) === NEW_CHAT_TITLE ? NEW_CHAT_TITLE : String(title).trim().slice(0, RENAME_MAX),
    created: now,
    updated: now,
  };
  fs.mkdirSync(chatsDir(root), { recursive: true });
  fs.writeFileSync(chatFile(root, chat.id), "");
  writeIndex(root, [...index.chats, chat]);
  return chat;
}

/** True when a row is a day briefing rather than an ordinary message. */
export function isBriefingRow(row) {
  if (!row) return false;
  if (row.briefingDay) return true;
  return Boolean(dayFromContent(row.content));
}

/**
 * Keep at most one briefing per day, the newest, and every ordinary message.
 *
 * Old files can hold several briefings for the same day (a re-run, a restart
 * during delivery). They should never be shown twice, and a device must not
 * have to care: filter here, on the way out, so it holds for saved data too.
 */
export function oneBriefingPerDay(rows) {
  const newest = new Map();
  rows.forEach((row, index) => {
    const day = row && (row.briefingDay || dayFromContent(row.content));
    if (!day) return;
    const previous = newest.get(day);
    if (!previous || Number(row.t || 0) >= Number(previous.t || 0)) newest.set(day, { index, t: row.t });
  });
  const keep = new Set([...newest.values()].map((entry) => entry.index));
  return rows.filter((row, index) => !isBriefingRow(row) || keep.has(index));
}

/**
 * Level and bond for every chat. They come from the life log Today already
 * uses, so opening another thread cannot reset Preyas.
 */
export function drivePartner(root) {
  let total = 0;
  try {
    const today = rpgToday(root);
    for (const value of Object.values(today.areaXp || {})) total += Number(value) || 0;
  } catch {
    total = 0;
  }
  return partnerFromAreas(total);
}

/** Read one chat's newest turns, plus the shared summary and bond. */
export function readChat(root, id, limit = 40) {
  const chat = findChat(root, id);
  if (!chat) return null;
  const summaryPath = path.join(historyDir(root), "summary.txt");
  const summary = fs.existsSync(summaryPath) ? fs.readFileSync(summaryPath, "utf8") : "";
  const partner = drivePartner(root);
  const file = chatFile(root, id);
  if (!fs.existsSync(file)) return { chat, summary, messages: [], partner };
  const parsed = [];
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line) continue;
    try {
      parsed.push(JSON.parse(line));
    } catch {
      /* skip a torn line */
    }
  }
  const shown = oneBriefingPerDay(parsed);
  const start = shown.length > limit ? shown.length - limit : 0;
  return { chat, summary, messages: shown.slice(start), partner };
}

/** Remove one exact saved message and everything after it. */
export function removeMessageAndAfter(root, id, messageT) {
  const chat = findChat(root, id);
  if (!chat || !Number.isFinite(Number(messageT))) return null;
  const file = chatFile(root, id);
  const rows = readRows(file);
  const index = rows.findIndex((row) => Number(row?.t) === Number(messageT));
  if (index < 0) return null;
  const kept = rows.slice(0, index);
  writeTextAtomic(file, kept.map((row) => `${JSON.stringify(row)}\n`).join(""));
  return { chat, removed: rows.length - kept.length };
}

/** Append one turn, retitle a fresh chat from the first user line, touch `updated`. */
export function appendMessage(root, id, entry) {
  const chat = findChat(root, id);
  if (!chat) return null;
  // A briefing is one message per day: writing another replaces that day's.
  // The day comes from the raw entry, because normalizeEntry drops the tag.
  const day = String(entry?.briefingDay || "").trim() || dayFromContent(entry?.content);
  if (day) {
    const saved = upsertDayMessage(root, id, day, entry);
    return saved ? { chat: saved.chat, summary: "" } : null;
  }
  const line = normalizeEntry(entry);
  const index = readIndex(root);
  const stamp = nextStamp(index.chats, line.t);
  fs.mkdirSync(chatsDir(root), { recursive: true });
  fs.appendFileSync(chatFile(root, id), JSON.stringify(line) + "\n");
  const summary = appendSummary(root, line);
  const next = index.chats.map((row) => {
    if (row.id !== id) return row;
    const titled =
      (row.title === NEW_CHAT_TITLE || !row.title) && (line.role === "user" || line.who === "user")
        ? titleFrom(line.content)
        : row.title;
    return { ...row, title: titled, updated: stamp };
  });
  writeIndex(root, next);
  return { chat: next.find((row) => row.id === id), summary };
}

function readRows(file) {
  const rows = [];
  if (!fs.existsSync(file)) return rows;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line));
    } catch {
      /* skip a torn line */
    }
  }
  return rows;
}

/**
 * One message per day: drop any earlier message for `day` (tagged with
 * briefingDay, or an old one starting "Briefing YYYY-MM-DD") and add the new
 * one. Rewrites the chat file atomically.
 */
export function upsertDayMessage(root, id, day, entry) {
  const chat = findChat(root, id);
  if (!chat) return null;
  const file = chatFile(root, id);
  const rows = readRows(file);
  const kept = rows.filter((row) => !isMessageForDay(row, day));
  const line = { ...normalizeEntry(entry), briefingDay: day };
  const removed = rows.length - kept.length;
  fs.mkdirSync(chatsDir(root), { recursive: true });
  writeTextAtomic(file, kept.map((row) => `${JSON.stringify(row)}\n`).join("") + `${JSON.stringify(line)}\n`);
  const index = readIndex(root);
  const stamp = nextStamp(index.chats, line.t);
  const next = index.chats.map((row) => (row.id === id ? { ...row, updated: stamp } : row));
  writeIndex(root, next);
  return { chat: next.find((row) => row.id === id), removed };
}

function isMessageForDay(row, day) {
  if (!row) return false;
  if (row.briefingDay) return row.briefingDay === day;
  return dayFromContent(row.content) === day;
}

/** "Briefing 2026-11-02 ..." -> "2026-11-02". */
export function dayFromContent(content) {
  const match = String(content ?? "").match(/^\s*Briefing\s+(\d{4}-\d{2}-\d{2})\b/);
  return match ? match[1] : "";
}

/**
 * One-time tidy for the reused "Daily briefing" chat: keep only the newest
 * message per day. Copies the file to <name>.bak-<timestamp> first, and does
 * nothing (no copy) when there is nothing to drop.
 */
export function collapseBriefingChat(root, id, now = Date.now()) {
  const file = chatFile(root, id);
  const rows = readRows(file);
  const seen = new Set();
  const keptIndexes = new Set();
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const day = rows[i].briefingDay || dayFromContent(rows[i].content);
    if (!day) {
      keptIndexes.add(i);
      continue;
    }
    if (seen.has(day)) continue;
    seen.add(day);
    keptIndexes.add(i);
  }
  const removed = rows.length - keptIndexes.size;
  if (removed === 0) return { removed: 0, backup: "" };
  const backup = `${file}.bak-${now}`;
  fs.copyFileSync(file, backup);
  const kept = rows.filter((_, index) => keptIndexes.has(index));
  writeTextAtomic(file, kept.map((row) => `${JSON.stringify(row)}\n`).join(""));
  return { removed, backup };
}

/**
 * One-time tidy for saved data: drop older copies of the same day's briefing in
 * EVERY chat, keeping the newest. Ordinary messages are never touched, and each
 * file is copied to <name>.bak-<timestamp> before it is rewritten. A file with
 * nothing to drop is not copied and not written.
 */
export function collapseBriefingsEverywhere(root, now = Date.now()) {
  const dir = chatsDir(root);
  if (!fs.existsSync(dir)) return { removed: 0, backups: [] };
  let removed = 0;
  const backups = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".jsonl")) continue;
    const file = path.join(dir, name);
    let rows;
    try {
      rows = readRows(file);
    } catch {
      continue;
    }
    const kept = oneBriefingPerDay(rows);
    if (kept.length === rows.length) continue;
    const backup = `${file}.bak-${now}`;
    fs.copyFileSync(file, backup);
    writeTextAtomic(file, kept.map((row) => `${JSON.stringify(row)}\n`).join(""));
    removed += rows.length - kept.length;
    backups.push(backup);
  }
  return { removed, backups };
}

export function renameChat(root, id, title) {
  const clean = String(title || "").trim().slice(0, RENAME_MAX);
  if (!clean) throw new Error("empty title");
  const index = readIndex(root);
  if (!index.chats.some((chat) => chat.id === id)) return null;
  const stamp = nextStamp(index.chats, Date.now());
  const next = index.chats.map((chat) => (chat.id === id ? { ...chat, title: clean, updated: stamp } : chat));
  writeIndex(root, next);
  return next.find((chat) => chat.id === id);
}

export function deleteChat(root, id) {
  const index = readIndex(root);
  if (!index.chats.some((chat) => chat.id === id)) return false;
  try {
    fs.unlinkSync(chatFile(root, id));
  } catch {
    /* the file is already gone; the index entry still has to go */
  }
  writeIndex(root, index.chats.filter((chat) => chat.id !== id));
  return true;
}

/** The newest chat, for clients that still post to the legacy /v1/history. */
export function newestChat(root) {
  const chats = listChats(root);
  return chats[0] || null;
}
