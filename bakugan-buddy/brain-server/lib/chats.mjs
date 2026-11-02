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
import { partnerFromTurns } from "../../packages/alive/src/chatTurn.ts";
import { appendSummary, historyDir, normalizeEntry } from "./history.mjs";

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
    return { chats: [] };
  }
}

export function writeIndex(root, chats) {
  const dir = historyDir(root);
  fs.mkdirSync(dir, { recursive: true });
  const ordered = [...chats].sort((a, b) => b.updated - a.updated);
  fs.writeFileSync(indexPath(root), JSON.stringify({ chats: ordered }, null, 2) + "\n");
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

/** Read one chat's newest turns, plus the shared summary and bond. */
export function readChat(root, id, limit = 40) {
  const chat = findChat(root, id);
  if (!chat) return null;
  const summaryPath = path.join(historyDir(root), "summary.txt");
  const summary = fs.existsSync(summaryPath) ? fs.readFileSync(summaryPath, "utf8") : "";
  const file = chatFile(root, id);
  if (!fs.existsSync(file)) return { chat, summary, messages: [], partner: partnerFromTurns(0) };
  let userTurns = 0;
  const parsed = [];
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line) continue;
    try {
      const row = JSON.parse(line);
      parsed.push(row);
      if (row.role === "user" || row.who === "user") userTurns += 1;
    } catch {
      /* skip a torn line */
    }
  }
  const start = parsed.length > limit ? parsed.length - limit : 0;
  return { chat, summary, messages: parsed.slice(start), partner: partnerFromTurns(userTurns) };
}

/** Append one turn, retitle a fresh chat from the first user line, touch `updated`. */
export function appendMessage(root, id, entry) {
  const chat = findChat(root, id);
  if (!chat) return null;
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
