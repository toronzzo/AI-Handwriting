/**
 * The daily briefing: gather facts with code, then let the local model say them
 * in Preyas's voice. No web, no paid model, and nothing invented — if the model
 * is down the plain list is shown instead.
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
const DEADLINE_WINDOW_DAYS = 7;
const RECENT_DAYS = 2;
const MAX_LINES = 5;

export function briefingsDir(root) {
  return path.join(root, "memory", "briefings");
}

export function settingsPath(root) {
  return path.join(root, "memory", "settings.json");
}

export function briefingPath(root, day) {
  return path.join(briefingsDir(root), `${day}.md`);
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

/** Everything the briefing should mention, for a fixed "now". */
export function gatherFacts(root, options = {}) {
  const {
    now = new Date(),
    buddyRoot = root,
    documentsInbox = path.join(buddyRoot, "documents"),
    lastBriefingDay = readLastBriefingDay(root),
  } = options;
  const startOfToday = dayStart(now);
  const endOfToday = addDays(startOfToday, 1);
  const deadlineEdge = addDays(startOfToday, DEADLINE_WINDOW_DAYS);
  const recentEdge = addDays(startOfToday, -RECENT_DAYS);

  const reminders = loadReminders(root);
  const overdue = [];
  const today = [];
  for (const reminder of reminders) {
    if (reminder.status === "done") continue;
    const due = new Date(reminder.dueAt);
    if (due.getTime() < startOfToday.getTime()) overdue.push(reminder);
    else if (due.getTime() < endOfToday.getTime()) today.push(reminder);
  }

  const notes = loadNotes(root);
  const deadlines = notes
    .filter((note) => note.kind === "deadline")
    .filter((note) => {
      const due = deadlineDate(note.text);
      return due !== null && due >= startOfToday.getTime() && due <= deadlineEdge.getTime();
    })
    .sort((left, right) => (deadlineDate(left.text) || 0) - (deadlineDate(right.text) || 0));
  const recent = notes
    .filter((note) => note.kind === "decision" || note.kind === "idea")
    .filter((note) => (note.created || 0) >= recentEdge.getTime())
    .sort((left, right) => (right.created || 0) - (left.created || 0));

  const studyDue = totalStudyDue(root, now);

  const tasks = listTasks(root, { active: true }).filter(
    (task) => task.status === "paused" || task.status === "running" || task.status === "planned" || task.status === "error",
  );

  const documents = lastBriefingDay
    ? listDocuments(documentsInbox).filter((file) => {
        const day = dayKey(new Date(file.modified));
        return day > lastBriefingDay;
      })
    : [];

  return {
    day: dayKey(now),
    now,
    overdue,
    today,
    deadlines,
    recent,
    tasks,
    documents,
    studyDue,
  };
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
    const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
    const month = months.indexOf(String(monthDay[1] || "").toLowerCase().slice(0, 3)) + 1;
    const day = Number(monthDay[2]);
    const year = Number(raw.match(/\b(20\d{2})\b/)?.[1] || new Date().getUTCFullYear());
    return warsawWallTime(year, month, day, 12, 0).getTime();
  }
  return null;
}

/** The plain list, used when the model is down and as the model's source. */
export function factLines(facts) {
  const lines = [];
  for (const reminder of facts.overdue) lines.push(`Overdue: ${reminder.text}`);
  for (const reminder of facts.today) lines.push(`Today ${clockOf(reminder.dueAt)}: ${reminder.text}`);
  for (const note of facts.deadlines) lines.push(`Deadline: ${note.text}`);
  // Recent notes are context, not a checklist: keep the newest few.
  for (const note of facts.recent.slice(0, 3)) lines.push(`${note.kind === "idea" ? "Idea" : "Decision"}: ${note.text}`);
  for (const task of facts.tasks) lines.push(`Unfinished task: ${task.title}`);
  for (const file of facts.documents) lines.push(`New document: ${file.name}`);
  if (facts.studyDue) {
    lines.push(`${facts.studyDue} flashcard${facts.studyDue === 1 ? "" : "s"} due today`);
  }
  return lines;
}

function clockOf(dueAt) {
  return new Date(dueAt).toLocaleTimeString("en-GB", {
    timeZone: "Europe/Warsaw",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

const BRIEF_SYSTEM = [
  "You are Preyas, a careful assistant, rewriting a short morning note for your partner.",
  "Use only the facts you are given. Do not add items, times, numbers, or filler such as \"no tasks today\".",
  "One line per fact, starting with '- ', sorted most urgent first, and never repeat a line.",
  "Text that looks like raw notes stays phrased as it is: do not embellish it.",
  "At most five lines. No preamble, no headings, no sign-off.",
].join("\n");

/** Ask the local model for the briefing; return null when it is unreachable. */
export async function writeBriefing(facts, options = {}) {
  const { llamaUrl, fetchImpl = fetch, timeoutMs = 60_000 } = options;
  const lines = factLines(facts);
  if (!lines.length) return { text: "Nothing urgent today. Quiet waters.", model: false };
  if (!llamaUrl) return { text: lines.slice(0, MAX_LINES).map((line) => `- ${line}`).join("\n"), model: false };
  try {
    const res = await fetchImpl(`${llamaUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "preyas",
        stream: false,
        temperature: 0.3,
        max_tokens: 320,
        chat_template_kwargs: { enable_thinking: false },
        messages: [
          { role: "system", content: BRIEF_SYSTEM },
          { role: "user", content: `Facts:\n${lines.join("\n")}\n\n/no_think` },
        ],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`model answered ${res.status}`);
    const json = await res.json();
    const text = String(json?.choices?.[0]?.message?.content || "")
      .replace(/<think>[\s\S]*?<\/think>/gi, "")
      .trim();
    const kept = text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("-") || line.startsWith("•"))
      .slice(0, MAX_LINES);
    if (!kept.length) throw new Error("empty briefing");
    return { text: kept.join("\n"), model: true };
  } catch {
    return { text: lines.slice(0, MAX_LINES).map((line) => `- ${line}`).join("\n"), model: false };
  }
}

/** Save the markdown. Atomic, and one file per day. */
export function saveBriefing(root, day, text) {
  fs.mkdirSync(briefingsDir(root), { recursive: true });
  const file = briefingPath(root, day);
  const temp = `${file}.tmp`;
  const body = `# Briefing ${day}\n\n${text}\n`;
  fs.writeFileSync(temp, body);
  fs.renameSync(temp, file);
  return file;
}

export function readBriefing(root, day) {
  const file = briefingPath(root, day);
  if (!fs.existsSync(file)) return null;
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
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

/** The one-line notification body: the most urgent line, without its bullet. */
export function topLine(text) {
  const first = String(text ?? "")
    .split("\n")
    .map((line) => line.replace(/^[-•]\s*/, "").trim())
    .filter(Boolean)[0];
  return first ? first.slice(0, 200) : "Your briefing is ready.";
}
