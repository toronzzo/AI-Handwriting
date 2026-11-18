/**
 * The router hook shared by every Preyas OS slice. proxy.mjs calls
 * handleOsRoute once, right after the pairing/auth gate, and never needs
 * another change: later slices only add routes inside this file.
 */
import { PREYAS_CHAT_PERSONA } from "../../../packages/alive/src/persona.ts";
import fs from "node:fs";
import path from "node:path";
import { asMs, crisisLine, dayKey, readEvents, readSettings, summarizeDay } from "./events.mjs";
import { createSendMemory, confirmLine, logParsedEvents, normalizeSentence, undoEvents } from "./eventsConfirm.mjs";
import { parseEvents } from "./eventsParse.mjs";
import { reviewAction } from "./guard.mjs";
import { readGuardLog } from "./guardLog.mjs";
import { listVersions, loadPersona } from "./persona.mjs";
import { allowPaid } from "../coach/spendGate.mjs";
import { loadSkills } from "../coach/skills.mjs";

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

/** Answers with JSON and tells the caller the route handled it. */
function answered(res, status, body) {
  sendJson(res, status, body);
  return true;
}

const sendMemory = createSendMemory();

/** Reads a JSON body through the proxy helper; a thrown HttpError keeps its status. */
async function readJsonOr(res, ctx) {
  try {
    return await ctx.readJson(ctx.req);
  } catch (err) {
    const status = err && typeof err.status === "number" ? err.status : 400;
    sendJson(res, status, { error: String((err && err.message) || "bad json") });
    return null;
  }
}

function recentFoods(dataDir, nowMs, tz) {
  const from = dayKey(nowMs - 4 * 3600 * 1000, tz);
  const to = dayKey(nowMs, tz);
  return readEvents(dataDir, { from, to, types: ["food"] }).filter((event) => Number(event.ts) >= nowMs - 4 * 3600 * 1000);
}

/**
 * handleOsRoute(ctx) -> true when it answered, false when the path is not one
 * of its routes. ctx = { req, res, url, dataDir, readJson, readBody, now }.
 */
export async function handleOsRoute(ctx) {
  const { req, res, url, dataDir } = ctx;
  // ctx.now may return a Date or a number (proxy passes Date.now()); always hand out a Date.
  const now = () => {
    const value = typeof ctx.now === "function" ? ctx.now() : Date.now();
    return value instanceof Date ? value : new Date(value);
  };
  const nowMs = asMs(now());

  if (url.pathname === "/v1/persona" && req.method === "GET") {
    const persona = loadPersona(dataDir, { defaultText: PREYAS_CHAT_PERSONA, now });
    return answered(res, 200, persona);
  }

  if (url.pathname === "/v1/persona/versions" && req.method === "GET") {
    // Revision lines only; the persona text never leaves the live file.
    return answered(res, 200, { versions: listVersions(dataDir) });
  }

  if (url.pathname === "/v1/events/log" && req.method === "POST") {
    if (!dataDir) return answered(res, 503, { error: "drive_missing" });
    const body = await readJsonOr(res, ctx);
    if (body === null) return true;
    const text = String(body.text || "").replace(/\s+/g, " ").trim();
    if (!text) return answered(res, 400, { error: "empty text" });
    if (text.length > 2000) return answered(res, 400, { error: "text too long (2000 chars max)" });
    const src = String(body.src || "chat").slice(0, 20);
    const settings = readSettings(dataDir);
    const key = `${src}\n${normalizeSentence(text)}`;
    const remembered = sendMemory.lookup(key, nowMs);
    if (remembered) return answered(res, 200, remembered);

    const parsed = parseEvents(text, {
      now: nowMs,
      tz: settings.tz,
      currency: settings.currency,
      recent: recentFoods(dataDir, nowMs, settings.tz),
    });
    let result;
    if (parsed.crisis) {
      // Nothing from a crisis sentence is ever written, not even raw.
      result = { saved: false, crisis: true, line: crisisLine(dataDir) };
    } else if (parsed.ask) {
      result = { saved: false, ask: parsed.ask };
    } else if (!parsed.events.length) {
      result = { saved: false, events: 0, line: null };
    } else {
      const events = logParsedEvents(dataDir, parsed, { src, rawText: text, ts: parsed.ts });
      result = {
        saved: true,
        ids: events.map((event) => event.id),
        line: confirmLine(events, text),
        undoUntil: parsed.ts + 10_500,
      };
    }
    sendMemory.put(key, result, nowMs);
    return answered(res, 200, result);
  }

  if (url.pathname === "/v1/events/undo" && req.method === "POST") {
    if (!dataDir) return answered(res, 503, { error: "drive_missing" });
    const body = await readJsonOr(res, ctx);
    if (body === null) return true;
    const ids = Array.isArray(body.ids) ? body.ids.map((id) => String(id)) : [];
    const settings = readSettings(dataDir);
    return answered(res, 200, undoEvents(dataDir, ids, nowMs, { tz: settings.tz }));
  }

  if (url.pathname === "/v1/events" && req.method === "GET") {
    if (!dataDir) return answered(res, 503, { error: "drive_missing" });
    const from = url.searchParams.get("from") || null;
    const to = url.searchParams.get("to") || null;
    const type = url.searchParams.get("type") || null;
    const events = readEvents(dataDir, {
      from,
      to,
      types: type ? [type] : null,
      raw: url.searchParams.get("raw") === "1",
    });
    return answered(res, 200, { events });
  }

  if (url.pathname === "/v1/events/summary" && req.method === "GET") {
    if (!dataDir) return answered(res, 503, { error: "drive_missing" });
    const settings = readSettings(dataDir);
    const day = url.searchParams.get("day") || dayKey(nowMs, settings.tz);
    return answered(res, 200, summarizeDay(dataDir, day, { tz: settings.tz }));
  }

  if (url.pathname === "/v1/guard/review" && req.method === "POST") {
    const body = await readJsonOr(res, ctx);
    if (body === null) return true;
    const action = body.action && typeof body.action === "object" ? body.action : null;
    if (!action || typeof action.kind !== "string") {
      return answered(res, 400, { error: "action.kind is required" });
    }
    // Dry run: nothing executes; the audit line is still written.
    const review = await reviewAction(action, {
      dataDir,
      now: () => nowMs,
      allowPaid: dataDir ? allowPaid : null,
    });
    return answered(res, 200, review);
  }

  if (url.pathname === "/v1/guard/log" && req.method === "GET") {
    if (!dataDir) return answered(res, 503, { error: "drive_missing" });
    const day = url.searchParams.get("day") || null;
    return answered(res, 200, { lines: readGuardLog(dataDir, day) });
  }

  if (url.pathname === "/v1/coach/voice-intent" && req.method === "POST") {
    const body = await readJsonOr(res, ctx);
    if (body === null) return true;
    const normalized = String(body.text || "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
    const WORDS = new Set([
      "done",
      "ok",
      "next",
      "back",
      "why",
      "where am i",
      "stop",
      "готово",
      "дальше",
      "назад",
      "почему",
      "где я",
      "стоп",
    ]);
    let autoSend = WORDS.has(normalized);
    // On a Danger step only why/back may auto-send; nothing else goes by voice alone.
    if (autoSend && !["why", "почему", "back", "назад"].includes(normalized) && dangerOfCurrentStep(dataDir)) {
      autoSend = false;
    }
    return answered(res, 200, { autoSend, normalized });
  }

  return false;
}

/** Reads the persisted coach session and tells whether the current step is Danger. */
function dangerOfCurrentStep(dataDir) {
  if (!dataDir) return false;
  try {
    const saved = JSON.parse(fs.readFileSync(path.join(dataDir, "coach", "session.json"), "utf8"));
    if (!saved || !saved.session || saved.session.mode !== "skill") return false;
    const entry = loadSkills(path.join(dataDir, "coach", "skills")).find(
      (row) => row.ok && row.skill.name === saved.session.skillName,
    );
    if (!entry) return false;
    const step = entry.skill.steps[saved.session.step - 1];
    return Boolean(step && step.danger);
  } catch {
    return false;
  }
}
