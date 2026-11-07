/**
 * The daily briefing.
 *
 * The items are built by code from local facts only, most urgent first, so the
 * model can never invent or drop one. The local model writes a single short
 * opening line, given only the number and kinds of items — never their text.
 * If there is nothing to say, the briefing says so plainly and invents nothing.
 */
import fs from "node:fs";
import path from "node:path";
import { loadNotes } from "./notes.mjs";
import { listTasks } from "./tasks.mjs";
import { loadReminders } from "./reminders.mjs";
import { listDocuments } from "./documents.mjs";
import { localParts, warsawWallTime } from "../../packages/alive/src/reminders.ts";

export const DEFAULT_TIME = "08:30";
export const BRIEFING_CHAT_TITLE = "Daily briefing";
export const EMPTY_OPENING = "Nothing on your plate today — quiet waters.";
export const FALLBACK_OPENING = "Morning, partner! Here's your day.";
const DEADLINE_WINDOW_DAYS = 7;
const MAX_ITEMS = 6;
const OPENING_MAX = 120;
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

export function briefingsDir(root) {
  return path.join(root, "memory", "briefings");
}

export function settingsPath(root) {
  return path.join(root, "memory", "settings.json");
}

export function briefingPath(root, day) {
  return path.join(briefingsDir(root), `${day}.md`);
}

export function briefingJsonPath(root, day) {
  return path.join(briefingsDir(root), `${day}.json`);
}

/** YYYY-MM-DD in Europe/Warsaw, not in UTC. */
export function dayKey(instant = new Date()) {
  const parts = localParts(instant);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function loadSettings(root) {
  const file = settingsPath(root);
  const fallback = { briefingTime: DEFAULT_TIME, briefingOn: true };
  if (!fs.existsSync(file)) return fallback;
  try {
    const body = JSON.parse(fs.readFileSync(file, "utf8"));
    return {
      briefingTime: validTime(body?.briefingTime) || DEFAULT_TIME,
      briefingOn: body?.briefingOn !== false,
    };
  } catch {
    return fallback;
  }
}

export function saveSettings(root, patch) {
  const current = loadSettings(root);
  const next = {
    briefingTime: validTime(patch?.briefingTime) || current.briefingTime,
    briefingOn: patch?.briefingOn === undefined ? current.briefingOn : Boolean(patch.briefingOn),
  };
  fs.mkdirSync(path.dirname(settingsPath(root)), { recursive: true });
  const temp = `${settingsPath(root)}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(next, null, 2)}\n`);
  fs.renameSync(temp, settingsPath(root));
  return next;
}

export function validTime(raw) {
  const match = String(raw ?? "").trim().match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!match) return "";
  return `${String(Number(match[1])).padStart(2, "0")}:${match[2]}`;
}

function dayStart(instant) {
  const parts = localParts(instant);
  return warsawWallTime(parts.year, parts.month, parts.day, 0, 0);
}

function addDays(instant, days) {
  return new Date(instant.getTime() + days * 86_400_000);
}

/** Everything the briefing may mention, for a fixed "now". */
export function gatherFacts(root, options = {}) {
  const {
    now = new Date(),
    buddyRoot = root,
    documentsInbox = path.join(buddyRoot, "documents"),
    lastBriefingDay = readLastBriefingDay(root),
    notes: givenNotes,
  } = options;
  const startOfToday = dayStart(now);
  const endOfToday = addDays(startOfToday, 1);
  // The window runs to the end of day 7, so "Nov 9" is still inside it.
  const deadlineEdge = addDays(startOfToday, DEADLINE_WINDOW_DAYS + 1).getTime() - 1;

  const reminders = loadReminders(root);
  const overdue = [];
  const today = [];
  for (const reminder of reminders) {
    if (reminder.status === "done") continue;
    const due = new Date(reminder.dueAt);
    if (due.getTime() < startOfToday.getTime()) overdue.push(reminder);
    else if (due.getTime() < endOfToday.getTime()) today.push(reminder);
  }
  overdue.sort((left, right) => new Date(left.dueAt).getTime() - new Date(right.dueAt).getTime());
  today.sort((left, right) => new Date(left.dueAt).getTime() - new Date(right.dueAt).getTime());

  const notes = givenNotes || loadNotes(root);
  const deadlines = notes
    .filter((note) => note.kind === "deadline")
    .filter((note) => {
      const due = deadlineDate(note.text);
      return due !== null && due >= startOfToday.getTime() && due <= deadlineEdge;
    })
    .sort((left, right) => (deadlineDate(left.text) || 0) - (deadlineDate(right.text) || 0));

  // Notes the user changed inside Obsidian, imported with sourceChatId "obsidian".
  const vaultSince = lastBriefingDay ? dayStartOfDay(lastBriefingDay) : startOfToday.getTime();
  // Notes made after the last briefing; that day's own notes only count up to now.
  const vaultEnd = lastBriefingDay === dayKey(now) ? now.getTime() + 1 : endOfToday.getTime();
  const since = Number(vaultSince) || 0;
  const until = Number(vaultEnd) || 0;
  const vaultNotes = notes.filter((note) => {
    if (note.sourceChatId !== "obsidian") return false;
    if (note.kind === "todo") return false;
    const created = Number(note.created) || 0;
    return created >= since && created < until;
  });

  const studyDue = totalStudyDue(root, now);

  const tasks = listTasks(root, { active: true }).filter(
    (task) => task.status === "paused" || task.status === "running" || task.status === "planned" || task.status === "error",
  );

  const documents = lastBriefingDay
    ? listDocuments(documentsInbox).filter((file) => dayKey(new Date(file.modified)) > lastBriefingDay)
    : [];

  return {
    day: dayKey(now),
    now,
    lastBriefingDay,
    overdue,
    today,
    deadlines,
    vaultNotes,
    tasks,
    documents,
    studyDue,
  };
}

function dayStartOfDay(day) {
  const match = String(day).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return 0;
  return warsawWallTime(Number(match[1]), Number(match[2]), Number(match[3]), 0, 0).getTime();
}

/** Flashcards due today, without importing the whole study module twice. */
function totalStudyDue(root, now) {
  try {
    const dir = path.join(root, "memory", "study", "decks");
    if (!fs.existsSync(dir)) return 0;
    let total = 0;
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith(".json")) continue;
      try {
        const deck = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
        for (const card of deck.cards || []) if ((Number(card.due) || 0) <= now.getTime()) total += 1;
      } catch {
        /* one bad deck must not break the briefing */
      }
    }
    return total;
  } catch {
    return 0;
  }
}

/** A date written inside a deadline note, or null when it names none. */
export function deadlineDate(text) {
  const raw = String(text ?? "");
  const iso = raw.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) {
    const when = warsawWallTime(Number(iso[1]), Number(iso[2]), Number(iso[3]), 12, 0);
    return when.getTime();
  }
  const monthDay = raw.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})\b/i);
  if (monthDay) {
    const month = MONTHS.indexOf(String(monthDay[1] || "").toLowerCase().slice(0, 3)) + 1;
    const day = Number(monthDay[2]);
    const year = Number(raw.match(/\b(20\d{2})\b/)?.[1] || new Date().getUTCFullYear());
    return warsawWallTime(year, month, day, 12, 0).getTime();
  }
  return null;
}

function clockOf(dueAt) {
  return new Date(dueAt).toLocaleTimeString("en-GB", {
    timeZone: "Europe/Warsaw",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** "Nov 10", for a deadline note. */
function shortDate(ms) {
  const parts = localParts(new Date(ms));
  const name = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][parts.month - 1];
  return `${name} ${parts.day}`;
}

function plural(count, one, many) {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * Every item the briefing should show, most urgent first, with how many were
 * dropped past the cap. Deterministic: same facts in, same items out.
 */
export function briefItems(facts, max = MAX_ITEMS) {
  const all = [];
  for (const reminder of facts.overdue || []) all.push(`Overdue: ${reminder.text}`);
  for (const reminder of facts.today || []) all.push(`${clockOf(reminder.dueAt)}: ${reminder.text}`);
  for (const note of facts.deadlines || []) {
    const due = deadlineDate(note.text);
    all.push(due === null ? `Deadline: ${note.text}` : `Deadline ${shortDate(due)}: ${note.text}`);
  }
  const due = Number(facts.studyDue) || 0;
  if (due > 0) all.push(`${plural(due, "flashcard", "flashcards")} due today`);
  for (const task of facts.tasks || []) all.push(`Unfinished task: ${task.title}`);
  const documents = facts.documents || [];
  if (documents.length === 1) all.push(`New document in your inbox: ${documents[0].name}`);
  else if (documents.length > 1) all.push(`${documents.length} new documents in your inbox`);
  const vault = (facts.vaultNotes || []).length;
  if (vault > 0) all.push(`${plural(vault, "note", "notes")} changed in your Obsidian vault`);
  return { items: all.slice(0, max), dropped: Math.max(0, all.length - max) };
}

/** The item lines plus a "+N more" tail. */
export function buildItems(facts, max = MAX_ITEMS) {
  const { items, dropped } = briefItems(facts, max);
  if (dropped > 0) items.push(`+${dropped} more`);
  return items;
}

/** The families present, for the model's opening line. Never the texts. */
export function itemKinds(facts) {
  const kinds = [];
  if ((facts.overdue || []).length) kinds.push("overdue reminders");
  if ((facts.today || []).length) kinds.push("reminders due today");
  if ((facts.deadlines || []).length) kinds.push("deadlines");
  if (Number(facts.studyDue) > 0) kinds.push("flashcards");
  if ((facts.tasks || []).length) kinds.push("unfinished tasks");
  if ((facts.documents || []).length) kinds.push("new inbox documents");
  if ((facts.vaultNotes || []).length) kinds.push("vault notes");
  return kinds;
}

/** The whole briefing, built by code. `opening` is filled in later. */
export function buildBriefing(facts, opening = FALLBACK_OPENING) {
  const items = buildItems(facts);
  const empty = items.length === 0;
  return { day: facts.day, opening: empty ? EMPTY_OPENING : opening, items, empty };
}

const OPENING_SYSTEM = [
  "You are Preyas, a friendly companion. Write ONE short greeting for the start of your partner's day.",
  "No lists, no bullet points, no numbers or times, no facts, no promises, no sign-off.",
  "At most 15 words. Reply with the greeting only.",
].join("\n");

/** Throw away anything that is not one short, plain, friendly line. */
export function cleanOpening(raw) {
  const text = String(raw ?? "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["'“”]+|["'“”]+$/g, "")
    .trim();
  if (!text) return "";
  if (text.length > OPENING_MAX) return "";
  if (/[\n\r]/.test(String(raw ?? "").trim().replace(/<\/?think>/gi, ""))) return "";
  if (/\d/.test(text)) return "";
  if (/^[-•*]\s/.test(text)) return "";
  if (!/[a-z]/i.test(text)) return "";
  return text;
}

/** Ask the local model for the opening line; "" when it is unreachable. */
export async function openingLine(facts, options = {}) {
  const { llamaUrl, fetchImpl = fetch, timeoutMs = 20_000 } = options;
  const count = buildItems(facts).length;
  if (!llamaUrl || count === 0) return "";
  const kinds = itemKinds(facts);
  try {
    const res = await fetchImpl(`${llamaUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "preyas",
        stream: false,
        temperature: 0.4,
        max_tokens: 40,
        chat_template_kwargs: { enable_thinking: false },
        messages: [
          { role: "system", content: OPENING_SYSTEM },
          {
            role: "user",
            content: `Their morning has ${count} thing${count === 1 ? "" : "s"} on it (${kinds.join(", ")}). Write the greeting. /no_think`,
          },
        ],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return "";
    const json = await res.json();
    return cleanOpening(json?.choices?.[0]?.message?.content);
  } catch {
    return "";
  }
}

/** Items plus an opening line. The model may only ever touch the opening. */
export async function writeBriefing(facts, options = {}) {
  const items = buildItems(facts);
  if (!items.length) return { ...buildBriefing(facts), model: false };
  const spoken = await openingLine(facts, options);
  return { ...buildBriefing(facts, spoken || FALLBACK_OPENING), model: Boolean(spoken) };
}

/** The markdown record. "#" heading only on disk; the API strips it. */
export function briefingText(briefing) {
  const lines = [briefing.opening, ""];
  for (const item of briefing.items) lines.push(`- ${item}`);
  return lines.join("\n").trimEnd();
}

/** Save the day's record: <day>.md for the vault, <day>.json for the app. */
export function saveBriefing(root, briefing) {
  fs.mkdirSync(briefingsDir(root), { recursive: true });
  const day = briefing.day;
  const file = briefingPath(root, day);
  const body = `# Briefing ${day}\n\n${briefingText(briefing)}\n`;
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, body);
  fs.renameSync(temp, file);
  const json = briefingJsonPath(root, day);
  const jsonTemp = `${json}.tmp`;
  fs.writeFileSync(jsonTemp, `${JSON.stringify(briefing, null, 2)}\n`);
  fs.renameSync(jsonTemp, json);
  return file;
}

/** The day's briefing, structured. Reads the .json, falls back to the .md. */
export function readBriefing(root, day) {
  const json = briefingJsonPath(root, day);
  if (fs.existsSync(json)) {
    try {
      const body = JSON.parse(fs.readFileSync(json, "utf8"));
      if (body && Array.isArray(body.items)) {
        return {
          day,
          opening: String(body.opening || ""),
          items: body.items.map(String),
          empty: body.items.length === 0,
        };
      }
    } catch {
      /* fall through to the markdown */
    }
  }
  const file = briefingPath(root, day);
  if (!fs.existsSync(file)) return null;
  try {
    const raw = fs.readFileSync(file, "utf8").replace(/^#[^\n]*\n/, "").trim();
    return parseBriefing(day, raw);
  } catch {
    return null;
  }
}

/** Turn the plain body of a .md file back into a briefing. */
export function parseBriefing(day, raw) {
  const items = [];
  const opening = [];
  for (const line of String(raw ?? "").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^[-•]\s+/.test(trimmed)) items.push(trimmed.replace(/^[-•]\s+/, ""));
    else if (!trimmed.startsWith("#")) opening.push(trimmed);
  }
  return { day, opening: opening.join(" "), items, empty: items.length === 0 };
}

/** The API shape: structured fields plus plain text with no "#". */
export function briefingPayload(briefing) {
  return {
    day: briefing.day,
    opening: briefing.opening,
    items: [...briefing.items],
    empty: briefing.empty,
    text: briefingText(briefing),
  };
}

/** The newest briefing day on disk, used to know what "new documents" means. */
export function readLastBriefingDay(root) {
  try {
    const names = fs
      .readdirSync(briefingsDir(root))
      .filter((name) => /^\d{4}-\d{2}-\d{2}\.md$/.test(name))
      .sort();
    return names.length ? names[names.length - 1].slice(0, 10) : "";
  } catch {
    return "";
  }
}

export function hasBriefingToday(root, now = new Date()) {
  return fs.existsSync(briefingPath(root, dayKey(now)));
}

/** The scheduled moment for a given local day, e.g. 2026-11-02 08:30 Warsaw. */
export function scheduledAt(now, time = DEFAULT_TIME) {
  const parts = localParts(now);
  const [hour, minute] = (validTime(time) || DEFAULT_TIME).split(":").map(Number);
  return warsawWallTime(parts.year, parts.month, parts.day, hour, minute);
}

/**
 * Should the scheduler make one now? True when the time has passed today, the
 * briefing is on, and there is no briefing yet for today (so a sleeping Mac
 * catches up the first time it wakes, but never twice in a day).
 */
export function shouldRun(now, settings, hasToday) {
  if (!settings.briefingOn) return false;
  if (hasToday) return false;
  return now.getTime() >= scheduledAt(now, settings.briefingTime).getTime();
}

/** The notification body: the first item, or the opening line when empty. */
export function topLine(briefing) {
  const items = Array.isArray(briefing?.items) ? briefing.items : [];
  const first = items.length
    ? String(items[0]).replace(/^[-•]\s*/, "").trim()
    : String(briefing?.opening || "").trim();
  return first ? first.slice(0, 200) : "Your briefing is ready.";
}
