/**
 * What Preyas knows about itself, and what it says once after an update.
 *
 * - The capability summary comes from capabilities.mjs (checked at startup).
 * - The changelog comes from CHANGELOG_PREYAS.md.
 * - The first chat after a new entry starts with "New since last time: ...".
 *   That note is claimed once and stored in <dataDir>/memory/self-knowledge.json,
 *   so a reload or a second chat does not repeat it.
 */
import fs from "node:fs";
import path from "node:path";
import { readChangelog } from "./changelog.mjs";

export const SELF_KNOWLEDGE_VERSION = 1;
/** ~400 tokens. The capability summary uses at most 1400 chars. */
export const PROMPT_MAX_CHARS = 1600;
export const INTRO_MAX_ITEMS = 3;

export function statePath(dataDir) {
  return path.join(dataDir, "memory", "self-knowledge.json");
}

export function readState(file, fsImpl = fs) {
  if (!file) return { v: SELF_KNOWLEDGE_VERSION, seen: [], seenAt: null };
  try {
    if (!fsImpl.existsSync(file)) return { v: SELF_KNOWLEDGE_VERSION, seen: [], seenAt: null };
    const body = JSON.parse(fsImpl.readFileSync(file, "utf8"));
    const seen = Array.isArray(body?.seen) ? body.seen.filter((id) => typeof id === "string") : [];
    return {
      v: SELF_KNOWLEDGE_VERSION,
      seen: [...new Set(seen)],
      seenAt: typeof body?.seenAt === "string" ? body.seenAt : null,
    };
  } catch {
    return { v: SELF_KNOWLEDGE_VERSION, seen: [], seenAt: null };
  }
}

export function writeState(file, state, fsImpl = fs, now = () => new Date()) {
  if (!file) return false;
  try {
    fsImpl.mkdirSync(path.dirname(file), { recursive: true });
    const body = {
      v: SELF_KNOWLEDGE_VERSION,
      seen: [...new Set(Array.isArray(state?.seen) ? state.seen : [])],
      seenAt: typeof state?.seenAt === "string" ? state.seenAt : new Date(now()).toISOString(),
    };
    const temp = file + ".tmp";
    fsImpl.writeFileSync(temp, JSON.stringify(body, null, 2) + "\n");
    fsImpl.renameSync(temp, file);
    return true;
  } catch {
    return false;
  }
}

function nowIso(now) {
  const value = typeof now === "function" ? now() : now;
  const date = value instanceof Date ? value : new Date(value ?? Date.now());
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function trimTo(text, maxChars) {
  const value = String(text ?? "");
  if (value.length <= maxChars) return value;
  const cut = value.slice(0, Math.max(0, maxChars - 1));
  const at = cut.lastIndexOf("\n");
  return (at > 0 ? cut.slice(0, at) : cut) + "…";
}

/** The sentence the user actually sees. The model is not asked to invent it. */
export function newsSentence(items) {
  const lines = (items || []).map((item) => String(item.text || "").trim()).filter(Boolean);
  if (!lines.length) return "";
  return "New since last time: " + lines.join(" ");
}

export function createSelfKnowledge(options = {}) {
  const {
    dataDir = "",
    changelogPath = "",
    items = null,
    capabilities = null,
    now = () => new Date(),
    fsImpl = fs,
    promptMaxChars = PROMPT_MAX_CHARS,
  } = options;

  const stateFile = dataDir ? statePath(dataDir) : "";
  let state = readState(stateFile, fsImpl);
  let changelog = Array.isArray(items) ? items : readChangelog(changelogPath, { fsImpl }).items;
  let introItems = [];
  let introPending = false;
  /** Set while one reply is carrying the sentence, cleared when it is shown or dropped. */
  let claim = "";

  function recomputeIntro() {
    const seen = new Set(state.seen || []);
    const fresh = changelog.filter((item) => item && item.id && !seen.has(item.id));
    introItems = fresh.slice(0, INTRO_MAX_ITEMS);
    introPending = introItems.length > 0;
  }

  function markSeen() {
    state = {
      v: SELF_KNOWLEDGE_VERSION,
      seen: [...new Set(changelog.map((item) => item.id))],
      seenAt: nowIso(now),
    };
    writeState(stateFile, state, fsImpl, now);
    introPending = false;
    introItems = [];
    claim = "";
  }

  /**
   * Take the one-time sentence for the reply that is about to be sent.
   * Nothing is stored yet: a failed reply calls cancelNews and the next chat
   * can still say it. A second chat in flight gets "" so it is not said twice.
   */
  function beginNews() {
    if (claim || !introPending) return "";
    const line = newsSentence(introItems);
    if (!line) return "";
    claim = line;
    return line;
  }

  function commitNews() {
    if (!claim) return false;
    markSeen();
    return true;
  }

  function cancelNews() {
    if (!claim) return false;
    claim = "";
    return true;
  }

  function reload() {
    state = readState(stateFile, fsImpl);
    changelog = readChangelog(changelogPath, { fsImpl }).items;
    recomputeIntro();
    return { changelog: changelog.length, introPending, introItems };
  }

  async function promptForChat() {
    let snapshot = null;
    if (capabilities) {
      try {
        snapshot = capabilities.snapshot ? capabilities.snapshot() : null;
        if ((!snapshot || !snapshot.summary) && typeof capabilities.refresh === "function") snapshot = await capabilities.refresh();
      } catch {
        snapshot = null;
      }
    }
    const summary = String(snapshot?.summary || "").trim() || "What you can do right now: not checked yet.";
    // The news sentence is written onto the reply itself. Asking the model to
    // start with it, and marking it seen before the user sees anything, is why
    // "New since last time" never showed up.
    return trimTo(summary, promptMaxChars);
  }

  function about() {
    return {
      changelog,
      newSinceLastTime: introPending ? introItems : [],
    };
  }

  recomputeIntro();

  return {
    promptForChat,
    about,
    reload,
    markSeen,
    beginNews,
    commitNews,
    cancelNews,
    state: () => ({ ...state, seen: [...state.seen] }),
    introPending: () => introPending,
  };
}

/**
 * Add the self-knowledge block to a chat request, right after the first system
 * message. Only requests with a user message are touched. Returns the raw body
 * unchanged when there is nothing to add.
 */
export async function withSelfKnowledge(raw, selfKnowledge) {
  if (!selfKnowledge) return raw;
  let json;
  try {
    json = JSON.parse(Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw));
  } catch {
    return raw;
  }
  if (!json || !Array.isArray(json.messages)) return raw;
  if (!json.messages.some((message) => message && message.role === "user")) return raw;
  let block = "";
  try {
    block = await selfKnowledge.promptForChat();
  } catch {
    block = "";
  }
  if (!String(block || "").trim()) return raw;
  const messages = [...json.messages];
  const firstSystem = messages.findIndex((message) => message && message.role === "system");
  messages.splice(firstSystem >= 0 ? firstSystem + 1 : 0, 0, { role: "system", content: String(block) });
  json.messages = messages;
  return Buffer.from(JSON.stringify(json));
}
