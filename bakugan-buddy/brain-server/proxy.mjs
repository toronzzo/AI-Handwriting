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
import { addNote, deleteNote, loadNotes, searchNotes, updateNote } from "./lib/notes.mjs";
import { askForNotes, chatLines } from "./lib/notesExtract.mjs";
import { fetchPageText, searchWeb } from "./lib/webSearch.mjs";
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
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
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

const server = http.createServer(async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }
  const url = new URL(req.url || "/", `http://${host}`);

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
      const body = model === "paid" ? sampled : withNotes(sampled);
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

server.listen(port, host, () => {
  process.stdout.write(`brain proxy ${host}:${port} -> ${llamaUrl}\n`);
});
