/**
 * Real RPG data (slice R1): the Today dashboard reads the append-only life
 * event log instead of demo numbers. Everything here is derived from the log;
 * nothing is written except the events the routes append.
 */
import fs from "node:fs";
import path from "node:path";
import { asMs, dayKey, readEvents, readSettings } from "./events.mjs";

/** The six areas of a Preyas OS life, in display order. */
const AREAS = ["body", "intel", "money", "spirit", "craft", "goal"];

/**
 * The one XP table: every XP value lives here and nowhere else.
 * food/sleep/stomach/water feed the body, money feeds money, books feed the
 * mind, films and mood feed the spirit, and focus pays intel or craft
 * depending on the event's area.
 */
export const XP_TABLE = {
  food: { area: "body", xp: 3 },
  sleep: { area: "body", xp: 3 },
  water: { area: "body", xpPerGlass: 1 },
  stomach: { area: "body", xp: 1 },
  money: { area: "money", xp: 2 },
  book: { area: "intel", xp: 4 },
  film: { area: "spirit", xp: 2 },
  mood: { area: "spirit", xp: 3 },
  focus: { xpPer5Minutes: 1, areas: ["intel", "craft"] },
};

/**
 * The six daily quests, same ids as apps/mobile/src/rpg/quests.ts. A quest
 * with a `goal` shows a "n/goal" progress hint; the others are a single event
 * and show no hint. The +5 bonus is paid once per day the quest is done.
 */
export const DAILY_QUEST_DEFS = [
  { id: "meal", area: "body", bonus: 5, goal: null },
  { id: "water", area: "body", bonus: 5, goal: 6 },
  { id: "focus", area: "intel", bonus: 5, goal: 25 },
  { id: "mood", area: "spirit", bonus: 5, goal: null },
  { id: "money", area: "money", bonus: 5, goal: null },
  { id: "craft", area: "craft", bonus: 5, goal: 30 },
];

const QUEST_IDS = new Set(DAILY_QUEST_DEFS.map((def) => def.id));

/** The five long paths, in display order. */
export const PATH_IDS = ["house", "car", "study", "bakugan-buddy", "studio"];

/** A finite non-negative number, or 0. */
function countOf(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** A whole number from `min` to `max` inclusive, or null. */
function intInRange(value, min, max) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) return null;
  return n;
}

/** One line of note text: collapsed whitespace, capped like raw lines. */
function cleanNote(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

/**
 * Input checks for the four new event types. Each returns
 * { ok: true, data } or { ok: false, error } — bad input writes nothing.
 */

/** quest {questId, done:boolean} */
export function questEvent(body) {
  const questId = typeof body?.questId === "string" ? body.questId : null;
  if (!questId || !QUEST_IDS.has(questId)) {
    return { ok: false, error: "questId must be one of: " + [...QUEST_IDS].join(", ") };
  }
  if (typeof body.done !== "boolean") return { ok: false, error: "done must be true or false" };
  return { ok: true, data: { questId, done: body.done } };
}

/** focus {minutes:1..240, area:"intel"|"craft"} */
export function focusEvent(body) {
  const minutes = intInRange(body?.minutes, 1, 240);
  if (minutes === null) return { ok: false, error: "minutes must be a whole number from 1 to 240" };
  const area = body?.area;
  if (area !== "intel" && area !== "craft") return { ok: false, error: "area must be \"intel\" or \"craft\"" };
  return { ok: true, data: { minutes, area } };
}

/** water {glasses:1..3} */
export function waterEvent(body) {
  const glasses = intInRange(body?.glasses, 1, 3);
  if (glasses === null) return { ok: false, error: "glasses must be a whole number from 1 to 3" };
  return { ok: true, data: { glasses } };
}

/** mood {score:1..5, note?} */
export function moodEvent(body) {
  const score = intInRange(body?.score, 1, 5);
  if (score === null) return { ok: false, error: "score must be a whole number from 1 to 5" };
  const hasNote = body.note !== undefined && body.note !== null;
  if (hasNote && typeof body.note !== "string") return { ok: false, error: "note must be text" };
  const note = hasNote ? cleanNote(body.note) : null;
  const data = { score };
  if (note) data.note = note;
  return { ok: true, data };
}

/** The XP one event earns in one area, or null when it earns nothing. */
function eventXp(event) {
  const data = event.data || {};
  const row = XP_TABLE[event.type];
  if (!row) return null;
  if (event.type === "water") {
    const glasses = countOf(data.glasses);
    return glasses > 0 ? { area: row.area, xp: glasses * row.xpPerGlass } : null;
  }
  if (event.type === "focus") {
    const minutes = countOf(data.minutes);
    if (!row.areas.includes(data.area) || minutes < 5) return null;
    return { area: data.area, xp: Math.floor(minutes / 5) * row.xpPer5Minutes };
  }
  return { area: row.area, xp: row.xp };
}

/** Progress of one quest from one day's events: raw count, goal, earned. */
function questProgress(def, dayEvents) {
  let count = 0;
  for (const event of dayEvents) {
    const data = event.data || {};
    if (def.id === "meal" && event.type === "food") count += 1;
    else if (def.id === "water" && event.type === "water") count += countOf(data.glasses);
    else if (def.id === "focus" && event.type === "focus" && data.area === "intel") count += countOf(data.minutes);
    else if (def.id === "mood" && event.type === "mood") count += 1;
    else if (def.id === "money" && event.type === "money") count += 1;
    else if (def.id === "craft" && event.type === "focus" && data.area === "craft") count += countOf(data.minutes);
  }
  const goal = def.goal;
  return { count, goal, earned: goal === null ? count > 0 : count >= goal };
}

/**
 * Quest states for one day. A quest is done when real events earn it or when
 * the latest manual quest event for that id that day says done:true. A later
 * done:false un-ticks a manual tick, but never one earned by real events.
 */
function questStates(dayEvents) {
  const manual = new Map();
  for (const event of dayEvents) {
    if (event.type === "quest" && typeof event.data?.questId === "string") {
      manual.set(event.data.questId, event.data.done === true);
    }
  }
  return DAILY_QUEST_DEFS.map((def) => {
    const progress = questProgress(def, dayEvents);
    const done = progress.earned || manual.get(def.id) === true;
    const state = { id: def.id, done };
    if (progress.goal !== null) {
      state.sub = `${Math.min(progress.count, progress.goal)}/${progress.goal}`;
    }
    return state;
  });
}

/**
 * <dataDir>/rpg/paths.json: {house, car, study, "bakugan-buddy", studio}
 * each 0..100. Missing or bad file -> all zeros. This file is read only and
 * never created or written here.
 */
export function readPaths(dataDir) {
  const zeros = PATH_IDS.map((id) => ({ id, pct: 0 }));
  if (!dataDir) return zeros;
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(path.join(dataDir, "rpg", "paths.json"), "utf8"));
  } catch {
    return zeros;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return zeros;
  return PATH_IDS.map((id) => {
    const pct = Number(parsed[id]);
    if (!Number.isFinite(pct)) return { id, pct: 0 };
    return { id, pct: Math.max(0, Math.min(100, pct)) };
  });
}

/**
 * The whole Today dashboard from the log. `areaXp` is all-time XP: every
 * event's XP plus one +5 bonus per quest done on each day (so yesterday's
 * bonuses never vanish at midnight). `todayXp` and `quests` only look at the
 * local day in the settings time zone (default Europe/Warsaw).
 */
export function rpgToday(dataDir, now = new Date()) {
  const settings = readSettings(dataDir);
  const today = dayKey(asMs(now), settings.tz);
  const events = dataDir ? readEvents(dataDir) : [];

  const areaXp = Object.fromEntries(AREAS.map((area) => [area, 0]));
  let todayXp = 0;

  const byDay = new Map();
  for (const event of events) {
    if (!event || typeof event.day !== "string") continue;
    const list = byDay.get(event.day) || [];
    list.push(event);
    byDay.set(event.day, list);
  }

  for (const [day, dayEvents] of byDay) {
    let dayEventXp = 0;
    for (const event of dayEvents) {
      const xp = eventXp(event);
      if (!xp) continue;
      areaXp[xp.area] += xp.xp;
      dayEventXp += xp.xp;
    }
    for (const state of questStates(dayEvents)) {
      if (!state.done) continue;
      const def = DAILY_QUEST_DEFS.find((row) => row.id === state.id);
      areaXp[def.area] += def.bonus;
      if (day === today) todayXp += def.bonus;
    }
    if (day === today) todayXp += dayEventXp;
  }

  return {
    areaXp,
    todayXp,
    quests: questStates(byDay.get(today) || []),
    paths: readPaths(dataDir),
  };
}
