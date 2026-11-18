/**
 * The life-event log: the single source of truth for money, food, stomach,
 * sleep, books and films. Append-only JSONL, one line per event, one file per
 * month (<dataDir>/events/YYYY-MM.jsonl). Nothing is ever rewritten; undo is
 * itself an event.
 */
import fs from "node:fs";
import path from "node:path";

export const DEFAULT_CURRENCY = "KZT";
export const EVENT_TYPES = ["money", "food", "stomach", "sleep", "book", "film", "undo"];

function asDate(now) {
  if (now instanceof Date) return now;
  return new Date(Number(now) || Date.now());
}

function asMs(now) {
  if (now instanceof Date) return now.getTime();
  const n = Number(now);
  return Number.isFinite(n) && n > 0 ? n : Date.now();
}

/** {tz, currency} from settings/events.json; invalid or missing -> defaults. */
export function readSettings(dataDir, now = () => new Date()) {
  const defaults = {
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Warsaw",
    currency: DEFAULT_CURRENCY,
  };
  if (!dataDir) return defaults;
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(dataDir, "settings", "events.json"), "utf8"));
    const tz = typeof parsed.tz === "string" && parsed.tz ? parsed.tz : defaults.tz;
    const currency = typeof parsed.currency === "string" && parsed.currency ? parsed.currency : defaults.currency;
    return { tz, currency };
  } catch {
    return defaults;
  }
}

/** "YYYY-MM-DD" in the given time zone. */
export function dayKey(ts, tz) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(asDate(ts));
  const map = {};
  for (const part of parts) map[part.type] = part.value;
  return `${map.year}-${map.month}-${map.day}`;
}

/** Local noon of the given date in `tz`, as epoch ms. */
export function noonInZone(year, month, day, tz) {
  const guess = Date.UTC(year, month - 1, day, 12);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(guess));
  const map = {};
  for (const part of parts) map[part.type] = part.value;
  const asUTC = Date.UTC(Number(map.year), Number(map.month) - 1, Number(map.day), Number(map.hour), Number(map.minute));
  return guess - (asUTC - guess);
}

export function eventsDir(dataDir) {
  return path.join(dataDir, "events");
}

function monthFile(dataDir, day) {
  return path.join(eventsDir(dataDir), `${String(day).slice(0, 7)}.jsonl`);
}

/** evt_<base36 ts><4 random chars> */
export function makeId(ts) {
  const random = Math.random().toString(36).slice(2, 6);
  return `evt_${Number(ts).toString(36)}${random}`;
}

/**
 * Appends one event line. Returns the event. One write per line, append-only.
 */
export function appendEvent(dataDir, event) {
  fs.mkdirSync(eventsDir(dataDir), { recursive: true });
  fs.appendFileSync(monthFile(dataDir, event.day), JSON.stringify(event) + "\n");
  return event;
}

/** All valid raw lines of one or all months, in file order. */
function readRawLines(dataDir, fromDay, toDay) {
  const dir = eventsDir(dataDir);
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter((name) => /^\d{4}-\d{2}\.jsonl$/.test(name)).sort();
  const first = fromDay ? fromDay.slice(0, 7) : null;
  const last = toDay ? toDay.slice(0, 7) : null;
  const lines = [];
  for (const name of files) {
    const month = name.slice(0, 7);
    if (first && month < first) continue;
    if (last && month > last) continue;
    for (const line of fs.readFileSync(path.join(dir, name), "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line);
        if (!event || typeof event !== "object" || event.v !== 1 || typeof event.id !== "string") continue;
        lines.push(event);
      } catch {
        /* torn line: skipped */
      }
    }
  }
  return lines;
}

/**
 * Events in time order, with undone events dropped. `raw` is stripped unless
 * requested. from/to are "YYYY-MM-DD" days (inclusive), types filters.
 */
export function readEvents(dataDir, { from, to, types, raw = false } = {}) {
  const lines = readRawLines(dataDir, from, to);
  const undone = new Set(lines.filter((event) => event.type === "undo" && event.data && event.data.of).map((event) => event.data.of));
  const wanted = types ? new Set(types) : null;
  const events = lines
    .filter((event) => event.type !== "undo")
    .filter((event) => !undone.has(event.id))
    .filter((event) => (wanted ? wanted.has(event.type) : true))
    .filter((event) => (!from || event.day >= from) && (!to || event.day <= to))
    .sort((left, right) => left.ts - right.ts || left.id.localeCompare(right.id))
    .map((event) => {
      const { raw: _raw, ...rest } = event;
      if (raw) rest.raw = _raw;
      return rest;
    });
  return events;
}

/** Raw view including undone events and undo events (used by undo logic). */
export function readAllEvents(dataDir, { from, to } = {}) {
  return readRawLines(dataDir, from, to);
}

/**
 * One day as numbers: totals per type. Money is per currency, direction and
 * category; sleep minutes and pages are summed; food/stomach/books/films are
 * counted.
 */
export function summarizeDay(dataDir, day, { tz } = {}) {
  const events = readEvents(dataDir, { from: day, to: day });
  const summary = {
    day,
    money: { out: 0, in: 0, byCurrency: {} },
    sleepMinutes: 0,
    pages: 0,
    foodCount: 0,
    stomachCount: 0,
    bookCount: 0,
    filmCount: 0,
  };
  for (const event of events) {
    const data = event.data || {};
    if (event.type === "money" && typeof data.amount === "number" && data.amount > 0) {
      const currency = String(data.currency || DEFAULT_CURRENCY);
      const bucket = summary.money.byCurrency[currency] || (summary.money.byCurrency[currency] = { out: 0, in: 0 });
      if (data.direction === "in") {
        summary.money.in += data.amount;
        bucket.in += data.amount;
      } else {
        summary.money.out += data.amount;
        bucket.out += data.amount;
      }
    } else if (event.type === "sleep" && typeof data.minutes === "number") {
      summary.sleepMinutes += data.minutes;
    } else if (event.type === "book") {
      summary.bookCount += 1;
      if (typeof data.pages === "number") summary.pages += data.pages;
    } else if (event.type === "food") {
      summary.foodCount += 1;
    } else if (event.type === "stomach") {
      summary.stomachCount += 1;
    } else if (event.type === "film") {
      summary.filmCount += 1;
    }
  }
  for (const bucket of Object.values(summary.money.byCurrency)) {
    bucket.out = Math.round(bucket.out * 100) / 100;
    bucket.in = Math.round(bucket.in * 100) / 100;
  }
  return summary;
}

/** Crisis template from settings/crisis.json; the default carries no number. */
export const DEFAULT_CRISIS_LINE =
  "I am not a doctor. Please contact your local emergency number or someone you trust now.";

export function crisisLine(dataDir) {
  if (!dataDir) return DEFAULT_CRISIS_LINE;
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(dataDir, "settings", "crisis.json"), "utf8"));
    return typeof parsed.line === "string" && parsed.line.trim() ? parsed.line : DEFAULT_CRISIS_LINE;
  } catch {
    return DEFAULT_CRISIS_LINE;
  }
}

export { asDate, asMs };
