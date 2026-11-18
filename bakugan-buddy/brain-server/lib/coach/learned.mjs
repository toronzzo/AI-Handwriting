/**
 * Learned skills: how often each playbook was completed. A skill counts as
 * learned after LEARNED_AFTER completions, and then renders "short" (no Why).
 */
import fs from "node:fs";
import path from "node:path";

export const LEARNED_AFTER = 2;

function readJson(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
  } catch {
    /* missing or torn file counts as nothing */
  }
  return {};
}

function writeJson(file, value) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temp = `${file}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(value, null, 2));
    fs.renameSync(temp, file);
  } catch {
    /* best effort; the in-memory copy is still right */
  }
}

export function loadLearned(file) {
  if (!file) return {};
  return readJson(file);
}

/** Adds one completion. Returns the new count map. */
export function recordCompletion(file, store, skillName, now = () => Date.now()) {
  const next = { ...store };
  next[skillName] = (typeof next[skillName] === "number" ? next[skillName] : 0) + 1;
  if (file) writeJson(file, next);
  return next;
}

export function isLearned(store, skillName) {
  return (typeof store[skillName] === "number" ? store[skillName] : 0) >= LEARNED_AFTER;
}

export function learnedList(store) {
  return Object.entries(store)
    .filter(([, count]) => typeof count === "number" && count > 0)
    .map(([name, count]) => ({ name, count }))
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name));
}
