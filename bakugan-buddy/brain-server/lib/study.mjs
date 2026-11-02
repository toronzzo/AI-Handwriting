/**
 * Flashcards, spaced repetition and quizzes on top of the user's documents.
 *
 * All scheduling is plain arithmetic (a small SM-2), so it is testable with a
 * fixed clock. The model only writes the card text; it never decides when a
 * card is due.
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { chunkText, pickRelevantChunks } from "./documents.mjs";

export const GRADES = ["again", "hard", "good", "easy"];
export const MIN_EASE = 1.3;
export const NEW_PER_DAY = 20;

export function studyDir(root) {
  return path.join(root, "memory", "study");
}

export function decksDir(root) {
  return path.join(studyDir(root), "decks");
}

const ID_RE = /^[A-Za-z0-9_-]+$/;

export function deckPath(root, id) {
  if (!ID_RE.test(String(id))) throw new Error("bad deck id");
  return path.join(decksDir(root), `${id}.json`);
}

export function loadDeck(root, id) {
  const file = deckPath(root, id);
  if (!fs.existsSync(file)) return null;
  try {
    return normalizeDeck(JSON.parse(fs.readFileSync(file, "utf8")));
  } catch {
    return null;
  }
}

export function normalizeDeck(raw) {
  const cards = Array.isArray(raw?.cards) ? raw.cards : [];
  return {
    id: String(raw?.id || ""),
    title: String(raw?.title || "Deck").slice(0, 120),
    language: String(raw?.language || "en").slice(0, 8),
    createdAt: Number(raw?.createdAt) || 0,
    updatedAt: Number(raw?.updatedAt) || 0,
    cards: cards
      .filter((card) => card && typeof card.question === "string" && typeof card.answer === "string")
      .map((card, index) => ({
        id: String(card.id || `card-${index + 1}`),
        question: String(card.question).slice(0, 500),
        answer: String(card.answer).slice(0, 800),
        source: String(card.source || "").slice(0, 300),
        due: Number(card.due) || 0,
        interval: Math.max(0, Number(card.interval) || 0),
        ease: Math.max(MIN_EASE, Number(card.ease) || 2.5),
        reps: Math.max(0, Number(card.reps) || 0),
        lapses: Math.max(0, Number(card.lapses) || 0),
        createdAt: Number(card.createdAt) || 0,
      })),
    quizzes: Array.isArray(raw?.quizzes)
      ? raw.quizzes.slice(-30).map((quiz) => ({
          at: Number(quiz?.at) || 0,
          score: Number(quiz?.score) || 0,
          total: Number(quiz?.total) || 0,
          results: Array.isArray(quiz?.results)
            ? quiz.results.map((row) => ({ question: String(row?.question || ""), correct: Boolean(row?.correct) }))
            : [],
        }))
      : [],
  };
}

/** Atomic write: temp file, then rename. */
export function saveDeck(root, deck) {
  const dir = decksDir(root);
  fs.mkdirSync(dir, { recursive: true });
  const file = deckPath(root, deck.id);
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(deck, null, 2)}\n`);
  fs.renameSync(temp, file);
  return deck;
}

export function listDecks(root) {
  const dir = decksDir(root);
  if (!fs.existsSync(dir)) return [];
  const decks = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    const deck = loadDeck(root, name.slice(0, -5));
    if (deck) decks.push(deck);
  }
  return decks.sort((left, right) => right.updatedAt - left.updatedAt);
}

export function deleteDeck(root, id) {
  const file = deckPath(root, id);
  if (!fs.existsSync(file)) return false;
  fs.unlinkSync(file);
  return true;
}

/**
 * SM-2, simplified: four buttons.
 *   again → due now, ease down, streak reset
 *   hard  → small step, ease down slightly
 *   good  → normal step
 *   easy  → longer step, ease up
 */
export function scheduleCard(card, grade, now = Date.now()) {
  const ease = Math.max(MIN_EASE, Number(card.ease) || 2.5);
  const reps = Math.max(0, Number(card.reps) || 0);
  const interval = Math.max(0, Number(card.interval) || 0);
  const day = 86_400_000;

  if (grade === "again") {
    return {
      ...card,
      ease: Math.max(MIN_EASE, ease - 0.2),
      interval: 0,
      reps: 0,
      lapses: (Number(card.lapses) || 0) + 1,
      due: now + 10 * 60_000,
    };
  }

  if (grade === "hard") {
    const next = reps === 0 ? 1 : Math.max(1, Math.round(interval * 1.2));
    return { ...card, ease: Math.max(MIN_EASE, ease - 0.15), interval: next, reps: reps + 1, due: now + next * day };
  }

  if (grade === "easy") {
    const next = reps === 0 ? 4 : Math.max(2, Math.round(interval * (ease + 0.3)));
    return { ...card, ease: Math.min(3.0, ease + 0.15), interval: next, reps: reps + 1, due: now + next * day };
  }

  const next = reps === 0 ? 1 : Math.max(1, Math.round(interval * ease));
  return { ...card, interval: next, reps: reps + 1, due: now + next * day };
}

/** Cards due now (or overdue), newest-due first; new cards count as due. */
export function dueCards(deck, now = Date.now()) {
  return deck.cards
    .filter((card) => (card.due || 0) <= now)
    .sort((left, right) => (left.due || 0) - (right.due || 0));
}

export function dueCount(deck, now = Date.now()) {
  return deck.cards.filter((card) => (card.due || 0) <= now).length;
}

/** "12 flashcards due today" for the briefing. */
export function dueLine(total) {
  if (!total) return "";
  return `${total} flashcard${total === 1 ? "" : "s"} due today`;
}

/* ------------------------------------------------------------------ */
/* Model-written cards                                                 */
/* ------------------------------------------------------------------ */

const CARD_SYSTEM = [
  "You write study flashcards from one excerpt of a student's document.",
  "Reply with one JSON array and nothing else. Each item: {\"question\": \"...\", \"answer\": \"...\"}.",
  "Questions must be answerable from the excerpt alone. Answers are one or two sentences.",
  "Write in the same language as the excerpt. No preamble, no markdown fences.",
].join("\n");

/** Parse and validate the model's JSON; anything unusable is dropped. */
export function parseCards(raw, source = "") {
  let text = String(raw ?? "");
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/```(?:json)?/gi, "");
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end <= start) return [];
  let parsed;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const cards = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const question = String(item.question ?? item.q ?? "").replace(/\s+/g, " ").trim();
    const answer = String(item.answer ?? item.a ?? "").replace(/\s+/g, " ").trim();
    // A card with a blank side, or a question that merely repeats its answer, is useless.
    if (question.length < 8 || answer.length < 2) continue;
    if (question.toLowerCase() === answer.toLowerCase()) continue;
    cards.push({ question: question.slice(0, 500), answer: answer.slice(0, 800), source: String(source).slice(0, 300) });
  }
  return cards;
}

async function askCards(llamaUrl, chunk, language, fetchImpl) {
  const res = await fetchImpl(`${llamaUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: "preyas",
      stream: false,
      temperature: 0.3,
      max_tokens: 900,
      chat_template_kwargs: { enable_thinking: false },
      messages: [
        { role: "system", content: CARD_SYSTEM },
        {
          role: "user",
          content: `Language: ${language}\n\nExcerpt:\n${chunk}\n\nWrite 3 to 5 flashcards as JSON.\n/no_think`,
        },
      ],
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`model answered ${res.status}`);
  const json = await res.json();
  return String(json?.choices?.[0]?.message?.content || "");
}

/**
 * Build a deck chunk by chunk. A failed chunk is retried once, then dropped;
 * a deck with too few usable cards is an error, not an empty file.
 */
export async function buildDeck(root, options = {}) {
  const {
    title,
    name = "document",
    text,
    language = "en",
    llamaUrl,
    fetchImpl = fetch,
    now = Date.now(),
    chunkSize,
    maxCards = 20,
  } = options;
  const chunks = chunkText(text, chunkSize);
  if (!chunks.length) throw new Error("no readable text to make cards from");
  const cards = [];
  const seen = new Set();

  for (let index = 0; index < chunks.length && cards.length < maxCards; index += 1) {
    const chunk = chunks[index];
    let made = [];
    for (let attempt = 0; attempt < 2 && made.length === 0; attempt += 1) {
      try {
        made = parseCards(await askCards(llamaUrl, chunk, language, fetchImpl), `chunk ${index + 1}`);
      } catch {
        made = [];
      }
    }
    for (const card of made) {
      const key = card.question.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      cards.push({ ...card, id: randomUUID(), due: now, interval: 0, ease: 2.5, reps: 0, lapses: 0, createdAt: now });
      if (cards.length >= maxCards) break;
    }
  }

  if (cards.length < 3) throw new Error("the model did not return enough usable cards");
  const deck = normalizeDeck({
    id: randomUUID(),
    title: String(title || name).slice(0, 120),
    language,
    createdAt: now,
    updatedAt: now,
    cards,
    quizzes: [],
  });
  saveDeck(root, deck);
  return deck;
}

/** Grade one card and persist the deck. */
export function gradeCard(root, deckId, cardId, grade, now = Date.now()) {
  const deck = loadDeck(root, deckId);
  if (!deck) return null;
  const index = deck.cards.findIndex((card) => card.id === cardId);
  if (index < 0) return null;
  if (!GRADES.includes(grade)) throw new Error("unknown grade");
  deck.cards[index] = scheduleCard(deck.cards[index], grade, now);
  deck.updatedAt = now;
  saveDeck(root, deck);
  return { deck, card: deck.cards[index] };
}

export function recordQuiz(root, deckId, result, now = Date.now()) {
  const deck = loadDeck(root, deckId);
  if (!deck) return null;
  deck.quizzes.push({
    at: now,
    score: Math.max(0, Number(result?.score) || 0),
    total: Math.max(0, Number(result?.total) || 0),
    results: Array.isArray(result?.results)
      ? result.results.map((row) => ({ question: String(row?.question || ""), correct: Boolean(row?.correct) }))
      : [],
  });
  deck.updatedAt = now;
  saveDeck(root, deck);
  return deck;
}

/* ------------------------------------------------------------------ */
/* Quiz                                                                */
/* ------------------------------------------------------------------ */

const QUIZ_SYSTEM = [
  "You write a short quiz from one excerpt of a student's document.",
  "Reply with one JSON array of five items and NOTHING else: no prose, no explanation, no markdown.",
  'Start your reply with [ and end with ]. Each item: {"question": "...", "answer": "...", "options": ["...","...","...","..."]}.',
  "Use four options for multiple choice; use an empty options array for a short-answer question.",
  "The answer must be one of the options when options are given. Same language as the excerpt.",
].join("\n");

/** Five questions: multiple choice where options are offered, else short answer. */
export function parseQuiz(raw) {
  let text = String(raw ?? "");
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/```(?:json)?/gi, "");
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end <= start) return [];
  let parsed;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const questions = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const prompt = String(item.question || "").trim();
    const answer = String(item.answer || "").trim();
    if (prompt.length < 8 || !answer) continue;
    const options = Array.isArray(item.options)
      ? item.options.map((option) => String(option).trim()).filter(Boolean).slice(0, 4)
      : [];
    questions.push({
      question: prompt.slice(0, 400),
      answer: answer.slice(0, 400),
      options: options.length >= 2 ? options : [],
    });
    if (questions.length >= 5) break;
  }
  return questions;
}

/** Loose comparison: case, punctuation and articles do not decide a correct answer. */
export function answersMatch(given, expected) {
  const norm = (value) =>
    String(value ?? "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]+/gu, " ")
      .replace(/\b(a|an|the|и|в|на)\b/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const left = norm(given);
  const right = norm(expected);
  if (!left || !right) return false;
  if (left === right) return true;
  if (left.includes(right) || right.includes(left)) return true;
  const rightWords = right.split(" ").filter((word) => word.length > 3);
  if (!rightWords.length) return false;
  const hits = rightWords.filter((word) => left.includes(word)).length;
  return hits / rightWords.length >= 0.6;
}

export function scoreQuiz(results) {
  const total = results.length;
  const score = results.filter((row) => row.correct).length;
  return { score, total, percent: total ? Math.round((score / total) * 100) : 0 };
}

/**
 * Ask for a quiz, retrying when the model answers with prose instead of JSON.
 * The 8B model does that often enough that one attempt is not enough.
 */
export async function buildQuiz(llamaUrl, text, options = {}) {
  const { fetchImpl = fetch, language = "en", question = "", attempts = 3 } = options;
  const chunks = chunkText(text);
  const picked = question ? pickRelevantChunks(chunks, question, 2) : chunks.slice(0, 2);
  let questions = [];

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const res = await fetchImpl(`${llamaUrl}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "preyas",
          stream: false,
          temperature: attempt === 0 ? 0.4 : 0.1,
          max_tokens: 900,
          chat_template_kwargs: { enable_thinking: false },
          messages: [
            { role: "system", content: QUIZ_SYSTEM },
            { role: "user", content: `Language: ${language}\n\nExcerpt:\n${picked.join("\n\n")}\n\n/no_think` },
          ],
        }),
        signal: AbortSignal.timeout(120_000),
      });
      if (!res.ok) continue;
      const json = await res.json();
      const parsed = parseQuiz(String(json?.choices?.[0]?.message?.content || ""));
      if (parsed.length > questions.length) questions = parsed;
      if (questions.length >= 5) break;
    } catch {
      /* try once more, then give up quietly */
    }
  }
  return questions;
}

/** Total due across every deck, for the briefing line. */
export function totalDue(root, now = Date.now()) {
  return listDecks(root).reduce((sum, deck) => sum + dueCount(deck, now), 0);
}
