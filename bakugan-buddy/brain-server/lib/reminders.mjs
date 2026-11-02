/**
 * Reminder store and scheduler on the Agent drive.
 *
 * Storage is one JSON file written atomically (temp file, then rename), the
 * same way chats are saved. The scheduler ticks every 30 seconds, shows a macOS
 * notification through osascript with an argument array (never a shell string),
 * and posts the reminder back into the chat it came from.
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { nextOccurrence, snoozeUntil } from "../../packages/alive/src/reminders.ts";

export const TICK_MS = 30_000;

const REPEATS = new Set(["none", "daily", "weekly", "weekdays"]);
const STATUSES = new Set(["pending", "done", "snoozed", "missed"]);
const ID_RE = /^[A-Za-z0-9_-]+$/;

export function remindersPath(root) {
  return path.join(root, "memory", "reminders.json");
}

function normalize(raw) {
  const due = Number.isNaN(new Date(raw?.dueAt).getTime()) ? new Date().toISOString() : new Date(raw.dueAt).toISOString();
  return {
    id: String(raw?.id || randomUUID()),
    text: String(raw?.text || "").slice(0, 300),
    dueAt: due,
    repeat: REPEATS.has(raw?.repeat) ? raw.repeat : "none",
    status: STATUSES.has(raw?.status) ? raw.status : "pending",
    chatId: String(raw?.chatId || ""),
    created: Number(raw?.created) || Date.now(),
    updated: Number(raw?.updated) || Date.now(),
    ...(raw?.doneAt ? { doneAt: Number(raw.doneAt) } : {}),
    ...(raw?.snoozedFor ? { snoozedFor: String(raw.snoozedFor) } : {}),
  };
}

export function loadReminders(root) {
  const file = remindersPath(root);
  if (!fs.existsSync(file)) return [];
  try {
    const body = JSON.parse(fs.readFileSync(file, "utf8"));
    const rows = Array.isArray(body) ? body : Array.isArray(body?.reminders) ? body.reminders : [];
    return rows.filter((row) => row && row.id).map(normalize);
  } catch {
    return [];
  }
}

export function saveReminders(root, reminders) {
  const file = remindersPath(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify({ reminders }, null, 2)}\n`);
  fs.renameSync(temp, file);
  return reminders;
}

export function addReminder(root, entry, now = Date.now()) {
  const reminders = loadReminders(root);
  const reminder = normalize({
    ...entry,
    id: randomUUID(),
    status: "pending",
    created: now,
    updated: now,
  });
  saveReminders(root, [...reminders, reminder]);
  return reminder;
}

export function findReminder(root, id) {
  if (!ID_RE.test(String(id))) return null;
  return loadReminders(root).find((row) => row.id === id) || null;
}

/** Patch one reminder: done, snooze, edit text or time. */
export function updateReminder(root, id, patch, now = Date.now()) {
  const reminders = loadReminders(root);
  const index = reminders.findIndex((row) => row.id === id);
  if (index < 0) return null;
  const current = reminders[index];
  const next = { ...current, updated: now };

  if (patch?.text !== undefined) next.text = String(patch.text).slice(0, 300);
  if (patch?.dueAt !== undefined) {
    const when = new Date(patch.dueAt);
    if (Number.isNaN(when.getTime())) throw new Error("dueAt is not a date");
    next.dueAt = when.toISOString();
  }
  if (patch?.repeat !== undefined && REPEATS.has(patch.repeat)) next.repeat = patch.repeat;
  if (patch?.status !== undefined) {
    if (!STATUSES.has(patch.status)) throw new Error("unknown status");
    next.status = patch.status;
  }
  if (patch?.action === "done") {
    next.status = "done";
    next.doneAt = now;
  }
  if (patch?.action === "snooze") {
    const choice = String(patch.snooze || "10m");
    next.dueAt = snoozedUntil(choice, now);
    next.status = "pending";
    next.snoozedFor = choice;
  }
  reminders[index] = next;
  saveReminders(root, reminders);
  return next;
}

/** Snooze keeps 09:00 Warsaw for "tomorrow", as the shared parser does. */
export function snoozedUntil(choice, now) {
  const key = choice === "1h" ? "1h" : choice === "tomorrow" ? "tomorrow" : "10m";
  return snoozeUntil({ dueAt: new Date(now).toISOString() }, key, new Date(now)).toISOString();
}

export function deleteReminder(root, id) {
  const reminders = loadReminders(root);
  const next = reminders.filter((row) => row.id !== id);
  if (next.length === reminders.length) return false;
  saveReminders(root, next);
  return true;
}

/** Pending reminders that are due, oldest first. */
export function dueReminders(reminders, now = Date.now()) {
  return reminders
    .filter((row) => row.status === "pending" || row.status === "snoozed" || row.status === "missed")
    .filter((row) => new Date(row.dueAt).getTime() <= now)
    .sort((left, right) => new Date(left.dueAt).getTime() - new Date(right.dueAt).getTime());
}

/** Reminders missed while the brain was off, grouped into one message. */
export function missedOnStartup(reminders, now = Date.now(), graceMs = 60_000) {
  const missed = reminders
    .filter((row) => row.status === "pending" || row.status === "snoozed")
    .filter((row) => new Date(row.dueAt).getTime() < now - graceMs)
    .sort((left, right) => new Date(left.dueAt).getTime() - new Date(right.dueAt).getTime());
  if (!missed.length) return "";
  if (missed.length === 1) return `Missed: ${missed[0].text}`;
  const lines = missed.slice(0, 5).map((row) => `- ${row.text}`);
  if (missed.length > 5) lines.push(`…and ${missed.length - 5} more`);
  return `Missed ${missed.length} reminders:\n${lines.join("\n")}`;
}

/** AppleScript string literal, with the characters that matter escaped. */
export function escapeAppleScript(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r?\n/g, " ")
    .replace(/\t/g, " ");
}

/** The osascript call that shows a notification. Args are an array, never a shell line. */
export function notificationArgs(title, body) {
  const script = `display notification "${escapeAppleScript(body)}" with title "${escapeAppleScript(title)}" sound name "Ping"`;
  return ["-e", script];
}

export function notify(title, body, options = {}) {
  const { execFileImpl = execFile, timeoutMs = 10_000 } = options;
  return new Promise((resolve) => {
    execFileImpl("osascript", notificationArgs(title, body), { timeout: timeoutMs }, (error) => {
      resolve({ ok: !error });
    });
  });
}

/**
 * One scheduler tick: fire whatever is due, reschedule repeats, mark the rest
 * missed. Returns what happened so tests (and logs) can see it.
 */
export function tick(root, options = {}) {
  const { now = Date.now(), notifyImpl = null } = options;
  const reminders = loadReminders(root);
  const fired = [];
  let changed = false;

  for (const reminder of reminders) {
    if (reminder.status !== "pending" && reminder.status !== "snoozed" && reminder.status !== "missed") continue;
    if (new Date(reminder.dueAt).getTime() > now) continue;
    fired.push(reminder);
    if (reminder.repeat !== "none") {
      reminder.dueAt = nextOccurrence(reminder, new Date(now)).toISOString();
      reminder.status = "pending";
      reminder.updated = now;
    } else {
      reminder.status = "done";
      reminder.doneAt = now;
      reminder.updated = now;
    }
    changed = true;
  }

  if (changed) saveReminders(root, reminders);
  if (notifyImpl && fired.length) {
    const body = fired.length === 1 ? fired[0].text : `${fired[0].text} (+${fired.length - 1} more)`;
    void notifyImpl("Preyas", body);
  }
  return { fired, reminders };
}
