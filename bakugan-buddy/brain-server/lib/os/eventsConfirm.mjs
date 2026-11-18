/**
 * Confirm line, undo window and double-send memory for the event log.
 * Logging is immediate; undo only works inside the 10 s window (plus 500 ms
 * grace) and is itself an event. A repeated identical sentence from the same
 * source within 10 s returns the first result and writes nothing new.
 */
import { appendEvent, asMs, dayKey, makeId, readAllEvents, readSettings } from "./events.mjs";
import { redactSecrets } from "../coach/redact.mjs";

export const UNDO_GRACE_MS = 10_000 + 500;
export const DOUBLE_SEND_MS = 10_000;

export function normalizeSentence(text) {
  return String(text ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

export function formatAmount(amount) {
  const value = Math.round(Number(amount) * 100) / 100;
  const [whole, fraction] = String(value).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, "\u00A0");
  return fraction ? `${grouped}.${fraction}` : grouped;
}

export function formatMinutes(minutes) {
  const total = Math.max(0, Math.round(Number(minutes) || 0));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

function hasCyrillic(text) {
  return /[\u0400-\u04FF]/.test(String(text ?? ""));
}

/**
 * ONE line for one or more events, separated by " · " (" и " in Russian).
 * `events` may carry a transient `_afterItem` (stomach linked to a recent
 * food); it is for display only and never stored.
 */
export function confirmLine(events, langOrText, context = {}) {
  const ru = typeof langOrText === "string" && langOrText !== "en" && hasCyrillic(langOrText);
  const parts = events.map((event) => {
    const data = event.data || {};
    switch (event.type) {
      case "money": {
        const sign = data.direction === "in" ? "+" : "−";
        const category = data.category ? ` ${data.category}` : "";
        return `${sign}${formatAmount(data.amount)} ${data.currency}${category}`;
      }
      case "food":
        return `${data.item}${data.meal ? ` (${data.meal})` : ""}`;
      case "stomach": {
        const word = Array.isArray(data.words) && data.words.length ? data.words[0] : "note";
        const after = event._afterItem ? ` after ${event._afterItem}` : "";
        return `stomach: ${word}${after}`;
      }
      case "sleep":
        return `sleep ${formatMinutes(data.minutes)}`;
      case "book":
        return `book: ${data.title}${typeof data.pages === "number" ? `, ${data.pages} pages` : ""}`;
      case "film":
        return `film: ${data.title}${typeof data.rating === "number" ? `, ${data.rating}/10` : ""}`;
      default:
        return String(event.type);
    }
  });
  const separator = ru ? " и " : " and ";
  const joined = parts.length > 1 ? parts.join(separator) : parts.join("");
  return ru
    ? `Сохранено: ${joined}. Отменить можно 10 с.`
    : `Saved: ${joined}. Undo for 10 s.`;
}

/**
 * undoEvents(dataDir, ids, now, { tz }) -> { undone: [...], refused: [...] }.
 * An undo event is appended only when the original is at most 10 s old
 * (10 500 ms with grace) and not already undone. Unknown ids and expired
 * windows are refused, never a crash.
 */
export function undoEvents(dataDir, ids, now, { tz } = {}) {
  const nowMs = asMs(now);
  const zone = tz || readSettings(dataDir).tz;
  const all = readAllEvents(dataDir);
  const byId = new Map(all.map((event) => [event.id, event]));
  const undoneIds = new Set(
    all.filter((event) => event.type === "undo" && event.data && event.data.of).map((event) => event.data.of),
  );
  const undone = [];
  const refused = [];
  for (const id of ids) {
    const original = byId.get(id);
    if (!original) {
      refused.push({ id, reason: "unknown id" });
      continue;
    }
    if (undoneIds.has(id)) {
      refused.push({ id, reason: "already undone" });
      continue;
    }
    if (nowMs - Number(original.ts) > UNDO_GRACE_MS) {
      refused.push({ id, reason: "It is saved. Corrections come in a later version." });
      continue;
    }
    const undoEvent = {
      v: 1,
      id: makeId(nowMs),
      ts: nowMs,
      day: dayKey(nowMs, zone),
      type: "undo",
      data: { of: id },
      src: "manual",
      raw: "",
      parser: "undo",
    };
    appendEvent(dataDir, undoEvent);
    undoneIds.add(id);
    undone.push(id);
  }
  return { undone, refused };
}

/** Small memory for idempotent double-sends; one per brain process. */
export function createSendMemory() {
  const map = new Map();
  return {
    lookup(key, nowMs) {
      const hit = map.get(key);
      if (!hit) return null;
      if (nowMs - hit.ts > DOUBLE_SEND_MS) {
        map.delete(key);
        return null;
      }
      return hit.result;
    },
    put(key, result, nowMs) {
      map.set(key, { ts: nowMs, result });
    },
  };
}

/**
 * Turns parsed events into real log lines: ids, refs resolved ("@food0" ->
 * the food event's id), transient fields dropped, raw redacted and capped.
 * Returns the stored events with `_afterItem` kept for the confirm line.
 */
export function logParsedEvents(dataDir, parsed, { src = "chat", rawText = "", ts } = {}) {
  const assigned = new Map();
  const events = [];
  for (const parsedEvent of parsed.events) {
    const id = makeId(ts);
    const data = {};
    for (const [key, value] of Object.entries(parsedEvent.data || {})) {
      if (key === "foodId" && typeof value === "string" && value.startsWith("@")) {
        data.foodId = assigned.get(value.slice(1)) || null;
      } else {
        data[key] = value;
      }
    }
    if (parsedEvent.ref) assigned.set(parsedEvent.ref, id);
    const event = {
      v: 1,
      id,
      ts,
      day: parsedEvent.day || parsed.day,
      type: parsedEvent.type,
      data,
      src,
      raw: redactSecrets(rawText).slice(0, 300),
      parser: "p1",
    };
    appendEvent(dataDir, event);
    events.push({ ...event, _afterItem: parsedEvent._afterItem || null });
  }
  return events;
}
