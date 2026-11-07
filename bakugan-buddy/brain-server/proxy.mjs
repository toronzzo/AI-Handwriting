/**
 * LAN front door for llama-server.
 * Adds CORS for Expo web, a discovery health check, and appends room
 * memory onto the external drive. The model itself stays on localhost.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { FACT_EXTRACT_PROMPT } from "../packages/alive/src/longMemory.ts";
import { openMemory, parseExtractedFacts, relevantFacts, rememberFacts } from "./lib/memory.mjs";
import { synthesizeFile, transcribeFile } from "./lib/speech.mjs";
import { withSampling } from "./lib/sampling.mjs";
import { mergeHistoryFiles, paidAvailability } from "./lib/history.mjs";
import { appendMessage, createChat, deleteChat, listChats, newestChat, readChat, renameChat } from "./lib/chats.mjs";
import { clipTooShort, isWhisperHallucination } from "../packages/alive/src/speech.ts";
import { notesContext, queryForRetrieval } from "../packages/alive/src/notes.ts";
import { driveMapPrompt, isDriveQuestion, isScanDriveCommand, whereIsQuery } from "../packages/alive/src/driveMap.ts";
import { addNote, deleteNote, loadNotes, searchNotes, updateNote } from "./lib/notes.mjs";
import { askForNotes, chatLines } from "./lib/notesExtract.mjs";
import { fetchPageText, searchWeb } from "./lib/webSearch.mjs";
import { INBOX_PATH, listDocuments, readDocumentText, safeDocumentName } from "./lib/documents.mjs";
import { collectStatus, restartArgs } from "./lib/status.mjs";
import { collectUserNotes, ensureObsidianConfig, exportVault, searchVault, saveToVault, VAULT_DIR } from "./lib/vault.mjs";
import { buildDriveMap, loadDriveMap, DRIVE_ROOT } from "./lib/driveMap.mjs";
import {
  buildDeck,
  buildQuiz,
  deleteDeck,
  dueCards,
  dueCount,
  gradeCard,
  listDecks,
  loadDeck,
  recordQuiz,
  saveDeck,
} from "./lib/study.mjs";
import {
  addDevice,
  attemptPair,
  authorizeRequest,
  createPairingState,
  currentCode,
  readDevices,
  removeDevice,
  touchDevice,
  writeDevices,
} from "./lib/pairing.mjs";
import {
  BRIEFING_CHAT_TITLE,
  dayKey,
  gatherFacts,
  hasBriefingToday,
  loadSettings,
  readBriefing,
  readLastBriefingDay,
  saveBriefing,
  saveSettings,
  shouldRun,
  topLine,
  writeBriefing,
} from "./lib/briefing.mjs";
import { spawn } from "node:child_process";
import {
  addReminder,
  deleteReminder,
  loadReminders,
  missedOnStartup,
  notify,
  tick,
  updateReminder,
} from "./lib/reminders.mjs";
import { answerFromDocument, keyPointsFrom, summarizeDocument } from "./lib/docSummary.mjs";
import { listTasks, loadTask, newTask, pauseInterrupted, saveTask } from "./lib/tasks.mjs";
import { launchTaskRun, planTask, taskRunActive } from "./lib/taskRunner.mjs";
import os from "node:os";

const llamaUrl = (process.env.LLAMA_URL || "http://127.0.0.1:8790").replace(/\/$/, "");
const port = Number(process.env.BRAIN_PORT || 8788);
const host = process.env.BRAIN_HOST || "0.0.0.0";
const dataDir = process.env.BAKUGAN_DATA_DIR || "";
const gatewayRoot = process.env.AGENT_DRIVE_ROOT || "/Volumes/Agent/agent";
const buddyRoot = "/Volumes/Agent/BakuganBuddy";

function syncHistory() {
  if (!dataDir) return;
  mergeHistoryFiles(dataDir, gatewayRoot);
  mergeHistoryFiles(dataDir, buddyRoot);
}
const label = process.env.BRAIN_LABEL || "preyas";
const warn = process.env.BRAIN_WARN === "1";

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Preyas-Token");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,PUT,DELETE,OPTIONS");
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function readBody(req, limit = 64_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        if (!tooLarge) {
          tooLarge = true;
          reject(new HttpError(413, "body too large"));
        }
        return;
      }
      if (!tooLarge) chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function readJson(req, limit = 64_000) {
  const body = await readBody(req, limit);
  try {
    return JSON.parse(body.toString("utf8") || "{}");
  } catch {
    throw new HttpError(400, "bad json");
  }
}

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

const CHAT_PROXY_TIMEOUT_MS = Number(process.env.BRAIN_UPSTREAM_TIMEOUT_MS || 90_000);

/** Pipe one model response, but stop paying for generation after the client leaves. */
async function pipeChatCompletion(req, res, target, body, downError) {
  const controller = new AbortController();
  let timedOut = false;
  let clientClosed = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, CHAT_PROXY_TIMEOUT_MS);
  const onClose = () => {
    if (!res.writableEnded) {
      clientClosed = true;
      controller.abort();
    }
  };
  res.on("close", onClose);
  try {
    let upstream;
    try {
      upstream = await fetch(target, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        signal: controller.signal,
      });
    } catch {
      if (clientClosed) return;
      sendJson(res, timedOut ? 504 : 503, { error: timedOut ? "model timed out" : downError });
      return;
    }
    res.writeHead(upstream.status, {
      "Content-Type": upstream.headers.get("content-type") || "text/event-stream",
      "Cache-Control": "no-cache",
    });
    if (!upstream.body) {
      res.end(await upstream.text());
      return;
    }
    const reader = upstream.body.getReader();
    for (;;) {
      const step = await reader.read();
      if (step.done || clientClosed) break;
      res.write(step.value);
    }
    if (!clientClosed) res.end();
  } catch {
    if (!clientClosed && !res.writableEnded) {
      if (!res.headersSent) sendJson(res, timedOut ? 504 : 503, { error: timedOut ? "model timed out" : downError });
      else res.end();
    }
  } finally {
    clearTimeout(timer);
    res.off("close", onClose);
    controller.abort();
  }
}


let memoryBook = null;
function book() {
  if (!dataDir) return null;
  if (!memoryBook) memoryBook = openMemory(path.join(dataDir, "memory", "facts.sqlite"));
  return memoryBook;
}

function extractLater(payload) {
  const events = Array.isArray(payload.events) ? payload.events : [];
  let moment = `mood=${payload.mood || ""}\nline=${payload.line || ""}\n`;
  for (let i = 0; i < events.length && i < 8; i++) {
    const event = events[i] || {};
    moment += `${event.name || ""} ${event.detail || ""}\n`;
  }
  void fetch(`${llamaUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    signal: AbortSignal.timeout(30_000),
    body: JSON.stringify({
      model: "preyas",
      stream: false,
      temperature: 0,
      max_tokens: 120,
      cache_prompt: true,
      id_slot: 1,
      messages: [
        { role: "system", content: FACT_EXTRACT_PROMPT },
        { role: "user", content: moment },
      ],
    }),
  })
    .then(async (res) => {
      if (!res.ok) return;
      const json = await res.json();
      const content = json.choices?.[0]?.message?.content || "";
      const facts = parseExtractedFacts(content);
      const store = book();
      if (store && facts.length) rememberFacts(store, facts);
    })
    .catch(() => {});
}

/**
 * Put the five most relevant notes in front of the local model. The paid route
 * keeps the deployment's stable prefix, so notes are never injected there.
 */
function withNotes(raw) {
  if (!dataDir) return raw;
  let json;
  try {
    json = JSON.parse(raw.toString("utf8"));
  } catch {
    return raw;
  }
  if (!json || !Array.isArray(json.messages)) return raw;
  const lastUser = [...json.messages].reverse().find((message) => message && message.role === "user");
  const content = typeof lastUser?.content === "string" ? lastUser.content : "";
  const hits = searchNotes(dataDir, queryForRetrieval(content), 5);
  if (!hits.length) return raw;
  const messages = [...json.messages];
  const firstSystem = messages.findIndex((message) => message && message.role === "system");
  messages.splice(firstSystem >= 0 ? firstSystem + 1 : 0, 0, { role: "system", content: notesContext(hits) });
  json.messages = messages;
  return Buffer.from(JSON.stringify(json));
}

/**
 * Put the drive map in front of the local model when the partner asks about
 * the drive, files, folders, models or datasets. "scan my drive" re-scans
 * first; "where is X" is answered with the matching names listed first.
 */
function withDriveMap(raw) {
  if (!dataDir) return raw;
  let json;
  try {
    json = JSON.parse(raw.toString("utf8"));
  } catch {
    return raw;
  }
  if (!json || !Array.isArray(json.messages)) return raw;
  const lastUser = [...json.messages].reverse().find((message) => message && message.role === "user");
  const content = typeof lastUser?.content === "string" ? lastUser.content : "";
  if (!isDriveQuestion(content)) return raw;
  if (isScanDriveCommand(content)) {
    try {
      rescanDrive();
    } catch {
      /* a failed scan still answers from the last map */
    }
  }
  const map = currentDriveMap();
  if (!map) return raw;
  const prompt = driveMapPrompt(map, whereIsQuery(content) || undefined);
  const messages = [...json.messages];
  const firstSystem = messages.findIndex((message) => message && message.role === "system");
  messages.splice(firstSystem >= 0 ? firstSystem + 1 : 0, 0, { role: "system", content: prompt });
  json.messages = messages;
  return Buffer.from(JSON.stringify(json));
}

/** Best-effort note extraction after a reply; never awaited by a request. */
async function extractNotesForChat(chatId) {
  if (!dataDir) return;
  try {
    const book = readChat(dataDir, chatId, 6);
    if (!book || !book.messages.length) return;
    const items = await askForNotes(llamaUrl, chatLines(book.messages));
    for (const item of items) {
      addNote(dataDir, { text: item.text, kind: item.kind, sourceChatId: chatId });
    }
  } catch {
    /* notes are a bonus, not part of the reply */
  }
}

/** Plan a task, save it, then run it in the background. */
async function startTask(title, chatId) {
  const seed = searchNotes(dataDir, title, 4)
    .map((note) => `- ${note.text}`)
    .join("\n");
  const steps = await planTask(llamaUrl, title, seed);
  const task = newTask(dataDir, { title, chatId, steps });
  const run = launchTaskRun(dataDir, task, { llamaUrl });
  if (run) void run.catch(() => {});
  return task;
}

/** Summaries in flight, so the UI can poll progress. */
const docJobs = new Map();

function docJobKey(name) {
  return String(name).toLowerCase();
}

const pairing = createPairingState();

/** The Mac's Wi-Fi address, for the iPhone URL. */
function lanAddress() {
  for (const name of ["en0", "en1"]) {
    const found = Object.values(os.networkInterfaces()[name] || []).find(
      (row) => row && row.family === "IPv4" && !row.internal,
    );
    if (found) return found.address;
  }
  return "";
}

/** Summaries the document route already produced, for the vault. */
function documentSummaries() {
  const out = [];
  try {
    const dir = path.join(dataDir, "memory", "docs");
    if (!fs.existsSync(dir)) return out;
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith(".json")) continue;
      try {
        const row = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
        if (row && row.name && row.summary) out.push({ name: row.name, summary: row.summary, at: Number(row.at) || Date.now() });
      } catch {
        /* skip a broken summary */
      }
    }
  } catch {
    /* no summaries yet */
  }
  return out;
}

/** Files the user edited that we have already imported, by path -> fingerprint. */
const vaultKnown = new Map();
let vaultState = { lastSync: 0, notes: 0, imported: 0 };

/** The drive map lives in memory after the first load or scan. */
let driveMapCache = null;
const DAY_MS = 24 * 60 * 60 * 1000;

function currentDriveMap() {
  if (driveMapCache) return driveMapCache;
  driveMapCache = loadDriveMap(dataDir);
  return driveMapCache;
}

function rescanDrive() {
  driveMapCache = buildDriveMap(DRIVE_ROOT, dataDir);
  return driveMapCache;
}

/** Re-scan the drive once a day, riding the reminder tick. */
function maybeScanDrive() {
  if (!dataDir) return;
  try {
    const map = currentDriveMap();
    if (!map || Date.now() - (map.scanned || 0) > DAY_MS) rescanDrive();
  } catch {
    /* the map is a convenience, never critical */
  }
}

/** Chat highlights for a day, from that day's chat files. */
function highlightsFor(day) {
  const lines = [];
  try {
    const dir = path.join(dataDir, "history", "chats");
    if (!fs.existsSync(dir)) return lines;
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith(".jsonl")) continue;
      for (const raw of fs.readFileSync(path.join(dir, name), "utf8").split("\n")) {
        if (!raw.trim()) continue;
        try {
          const row = JSON.parse(raw);
          if (dayKey(new Date(row.t || 0)) !== day) continue;
          const who = row.who === "user" ? "You" : "Preyas";
          const text = String(row.content || "").replace(/\s+/g, " ").trim();
          if (text) lines.push(`${who}: ${text.slice(0, 120)}`);
        } catch {
          /* skip a torn line */
        }
      }
    }
  } catch {
    /* highlights are a bonus */
  }
  return lines.slice(-12);
}

/** Write the vault, then read back anything the user changed. */
function syncVault() {
  if (!dataDir) return vaultState;
  try {
    ensureObsidianConfig(VAULT_DIR);
    const briefings = [];
    const dir = path.join(dataDir, "memory", "briefings");
    if (fs.existsSync(dir)) {
      for (const name of fs.readdirSync(dir)) {
        if (!name.endsWith(".md")) continue;
        const day = name.slice(0, -3);
        const text = fs.readFileSync(path.join(dir, name), "utf8").replace(/^#[^\n]*\n/, "").trim();
        briefings.push({ day, text });
      }
    }
    const decks = listDecks(dataDir).map((deck) => ({
      id: deck.id,
      title: deck.title,
      language: deck.language,
      createdAt: deck.createdAt,
      cards: deck.cards.map((card) => ({ question: card.question, answer: card.answer })),
    }));
    const documents = documentSummaries();
    const highlights = {};
    for (const briefing of briefings) highlights[briefing.day] = highlightsFor(briefing.day);
    exportVault(
      {
        notes: loadNotes(dataDir).map((note) => ({
          id: note.id,
          text: note.text,
          kind: note.kind,
          created: note.created,
          updated: note.updated,
        })),
        reminders: loadReminders(dataDir),
        decks,
        documents,
        briefings,
        highlights,
      },
      { root: VAULT_DIR },
    );
    const imported = collectUserNotes({ root: VAULT_DIR, known: Object.fromEntries(vaultKnown) });
    for (const note of imported) {
      vaultKnown.set(note.path, note.fingerprint);
      if (note.text.length >= 4) {
        addNote(dataDir, { text: note.text.slice(0, 240), kind: "fact", sourceChatId: "obsidian" });
      }
      for (const task of note.tasks) addNote(dataDir, { text: task.slice(0, 240), kind: "todo", sourceChatId: "obsidian" });
    }
    vaultState = {
      lastSync: Date.now(),
      notes: listDecks(dataDir).length + loadNotes(dataDir).length,
      imported: imported.length,
    };
  } catch {
    /* the vault is a mirror, never critical */
  }
  return vaultState;
}

/** One long-lived "Daily briefing" chat, reused every day. */
function briefingChatId() {
  const existing = listChats(dataDir).find((chat) => chat.title === BRIEFING_CHAT_TITLE);
  if (existing) return existing.id;
  return createChat(dataDir, BRIEFING_CHAT_TITLE).id;
}

/** Build, save and deliver one briefing. Returns { day, text }. */
async function runBriefing(options = {}) {
  const now = options.now || new Date();
  const day = dayKey(now);
  const facts = gatherFacts(dataDir, {
    now,
    buddyRoot: buddyRoot,
    lastBriefingDay: readLastBriefingDay(dataDir),
  });
  const written = await writeBriefing(facts, { llamaUrl, fetchImpl: options.fetchImpl });
  saveBriefing(dataDir, day, written.text);
  if (options.deliver !== false) {
    void notify("Preyas: your day", topLine(written.text));
    try {
      appendMessage(dataDir, briefingChatId(), {
        role: "assistant",
        who: "preyas",
        model: "preyas",
        content: `Briefing ${day}\n\n${written.text}`,
      });
    } catch {
      /* the chat is a convenience; the file is the record */
    }
  }
  return { day, text: written.text, model: written.model };
}

/** Called from the reminder tick: no separate timer. */
function maybeBriefing() {
  try {
    const settings = loadSettings(dataDir);
    if (!shouldRun(new Date(), settings, hasBriefingToday(dataDir))) return;
    void runBriefing({}).catch(() => {});
  } catch {
    /* a missed briefing is not fatal */
  }
}

const server = http.createServer(async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }
  const url = new URL(req.url || "/", `http://${host}`);

  // The phone must pair once; this machine never does.
  const gate = authorizeRequest({
    path: url.pathname,
    method: req.method,
    remoteAddress: req.socket?.remoteAddress || "",
    token: req.headers["x-preyas-token"] || "",
    book: dataDir ? readDevices(dataDir) : { devices: [] },
    pairing,
  });
  if (!gate.allow) {
    res.writeHead(gate.status, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: gate.error, pair: gate.status === 401 }));
    return;
  }
  if (gate.device && dataDir) {
    try {
      touchDevice(readDevices(dataDir), req.headers["x-preyas-token"] || "");
    } catch {
      /* last-seen is a nicety */
    }
  }

  try {
    if (req.method === "GET" && url.pathname === "/v1/health") {
      let llama = false;
      try {
        const probe = await fetch(`${llamaUrl}/health`, { signal: AbortSignal.timeout(2_000) });
        llama = probe.ok;
      } catch {
        llama = false;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          ok: llama,
          service: "bakugan-brain",
          model: label,
          warn,
          llama: llamaUrl,
        }),
      );
      return;
    }

    if (req.method === "GET" && url.pathname === "/v1/speech") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          stt: Boolean(process.env.WHISPER_MODEL),
          tts: Boolean(process.env.PIPER_PYTHON || process.env.BAKUGAN_DATA_DIR),
          voices: { en: "am_puck", ru: "ru_RU-dmitri-medium" },
        }),
      );
      return;
    }

    if (req.method === "POST" && url.pathname === "/v1/stt") {
      const wav = await readBody(req, 4_000_000);
      if (clipTooShort(wav)) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ text: "", language: "en" }));
        return;
      }
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "preyas-hear-"));
      const file = path.join(dir, "in.wav");
      fs.writeFileSync(file, wav);
      try {
        const heard = await transcribeFile(file);
        if (!heard) {
          res.writeHead(503, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "stt_unavailable" }));
          return;
        }
        if (isWhisperHallucination(heard.text)) heard.text = "";
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(heard));
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
      return;
    }

    if (req.method === "POST" && url.pathname === "/v1/tts") {
      const payload = await readJson(req);
      const wav = await synthesizeFile(payload);
      if (!wav) {
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "tts_unavailable" }));
        return;
      }
      res.writeHead(200, { "Content-Type": "audio/wav" });
      res.end(wav);
      return;
    }

    if (req.method === "GET" && url.pathname === "/v1/facts") {
      const store = book();
      const facts = store ? relevantFacts(store, url.searchParams.get("q") || "", 4) : [];
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ facts }));
      return;
    }

    if (req.method === "POST" && url.pathname === "/v1/facts") {
      const payload = await readJson(req);
      res.writeHead(202, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      extractLater(payload);
      return;
    }

    if (req.method === "POST" && url.pathname === "/v1/memory") {
      if (!dataDir) {
        res.writeHead(503);
        res.end();
        return;
      }
      const body = await readBody(req);
      const dir = path.join(dataDir, "memory");
      fs.mkdirSync(dir, { recursive: true });
      fs.appendFileSync(path.join(dir, "room.jsonl"), body.toString("utf8").trim() + "\n");
      res.writeHead(204);
      res.end();
      return;
    }

    if (url.pathname === "/v1/pair" && req.method === "POST") {
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      const result = attemptPair({
        code: String(body.code || ""),
        pairing,
        name: String(body.name || "iPhone"),
      });
      if (!result.ok) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: result.error }));
        return;
      }
      if (dataDir) {
        writeDevices(dataDir, addDevice(readDevices(dataDir), result.token, result.name));
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, token: result.token, name: result.name }));
      return;
    }

    if (url.pathname === "/v1/phone" && req.method === "GET") {
      const ip = lanAddress();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          lanIp: ip,
          phoneUrl: ip ? `http://${ip}:8081` : "",
          brainUrl: ip ? `http://${ip}:8788` : "",
          pairingCode: currentCode(pairing),
          devices: dataDir ? readDevices(dataDir).devices.length : 0,
        }),
      );
      return;
    }

    if (url.pathname === "/v1/briefing/today" && req.method === "GET") {
      if (!dataDir) {
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "drive missing" }));
        return;
      }
      const day = dayKey(new Date());
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ day, text: readBriefing(dataDir, day), settings: loadSettings(dataDir) }));
      return;
    }

    if (url.pathname === "/v1/briefing/run" && req.method === "POST") {
      if (!dataDir) {
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "drive missing" }));
        return;
      }
      try {
        const result = await runBriefing({});
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, ...result }));
      } catch (error) {
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
      }
      return;
    }

    if (url.pathname === "/v1/briefing/settings") {
      if (!dataDir) {
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "drive missing" }));
        return;
      }
      if (req.method === "GET") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(loadSettings(dataDir)));
        return;
      }
      if (req.method === "PATCH" || req.method === "PUT") {
        const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(saveSettings(dataDir, body)));
        return;
      }
    }

    if (req.method === "GET" && url.pathname === "/v1/status") {
      const status = await collectStatus({ drive: "/Volumes/Agent", buddy: buddyRoot });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(status));
      return;
    }

    if (req.method === "GET" && url.pathname === "/v1/drive-map/status") {
      const map = currentDriveMap();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify(
          map
            ? { ok: true, scanned: map.scanned, files: map.totalFiles, folders: map.folders.length, models: map.models.length, size: map.totalSize }
            : { ok: false, scanned: 0, files: 0 },
        ),
      );
      return;
    }

    if (req.method === "POST" && url.pathname === "/v1/restart") {
      const launcher = path.join(process.cwd(), "..", "launcher");
      try {
        const child = spawn("/bin/bash", restartArgs(launcher), { detached: true, stdio: "ignore" });
        child.unref();
        res.writeHead(202, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, restarting: true }));
      } catch (error) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
      }
      return;
    }

    if (url.pathname === "/v1/vault/sync" && req.method === "POST") {
      const state = syncVault();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, ...state }));
      return;
    }

    if (url.pathname === "/v1/vault/status" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          path: VAULT_DIR,
          obsidianUrl: "obsidian://open?vault=vault",
          ...vaultState,
        }),
      );
      return;
    }

    if (url.pathname === "/v1/vault/search" && req.method === "GET") {
      const query = (url.searchParams.get("q") || "").trim();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ query, results: searchVault(query, { root: VAULT_DIR }) }));
      return;
    }

    if (url.pathname === "/v1/vault/save" && req.method === "POST") {
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      const title = String(body.title || "Chat note").slice(0, 80);
      const text = String(body.text || "").slice(0, 20000);
      if (!text.trim()) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "nothing to save" }));
        return;
      }
      const saved = saveToVault(title, text, { root: VAULT_DIR });
      res.writeHead(201, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, ...saved }));
      return;
    }

    if (url.pathname === "/v1/study/decks") {
      if (!dataDir) {
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "drive missing" }));
        return;
      }
      if (req.method === "GET") {
        const now = Date.now();
        const decks = listDecks(dataDir).map((deck) => ({
          id: deck.id,
          title: deck.title,
          language: deck.language,
          cards: deck.cards.length,
          due: dueCount(deck, now),
          quizzes: deck.quizzes.length,
          updatedAt: deck.updatedAt,
        }));
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ decks }));
        return;
      }
      if (req.method === "POST") {
        const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
        const name = String(body.document || "").trim();
        if (!name) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "document is required" }));
          return;
        }
        try {
          const book = await readDocumentText(name);
          const deck = await buildDeck(dataDir, {
            title: name.replace(/\.[a-z0-9]+$/i, ""),
            name,
            text: book.text,
            language: String(body.language || "en"),
            llamaUrl,
          });
          res.writeHead(201, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, deck: { id: deck.id, title: deck.title, cards: deck.cards.length } }));
        } catch (error) {
          res.writeHead(502, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
        }
        return;
      }
    }

    const deckRoute = url.pathname.match(/^\/v1\/study\/decks\/([^/]+)(?:\/(review|quiz|due))?$/);
    if (deckRoute) {
      if (!dataDir) {
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "drive missing" }));
        return;
      }
      const id = decodeURIComponent(deckRoute[1]);
      const action = deckRoute[2];
      try {
        const deck = loadDeck(dataDir, id);
        if (!deck) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "deck not found" }));
          return;
        }
        if (!action && req.method === "GET") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ deck, due: dueCards(deck).length }));
          return;
        }
        if (!action && req.method === "DELETE") {
          const ok = deleteDeck(dataDir, id);
          res.writeHead(ok ? 200 : 404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok }));
          return;
        }
        if (action === "due" && req.method === "GET") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ cards: dueCards(deck), total: deck.cards.length }));
          return;
        }
        if (action === "review" && req.method === "POST") {
          const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
          const graded = gradeCard(dataDir, id, String(body.cardId || ""), String(body.grade || ""));
          if (!graded) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "unknown card or grade" }));
            return;
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, card: graded.card, due: dueCount(graded.deck) }));
          return;
        }
        if (action === "quiz" && req.method === "POST") {
          const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
          if (body.result) {
            const updated = recordQuiz(dataDir, id, body.result);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true, saved: true, quizzes: updated ? updated.quizzes.length : 0 }));
            return;
          }
          const source = deck.cards.map((card) => `${card.question} ${card.answer}`).join("\n");
          const questions = await buildQuiz(llamaUrl, source, {
            language: deck.language,
            question: String(body.topic || ""),
          });
          if (!questions.length) {
            res.writeHead(502, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: false, error: "the model did not return a usable quiz" }));
            return;
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, questions }));
          return;
        }
      } catch (error) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
        return;
      }
    }

    if (url.pathname === "/v1/reminders") {
      if (!dataDir) {
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "drive missing" }));
        return;
      }
      if (req.method === "GET") {
        const rows = loadReminders(dataDir).sort(
          (left, right) => new Date(left.dueAt).getTime() - new Date(right.dueAt).getTime(),
        );
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ reminders: rows }));
        return;
      }
      if (req.method === "POST") {
        const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
        const when = new Date(String(body.dueAt || ""));
        if (Number.isNaN(when.getTime())) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "dueAt must be a date" }));
          return;
        }
        const reminder = addReminder(dataDir, {
          text: body.text,
          dueAt: when.toISOString(),
          repeat: body.repeat,
          chatId: body.chatId,
        });
        res.writeHead(201, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ reminder }));
        return;
      }
    }

    const reminderRoute = url.pathname.match(/^\/v1\/reminders\/([^/]+)$/);
    if (reminderRoute) {
      if (!dataDir) {
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "drive missing" }));
        return;
      }
      const id = decodeURIComponent(reminderRoute[1]);
      try {
        if (req.method === "PATCH" || req.method === "PUT") {
          const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
          const reminder = updateReminder(dataDir, id, body);
          res.writeHead(reminder ? 200 : 404, { "Content-Type": "application/json" });
          res.end(JSON.stringify(reminder ? { reminder } : { error: "reminder not found" }));
          return;
        }
        if (req.method === "DELETE") {
          const ok = deleteReminder(dataDir, id);
          res.writeHead(ok ? 200 : 404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok }));
          return;
        }
      } catch (error) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
        return;
      }
    }

    if (req.method === "GET" && url.pathname === "/v1/documents") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          inbox: INBOX_PATH,
          documents: listDocuments(INBOX_PATH),
          jobs: [...docJobs.values()].map((job) => ({ name: job.name, done: job.done, total: job.total, status: job.status })),
        }),
      );
      return;
    }

    const docRoute = url.pathname.match(/^\/v1\/documents\/([^/]+)\/(text|summarize|ask|notes|summary)$/);
    if (docRoute) {
      let name;
      try {
        name = safeDocumentName(decodeURIComponent(docRoute[1]));
      } catch (error) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
        return;
      }
      const action = docRoute[2];

      if (action === "text" && req.method === "GET") {
        try {
          const book = await readDocumentText(name);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ name, preview: book.text.slice(0, 6000), length: book.text.length, cached: book.cached }));
        } catch (error) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
        }
        return;
      }

      if (action === "summary" && req.method === "GET") {
        const job = docJobs.get(docJobKey(name));
        if (!job) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "no summary for this document yet" }));
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            ok: job.status === "done",
            name,
            status: job.status,
            done: job.done,
            total: job.total,
            summary: job.summary,
            points: job.points,
            error: job.error,
          }),
        );
        return;
      }

      if (action === "ask" && req.method === "POST") {
        const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
        const question = String(body.question || "").trim();
        if (!question) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "question is required" }));
          return;
        }
        try {
          const book = await readDocumentText(name);
          const answer = await answerFromDocument(book.text, question, { llamaUrl });
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, name, question, answer }));
        } catch (error) {
          res.writeHead(502, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
        }
        return;
      }

      if (action === "summarize" && req.method === "POST") {
        const key = docJobKey(name);
        const running = docJobs.get(key);
        if (running && running.status === "running") {
          res.writeHead(202, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, running: true, ...running }));
          return;
        }
        const job = { name, done: 0, total: 0, status: "running", started: Date.now() };
        docJobs.set(key, job);
        void (async () => {
          try {
            const book = await readDocumentText(name);
            const summary = await summarizeDocument(book.text, {
              llamaUrl,
              onProgress: (done, total) => {
                job.done = done;
                job.total = total;
              },
            });
            job.status = "done";
            job.summary = summary;
            job.points = keyPointsFrom(summary);
            // Keep it for the vault, which mirrors summaries as Markdown.
            try {
              const dir = path.join(dataDir, "memory", "docs");
              fs.mkdirSync(dir, { recursive: true });
              fs.writeFileSync(
                path.join(dir, `${name}.json`),
                JSON.stringify({ name, summary, at: Date.now() }),
              );
            } catch {
              /* the vault copy is a bonus */
            }
          } catch (error) {
            job.status = "error";
            job.error = error instanceof Error ? error.message : String(error);
          }
        })();
        res.writeHead(202, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, running: true, name, done: 0, total: 0, status: "running" }));
        return;
      }

      if (action === "notes" && req.method === "POST") {
        const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
        const points = Array.isArray(body.points) ? body.points : [];
        if (!dataDir) {
          res.writeHead(503, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "drive missing" }));
          return;
        }
        let saved = 0;
        for (const point of points.slice(0, 10)) {
          const added = addNote(dataDir, {
            text: String(point?.text || ""),
            kind: String(point?.kind || "fact"),
            sourceChatId: String(body.chatId || ""),
          });
          if (added.note && !added.duplicate) saved += 1;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, saved }));
        return;
      }
    }

    if (req.method === "GET" && url.pathname === "/v1/search") {
      const query = (url.searchParams.get("q") || "").trim();
      if (!query) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "q is required" }));
        return;
      }
      const result = await searchWeb(query, { root: dataDir || undefined });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          ok: result.ok,
          query,
          cached: Boolean(result.cached),
          results: result.results,
          error: result.ok ? undefined : result.error,
        }),
      );
      return;
    }

    if (req.method === "GET" && url.pathname === "/v1/search/page") {
      const target = (url.searchParams.get("url") || "").trim();
      const page = await fetchPageText(target);
      res.writeHead(page.ok ? 200 : 400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: page.ok, url: target, text: page.text, error: page.error }));
      return;
    }

    if (url.pathname === "/v1/tasks") {
      if (!dataDir) {
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "drive missing" }));
        return;
      }
      if (req.method === "GET") {
        const active = url.searchParams.get("active") === "1";
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ tasks: listTasks(dataDir, { active }) }));
        return;
      }
      if (req.method === "POST") {
        const body = await readJson(req);
        const title = String(body.title || "").trim().slice(0, 300);
        if (!title) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "task title is empty" }));
          return;
        }
        try {
          const task = await startTask(title, String(body.chatId || ""));
          res.writeHead(201, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ task }));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          res.writeHead(502, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: `could not plan the task: ${message}` }));
        }
        return;
      }
    }

    const taskRoute = url.pathname.match(/^\/v1\/tasks\/([^/]+)(\/resume)?$/);
    if (taskRoute) {
      if (!dataDir) {
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "drive missing" }));
        return;
      }
      const id = decodeURIComponent(taskRoute[1]);
      const resuming = Boolean(taskRoute[2]);
      try {
        const task = loadTask(dataDir, id);
        if (!task) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "task not found" }));
          return;
        }
        if (resuming && req.method === "POST") {
          if (task.status !== "done") {
            if (taskRunActive(task.id)) {
              sendJson(res, 409, { error: "task is already running", task });
              return;
            }
            for (const step of task.steps) {
              if (step.status === "running" || step.status === "error") step.status = "pending";
            }
            task.status = "planned";
            task.updated = Date.now();
            saveTask(dataDir, task);
            const run = launchTaskRun(dataDir, task, { llamaUrl });
            if (!run) {
              sendJson(res, 409, { error: "task is already running", task: loadTask(dataDir, task.id) || task });
              return;
            }
            void run.catch(() => {});
          }
          sendJson(res, 200, { task: loadTask(dataDir, task.id) || task });
          return;
        }
        if (!resuming && req.method === "GET") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ task }));
          return;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: message }));
        return;
      }
    }

    if (url.pathname === "/v1/notes") {
      if (!dataDir) {
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "drive missing" }));
        return;
      }
      if (req.method === "GET") {
        const query = (url.searchParams.get("q") || "").trim();
        const asked = Number(url.searchParams.get("limit") || 0);
        const limit = Number.isFinite(asked) && asked > 0 ? Math.min(asked, 100) : 50;
        const notes = query
          ? searchNotes(dataDir, query, limit)
          : [...loadNotes(dataDir)].sort((left, right) => right.updated - left.updated).slice(0, limit);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ notes }));
        return;
      }
      if (req.method === "POST") {
        const body = await readJson(req);
        const saved = addNote(dataDir, body);
        if (!saved.note) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "note text is too short" }));
          return;
        }
        res.writeHead(201, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ note: saved.note, duplicate: saved.duplicate }));
        return;
      }
    }

    const noteRoute = url.pathname.match(/^\/v1\/notes\/([^/]+)$/);
    if (noteRoute) {
      if (!dataDir) {
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "drive missing" }));
        return;
      }
      const id = decodeURIComponent(noteRoute[1]);
      try {
        if (req.method === "PATCH" || req.method === "PUT") {
          const body = await readJson(req);
          const note = updateNote(dataDir, id, body);
          res.writeHead(note ? 200 : 404, { "Content-Type": "application/json" });
          res.end(JSON.stringify(note ? { note } : { error: "note not found" }));
          return;
        }
        if (req.method === "DELETE") {
          const ok = deleteNote(dataDir, id);
          res.writeHead(ok ? 200 : 404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok }));
          return;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: message }));
        return;
      }
    }

    if (url.pathname === "/v1/chats") {
      if (!dataDir) {
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "drive missing" }));
        return;
      }
      if (req.method === "GET") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ chats: listChats(dataDir) }));
        return;
      }
      if (req.method === "POST") {
        const body = await readJson(req);
        const chat = createChat(dataDir, typeof body.title === "string" ? body.title : undefined);
        res.writeHead(201, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ chat }));
        return;
      }
    }

    const chatRoute = url.pathname.match(/^\/v1\/chats\/([^/]+)(\/messages)?$/);
    if (chatRoute) {
      if (!dataDir) {
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "drive missing" }));
        return;
      }
      const id = decodeURIComponent(chatRoute[1]);
      const onMessages = Boolean(chatRoute[2]);
      try {
        if (onMessages && req.method === "POST") {
          const body = await readJson(req);
          const saved = appendMessage(dataDir, id, body);
          if (!saved) {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "chat not found" }));
            return;
          }
          if (body && (body.role === "assistant" || body.who === "preyas" || body.who === "paid")) {
            void extractNotesForChat(id);
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, chat: saved.chat, summary: saved.summary }));
          return;
        }
        if (!onMessages && req.method === "GET") {
          const asked = Number(url.searchParams.get("limit") || 40);
          const limit = Number.isFinite(asked) && asked > 0 ? Math.min(asked, 200) : 40;
          const book = readChat(dataDir, id, limit);
          if (!book) {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "chat not found" }));
            return;
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(book));
          return;
        }
        if (!onMessages && (req.method === "PATCH" || req.method === "PUT")) {
          const body = await readJson(req);
          const chat = renameChat(dataDir, id, body.title);
          if (!chat) {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "chat not found" }));
            return;
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ chat }));
          return;
        }
        if (!onMessages && req.method === "DELETE") {
          const ok = deleteChat(dataDir, id);
          res.writeHead(ok ? 200 : 404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok }));
          return;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: message }));
        return;
      }
    }

    if (req.method === "GET" && url.pathname === "/v1/history") {
      syncHistory();
      if (!dataDir) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ summary: "", messages: [] }));
        return;
      }
      const newest = newestChat(dataDir);
      const book = newest ? readChat(dataDir, newest.id, 40) : { summary: "", messages: [], partner: undefined };
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ summary: book.summary, messages: book.messages, partner: book.partner }));
      return;
    }

    if (req.method === "POST" && url.pathname === "/v1/history") {
      if (!dataDir) {
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "drive missing" }));
        return;
      }
      const entry = await readJson(req);
      const chat = newestChat(dataDir) || createChat(dataDir);
      const saved = appendMessage(dataDir, chat.id, entry);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, summary: saved ? saved.summary : "" }));
      return;
    }

    if (req.method === "GET" && url.pathname === "/v1/paid") {
      let envText = "";
      const secretDirs = [gatewayRoot, dataDir].filter(Boolean);
      for (let i = 0; i < secretDirs.length && !envText; i++) {
        try {
          envText = fs.readFileSync(path.join(secretDirs[i], "secrets", ".env"), "utf8");
        } catch {
          envText = "";
        }
      }
      const status = paidAvailability(envText);
      let gateway = false;
      try {
        const probe = await fetch("http://127.0.0.1:4000/v1/models", { signal: AbortSignal.timeout(2_000) });
        gateway = probe.ok;
      } catch {
        gateway = false;
      }
      if (status.available && !gateway) {
        status.available = false;
        status.reason = "DeepSeek key is set, but the gateway on port 4000 is not running";
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(status));
      return;
    }

    if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
      const raw = await readBody(req);
      let model = "";
      try {
        model = JSON.parse(raw.toString("utf8")).model || "";
      } catch {
        model = "";
      }
      const sampled = withSampling(raw);
      const body = model === "paid" ? sampled : withDriveMap(withNotes(sampled));
      const target =
        model === "paid"
          ? "http://127.0.0.1:4000/v1/chat/completions"
          : `${llamaUrl}/v1/chat/completions`;
      await pipeChatCompletion(
        req,
        res,
        target,
        body,
        model === "paid" ? "paid gateway is down" : "llama is down",
      );
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not_found" }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = error instanceof HttpError ? error.status : 500;
    if (!res.headersSent) res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: message }));
  }
});

if (dataDir) {
  try {
    pauseInterrupted(dataDir);
  } catch {
    /* tasks are resumable, not critical */
  }
}

let reminderTimer = null;

/** Every 30 s: fire due reminders, notify, and post them into their chat. */
function startReminderLoop() {
  if (!dataDir || reminderTimer) return;
  reminderTimer = setInterval(() => {
    try {
      const result = tick(dataDir, {
        notifyImpl: (title, body) => {
          void notify(title, body);
        },
      });
      for (const reminder of result.fired) {
        if (reminder.chatId) {
          appendMessage(dataDir, reminder.chatId, {
            role: "assistant",
            who: "preyas",
            model: "preyas",
            content: `⏰ Reminder: ${reminder.text}`,
          });
        }
      }
      maybeBriefing();
      syncVault();
      maybeScanDrive();
    } catch {
      /* a bad reminder must not stop the loop */
    }
  }, 30_000);
  if (typeof reminderTimer.unref === "function") reminderTimer.unref();
}

function missedAtStartup() {
  if (!dataDir) return;
  try {
    const message = missedOnStartup(loadReminders(dataDir));
    if (!message) return;
    void notify("Preyas", message);
    const newest = newestChat(dataDir);
    if (newest) {
      appendMessage(dataDir, newest.id, {
        role: "assistant",
        who: "preyas",
        model: "preyas",
        content: `${message}\nPreyas is back.`,
      });
    }
  } catch {
    /* missing reminders are not fatal */
  }
}

server.listen(port, host, () => {
  process.stdout.write(`brain proxy ${host}:${port} -> ${llamaUrl}\n`);
  startReminderLoop();
  missedAtStartup();
  if (dataDir) {
    try {
      rescanDrive();
    } catch {
      /* the map will be built on the next tick */
    }
  }
});
