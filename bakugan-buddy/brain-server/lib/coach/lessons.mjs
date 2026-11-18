/**
 * Lessons log: append-only JSONL, one lesson per line. Existing bytes are
 * never touched; torn lines are skipped on load. Fields are capped and
 * redacted before they are stored.
 */
import fs from "node:fs";
import path from "node:path";
import { redactSecrets } from "./redact.mjs";

export const LESSON_FIELD_MAX = 400;

export function localDay(now = new Date()) {
  const d = now instanceof Date ? now : new Date(now);
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

export function cleanLessonField(text, max = LESSON_FIELD_MAX) {
  return redactSecrets(String(text ?? "").replace(/\s+/g, " ").trim()).slice(0, max);
}

/** Appends one line; never rewrites existing bytes. */
export function appendLesson(file, list, { date, situation, cause, fix, skill }, now = () => Date.now()) {
  const lesson = {
    v: 1,
    date: date || localDay(now()),
    situation: cleanLessonField(situation),
    cause: cleanLessonField(cause),
    fix: cleanLessonField(fix),
    skill: String(skill ?? "").replace(/\s+/g, " ").trim().slice(0, 80),
  };
  if (!lesson.situation && !lesson.fix) return { lesson: null, saved: false };
  list.push(lesson);
  if (file) {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.appendFileSync(file, JSON.stringify(lesson) + "\n");
    } catch {
      /* best effort; the in-memory copy is still there */
    }
  }
  return { lesson, saved: true };
}

/** Reads the log; torn or invalid lines are skipped, never fatal. */
export function loadLessons(file) {
  const lessons = [];
  if (!file || !fs.existsSync(file)) return lessons;
  let text = "";
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return lessons;
  }
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      if (!parsed || typeof parsed !== "object" || parsed.v !== 1) continue;
      if (!parsed.date || !(parsed.situation || parsed.fix)) continue;
      lessons.push({
        v: 1,
        date: String(parsed.date),
        situation: String(parsed.situation ?? ""),
        cause: String(parsed.cause ?? ""),
        fix: String(parsed.fix ?? ""),
        skill: String(parsed.skill ?? ""),
      });
    } catch {
      /* torn line: skip */
    }
  }
  return lessons;
}
