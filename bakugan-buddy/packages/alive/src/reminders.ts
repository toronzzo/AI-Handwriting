/**
 * Reminders: turn "remind me tomorrow at 9 to call the vet" into a due time in
 * the user's zone, without a model and without a date library.
 *
 * All wall-clock times are Europe/Warsaw. Instants are converted with Intl so
 * the summer/winter switch is handled by the platform, not by a fixed offset.
 */

export const REMINDER_ZONE = "Europe/Warsaw";
export type Repeat = "none" | "daily" | "weekly" | "weekdays";
export type ReminderStatus = "pending" | "done" | "snoozed" | "missed";

export type Reminder = {
  id: string;
  text: string;
  dueAt: string;
  repeat: Repeat;
  status: ReminderStatus;
  chatId: string;
  created: number;
  updated: number;
};

export type ParsedReminder =
  | { ok: true; text: string; dueAt: Date; repeat: Repeat; label: string }
  | { ok: false; reason: "no-time" | "no-text"; text: string };

const WEEKDAYS = [
  "sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday",
];
const RU_WEEKDAYS = [
  "воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота",
];
const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];
const DEFAULT_HOUR: Record<string, number> = { morning: 9, afternoon: 14, evening: 19, tonight: 19 };

const FMT = new Intl.DateTimeFormat("en-GB", {
  timeZone: REMINDER_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

export type LocalParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

export function localParts(instant: Date | number): LocalParts {
  const parts = Object.fromEntries(
    FMT.formatToParts(new Date(instant)).map((row) => [row.type, row.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) === 24 ? 0 : Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

function offsetMs(instant: number): number {
  const parts = localParts(instant);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - instant;
}

/** A wall-clock time in Warsaw to the matching instant, DST included. */
export function warsawWallTime(year: number, month: number, day: number, hour: number, minute = 0): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  let instant = guess - offsetMs(guess);
  instant = guess - offsetMs(instant);
  return new Date(instant);
}

/** Move a date by whole local days, keeping the wall-clock time. */
export function addLocalDays(date: Date, days: number): Date {
  const parts = localParts(date);
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days, parts.hour, parts.minute, 0));
  return warsawWallTime(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + 1,
    shifted.getUTCDate(),
    parts.hour,
    parts.minute,
  );
}

function atHour(date: Date, hour: number, minute = 0): Date {
  const parts = localParts(date);
  return warsawWallTime(parts.year, parts.month, parts.day, hour, minute);
}

/** "Fri, Nov 6 at 09:00" — what the confirm card shows. */
export function formatDue(date: Date): string {
  const parts = localParts(date);
  const weekday = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
  const shortDay = WEEKDAYS[weekday]!.slice(0, 3);
  const titleDay = shortDay[0]!.toUpperCase() + shortDay.slice(1);
  const month = MONTHS[parts.month - 1]!.slice(0, 3);
  const titleMonth = month[0]!.toUpperCase() + month.slice(1);
  return `${titleDay}, ${titleMonth} ${parts.day} at ${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
}

function weekdayIndex(name: string): number {
  const lower = name.toLowerCase();
  const english = WEEKDAYS.indexOf(lower);
  if (english >= 0) return english;
  const russian = RU_WEEKDAYS.indexOf(lower);
  return russian;
}

/** Strip the command words from the front, leaving what to remind about. */
function extractText(raw: string): string {
  return String(raw ?? "")
    .replace(/^\s*(?:please\s+)?(?:remind\s+me|напомни(?:\s+мне)?)\s*/i, "")
    .replace(/^\s*(?:to|about|that|о|об|про)\s+/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.?!]+$/, "");
}

type Clock = { hour: number; minute: number; rest: string };

/** Pull "at 9", "at 18:30", "в 9", "9am", "21" out of the remaining words. */
function takeClock(text: string): Clock | null {
  const clock = text.match(/(?:\b(?:at|в)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?|\b(\d{1,2}):(\d{2})\s*(am|pm)?)\b/i);
  if (!clock) return null;
  let hour = Number(clock[1] ?? clock[4]);
  const minute = Number(clock[2] ?? clock[5] ?? 0);
  const marker = String(clock[3] ?? clock[6] ?? "").toLowerCase();
  if (marker === "pm" && hour < 12) hour += 12;
  if (marker === "am" && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return null;
  const rest = `${text.slice(0, clock.index ?? 0)} ${text.slice((clock.index ?? 0) + clock[0].length)}`.trim();
  return { hour, minute, rest };
}

/**
 * Parse a reminder request against a fixed "now". Returns no-time when the
 * words carry no date at all, so the caller can ask instead of guessing.
 */
export function parseReminder(raw: string, now: Date = new Date()): ParsedReminder {
  const original = String(raw ?? "").trim();
  if (!isReminderRequest(original)) return { ok: false, reason: "no-time", text: extractText(original) };
  let remaining = extractText(original);
  const lowered = () => remaining.toLowerCase();

  let repeat: Repeat = "none";
  let dueDate: Date | null = null;
  let hasTimeWords = false;
  let everyWeekday = -1;

  const cut = (match: RegExpMatchArray) => {
    const at = match.index ?? 0;
    remaining = `${remaining.slice(0, at)} ${remaining.slice(at + match[0].length)}`.replace(/\s+/g, " ").trim();
  };

  // 1. "every monday at 8" / "every day" / "every weekday" / "каждый понедельник"
  const every = lowered().match(/\b(?:every|каждый|каждую)\s+([a-z\u0430-\u044f]+)/i);
  if (every) {
    const word = every[1]!.toLowerCase();
    cut(every);
    hasTimeWords = true;
    if (/^(day|день|дня)$/.test(word)) repeat = "daily";
    else if (/weekday|будн/.test(word)) repeat = "weekdays";
    else {
      const index = weekdayIndex(word);
      if (index < 0) return { ok: false, reason: "no-time", text: remaining || original };
      repeat = "weekly";
      everyWeekday = index;
    }
  }

  // 2. "in 2 hours" / "через 30 минут"
  if (!dueDate) {
    const relative = lowered().match(/\b(?:in|через)\s+(\d{1,3})\s*(minutes?|mins?|min|hours?|hrs?|hour|h|days?|day|дней|дня|день|часов|часа|час|минут\w*)\b/i);
    if (relative) {
      const amount = Number(relative[1]);
      const unit = relative[2]!.toLowerCase();
      let ms = amount * 3_600_000;
      if (/^(m|min|минут)/.test(unit)) ms = amount * 60_000;
      else if (/^(d|day|дн|день|дня)/.test(unit)) ms = amount * 86_400_000;
      dueDate = new Date(now.getTime() + ms);
      hasTimeWords = true;
      cut(relative);
    }
  }

  // 3. A clock time: "at 9", "at 18:30", "18:30", "9pm", "в 9"
  let hour = -1;
  let minute = 0;
  const clock = remaining.match(
    /(?:^|\s)(?:at|в)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?|(?:^|\s)(\d{1,2}):(\d{2})\s*(am|pm)?|(?:^|\s)(\d{1,2})\s*(am|pm)(?![a-z])/i,
  );
  if (clock) {
    hour = Number(clock[1] ?? clock[4] ?? clock[7]);
    minute = Number(clock[2] ?? clock[5] ?? 0);
    const marker = String(clock[3] ?? clock[6] ?? clock[8] ?? "").toLowerCase();
    if (marker === "pm" && hour < 12) hour += 12;
    if (marker === "am" && hour === 12) hour = 0;
    if (hour > 23 || minute > 59) return { ok: false, reason: "no-time", text: remaining || original };
    cut(clock);
  }

  const resetHour = () => {
    if (hour < 0) {
      hour = DEFAULT_HOUR.morning;
      minute = 0;
    }
  };

  // 4. Explicit dates: "2026-11-10", "on Nov 10", "Nov 10"
  if (!dueDate) {
    const iso = remaining.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
    if (iso) {
      resetHour();
      dueDate = warsawWallTime(Number(iso[1]), Number(iso[2]), Number(iso[3]), hour, minute);
      hasTimeWords = true;
      cut(iso);
    }
  }
  if (!dueDate) {
    const monthDay = remaining.match(/\b(?:on\s+|на\s+)?([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/);
    if (monthDay) {
      const token = monthDay[1]!.toLowerCase();
      const monthIndex = MONTHS.findIndex((month) => token.startsWith(month.slice(0, 3)));
      const day = Number(monthDay[2]);
      if (monthIndex >= 0 && day >= 1 && day <= 31) {
        resetHour();
        const parts = localParts(now);
        let candidate = warsawWallTime(parts.year, monthIndex + 1, day, hour, minute);
        if (candidate.getTime() < now.getTime() - 86_400_000) {
          candidate = warsawWallTime(parts.year + 1, monthIndex + 1, day, hour, minute);
        }
        dueDate = candidate;
        hasTimeWords = true;
        cut(monthDay);
      }
    }
  }

  // 5. Day words: today, tomorrow, tonight, this evening, weekdays
  if (!dueDate) {
    const dayWord = remaining.match(
      /(^|\s)(tomorrow|сегодня|завтра|послезавтра|today|tonight|this\s+(?:morning|afternoon|evening)|morning|afternoon|evening|утром|вечером)(?=\s|$)/i,
    );
    if (dayWord) {
      const word = dayWord[2]!.toLowerCase().replace(/\s+/g, " ");
      const slot = /tonight|evening|вечером/.test(word)
        ? DEFAULT_HOUR.evening
        : /afternoon/.test(word)
          ? DEFAULT_HOUR.afternoon
          : /morning|утром/.test(word)
            ? DEFAULT_HOUR.morning
            : -1;
      const useHour = hour >= 0 ? hour : slot >= 0 ? slot : DEFAULT_HOUR.morning;
      minute = hour >= 0 ? minute : 0;
      if (/\bпослезавтра\b/.test(word)) dueDate = atHour(addLocalDays(now, 2), useHour, minute);
      else if (/\btomorrow\b|^завтра$/.test(word)) dueDate = atHour(addLocalDays(now, 1), useHour, minute);
      else if (/today|today|tonight|morning|afternoon|evening|сегодня|утром|вечером|this/.test(word)) {
        const today = atHour(now, useHour, minute);
        dueDate = today.getTime() > now.getTime() ? today : atHour(addLocalDays(now, 1), useHour, minute);
      }
      hasTimeWords = true;
      cut(dayWord);
    }
  }

  // 6. A bare weekday: "on Friday", "в пятницу"
  if (!dueDate) {
    const dayName = remaining.match(
      /(?:^|\s)(?:on\s+|в\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday|понедельник|вторник|сред[ау]|четверг|пятниц[ау]|суббот[ау]|воскресень[ея])(?=\s|$)/i,
    );
    if (dayName) {
      const index = weekdayIndex(dayName[1]!);
      if (index >= 0) {
        resetHour();
        dueDate = nextWeekday(now, index, hour, minute);
        hasTimeWords = true;
        cut(dayName);
      }
    }
  }

  if (everyWeekday >= 0 && !dueDate) {
    resetHour();
    dueDate = nextWeekday(now, everyWeekday, hour, minute);
  }

  // 7. A clock time with no day at all means today, or tomorrow if it has passed.
  if (!dueDate && hour >= 0) {
    const today = atHour(now, hour, minute);
    dueDate = today.getTime() > now.getTime() ? today : atHour(addLocalDays(now, 1), hour, minute);
    hasTimeWords = true;
  }

  // Repeating reminders with no clock time use the morning slot.
  if (dueDate && repeat !== "none" && hour < 0) {
    const parts = localParts(dueDate);
    dueDate = warsawWallTime(parts.year, parts.month, parts.day, DEFAULT_HOUR.morning, 0);
  }

  const body = cleanupText(remaining) || cleanupText(extractText(original));
  if (!dueDate || !hasTimeWords) return { ok: false, reason: "no-time", text: body || "" };
  if (!body) return { ok: false, reason: "no-text", text: "" };
  return { ok: true, text: body, dueAt: dueDate, repeat, label: formatDue(dueDate) };
}

/** A request must sound like one: remind me / every / запомни-style phrasing. */
export function isReminderRequest(raw: string): boolean {
  const text = String(raw ?? "").trim().toLowerCase();
  if (!text) return false;
  // It asks outright, or it opens with the time itself.
  if (/^(?:please\s+)?remind\b|^напомни|^\/remind\b/.test(text)) return true;
  if (
    /^(?:every|on|in|at|tomorrow|today|tonight|this\s+(?:morning|afternoon|evening)|morning|afternoon|evening|monday|tuesday|wednesday|thursday|friday|saturday|sunday|завтра|сегодня|послезавтра)(?![a-z])/.test(
      text,
    )
  ) {
    return true;
  }
  return /^\d{1,2}(?::\d{2})?\s*(?:am|pm)(?![a-z])/.test(text) || /^\d{1,2}:\d{2}(?!\d)/.test(text);
}

function cleanupText(text: string): string {
  return String(text ?? "")
    .replace(/^\s*(?:to|about|that|at|on|in|в|о|об|про|this)\b\s*/i, "")
    .replace(/\b(?:at|on|в)\s*$/i, "")
    .replace(/\s+/g, " ")
    .replace(/^[,;:.\-–—\s]+|[,;:.\-–—\s]+$/g, "")
    .trim();
}

export function nextWeekday(now: Date, weekday: number, hour = DEFAULT_HOUR.morning, minute = 0): Date {
  const parts = localParts(now);
  const today = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
  let delta = (weekday - today + 7) % 7;
  // Today only counts when the time has not passed yet.
  if (delta === 0) {
    const todayAt = warsawWallTime(parts.year, parts.month, parts.day, hour, minute);
    if (todayAt.getTime() <= now.getTime()) delta = 7;
  }
  return atHour(addLocalDays(now, delta), hour, minute);
}

function cleanRemaining(text: string): string {
  return String(text ?? "")
    .replace(/^\s*(?:to|about|that|at|on|in|в|о|об|про)\b\s*/i, "")
    .replace(/\b(?:at|on|в)\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[,;:.\-–—]+|[,;:.\-–—]+$/g, "")
    .trim();
}

/** When everything was consumed by time words, fall back to the whole phrase. */
function extractBody(original: string): string {
  const text = extractText(original);
  return text
    .replace(/\b(?:today|tomorrow|tonight|morning|afternoon|evening|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi, " ")
    .replace(/\b\d{1,2}(?::\d{2})?\s*(?:am|pm)?\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The next time a repeating reminder fires after `from`. */
export function nextOccurrence(reminder: Pick<Reminder, "dueAt" | "repeat">, from: Date): Date {
  const current = new Date(reminder.dueAt);
  if (reminder.repeat === "none") return current;
  let next = current;
  let guard = 0;
  while (next.getTime() <= from.getTime() && guard < 400) {
    if (reminder.repeat === "daily") next = addLocalDays(next, 1);
    else if (reminder.repeat === "weekly") next = addLocalDays(next, 7);
    else {
      next = addLocalDays(next, 1);
      const parts = localParts(next);
      const weekday = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
      if (weekday === 6) next = addLocalDays(next, 2);
      else if (weekday === 0) next = addLocalDays(next, 1);
    }
    guard += 1;
  }
  return next;
}

/** Snooze options the UI offers. */
export function snoozeUntil(reminder: Pick<Reminder, "dueAt">, choice: "10m" | "1h" | "tomorrow", now: Date): Date {
  if (choice === "10m") return new Date(now.getTime() + 10 * 60_000);
  if (choice === "1h") return new Date(now.getTime() + 60 * 60_000);
  const base = atHour(addLocalDays(now, 1), 9, 0);
  void reminder;
  return base;
}
