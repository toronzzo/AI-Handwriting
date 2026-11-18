/**
 * Coach retrieval: which playbook fits this request, and which past lessons
 * to remind the user of. Uses the shared BM25 (scoreNotes) from the alive
 * package — no embeddings, no network.
 */
import { scoreNotes } from "../../../packages/alive/src/notes.ts";

/** Lowercase, punctuation-free; used for phrase containment checks. */
export function normalizeQuery(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The score must pass this to count at all. */
export const MATCH_THRESHOLD = 1.0;
/** Lessons are short documents; any real term overlap counts. */
export const LESSON_THRESHOLD = 0.2;
/** Top result must outscore the second by this factor for a "high" match. */
export const MATCH_RATIO = 1.3;
/** `when` phrases are weighted this many times in the index text. */
const WHEN_WEIGHT = 3;
/**
 * Skill matching uses a near-linear BM25 (large k1): skill indexes repeat
 * their trigger phrases, so the classic saturating k1 makes a skill that
 * mentions a word 12 times score like one that mentions it 8 times.
 */
const SKILL_TUNING = { k1: 20, b: 0.75 };

/** Index text: name + when phrases (weighted) + the first paragraph. */
export function skillIndexText(skill) {
  const parts = [skill.name, skill.intro];
  for (let i = 0; i < WHEN_WEIGHT; i++) parts.push(skill.when.join(" "));
  return parts.filter(Boolean).join(" ");
}

/**
 * findSkill(skills, query) -> { skill: null | skill, confidence, score }.
 * `skills` are the loaded entries ({ file, ok, skill, errors }); entries that
 * did not parse are ignored.
 * High only when a `when` phrase is literally contained in the normalised
 * query, or the top BM25 score is at least MATCH_RATIO times the second and
 * above MATCH_THRESHOLD. Otherwise low (still above threshold) or none.
 */
export function findSkill(entries, query) {
  const skills = entries.filter((entry) => entry.ok).map((entry) => entry.skill);
  const normalised = normalizeQuery(query);
  if (!skills.length || !normalised) return { skill: null, confidence: "none", score: 0 };

  const contained = [];
  for (const skill of skills) {
    for (const phrase of skill.when) {
      if (phrase && normalised.includes(normalizeQuery(phrase))) {
        contained.push(skill);
        break;
      }
    }
  }
  if (contained.length) {
    // Several skills may share a phrase ("cd"); the BM25 score breaks the tie.
    const rows = scoreNotes(
      contained.map((skill) => ({ text: skillIndexText(skill), skill })),
      normalised,
      contained.length,
    );
    const best = rows[0];
    return { skill: best ? best.item.skill : contained[0], confidence: "high", score: best ? best.score : 0 };
  }

  const rows = scoreNotes(
    skills.map((skill) => ({ text: skillIndexText(skill), skill })),
    normalised,
    2,
    SKILL_TUNING,
  );
  const top = rows[0];
  if (!top) return { skill: null, confidence: "none", score: 0 };
  const second = rows[1];
  if (top.score >= MATCH_THRESHOLD && (!second || top.score >= MATCH_RATIO * second.score)) {
    return { skill: top.item.skill, confidence: "high", score: top.score };
  }
  if (top.score >= MATCH_THRESHOLD) return { skill: top.item.skill, confidence: "low", score: top.score };
  return { skill: null, confidence: "none", score: top.score };
}

/** One line of the lessons log. */
export function lessonIndexText(lesson) {
  return [lesson.situation, lesson.cause, lesson.fix].filter(Boolean).join(" ");
}

/** Top lessons for a query, best first. Never more than `limit`. */
export function searchLessons(lessons, query, limit = 2) {
  const rows = scoreNotes(
    lessons.map((lesson) => ({ text: lessonIndexText(lesson), lesson })),
    normalizeQuery(query),
    limit,
  );
  return rows.map((row) => ({ lesson: row.item.lesson, score: row.score }));
}
