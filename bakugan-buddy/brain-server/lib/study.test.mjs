import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  MIN_EASE,
  answersMatch,
  buildDeck,
  buildQuiz,
  deckPath,
  dueCards,
  dueCount,
  dueLine,
  gradeCard,
  listDecks,
  loadDeck,
  parseCards,
  parseQuiz,
  recordQuiz,
  saveDeck,
  scheduleCard,
  scoreQuiz,
  totalDue,
} from "./study.mjs";

const DAY = 86_400_000;
const NOW = new Date("2026-11-03T09:00:00+01:00").getTime();

function drive() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "preyas-study-"));
  return { root, done: () => fs.rmSync(root, { recursive: true, force: true }) };
}

function card(overrides = {}) {
  return { id: "c1", question: "What is a Bakugan?", answer: "A sphere creature.", source: "", due: NOW, interval: 0, ease: 2.5, reps: 0, lapses: 0, createdAt: NOW, ...overrides };
}

function deckWith(cards) {
  return { id: "deck-1", title: "Deck", language: "en", createdAt: NOW, updatedAt: NOW, cards, quizzes: [] };
}

test("again comes back soon and lowers ease", () => {
  const next = scheduleCard(card({ ease: 2.5, reps: 3, interval: 10 }), "again", NOW);
  assert.equal(next.interval, 0);
  assert.equal(next.reps, 0);
  assert.equal(next.lapses, 1);
  assert.equal(next.ease, 2.3);
  assert.equal(next.due, NOW + 10 * 60_000);
});

test("ease never drops below the floor", () => {
  const next = scheduleCard(card({ ease: 1.3 }), "again", NOW);
  assert.equal(next.ease, MIN_EASE);
});

test("hard, good and easy step forward by different amounts", () => {
  const fresh = card();
  assert.equal(scheduleCard(fresh, "hard", NOW).interval, 1);
  assert.equal(scheduleCard(fresh, "good", NOW).interval, 1);
  assert.equal(scheduleCard(fresh, "easy", NOW).interval, 4);

  const mature = card({ reps: 4, interval: 10, ease: 2.5 });
  assert.equal(scheduleCard(mature, "hard", NOW).interval, 12);
  assert.equal(scheduleCard(mature, "good", NOW).interval, 25);
  assert.equal(scheduleCard(mature, "easy", NOW).interval, 28);
  assert.equal(scheduleCard(mature, "easy", NOW).ease, 2.65);
  assert.equal(scheduleCard(mature, "hard", NOW).ease, 2.35);
});

test("due counting only sees cards that are ready", () => {
  const deck = deckWith([
    card({ id: "a", due: NOW - DAY }),
    card({ id: "b", due: NOW }),
    card({ id: "c", due: NOW + DAY }),
  ]);
  assert.equal(dueCount(deck, NOW), 2);
  assert.deepEqual(dueCards(deck, NOW).map((row) => row.id), ["a", "b"]);
  assert.equal(dueCount(deck, NOW + 2 * DAY), 3);
  assert.equal(dueLine(12), "12 flashcards due today");
  assert.equal(dueLine(1), "1 flashcard due today");
  assert.equal(dueLine(0), "");
});

test("model output is validated: fences, thinking and junk are handled", () => {
  const raw = '<think>hm</think>```json\n[{"question":"What is Aquos?","answer":"A water attribute."},{"question":"","answer":"x"},{"question":"Short","answer":"y"},{"question":"Same","answer":"Same"}]\n```';
  const cards = parseCards(raw, "chunk 1");
  assert.equal(cards.length, 1);
  assert.equal(cards[0].question, "What is Aquos?");
  assert.equal(cards[0].source, "chunk 1");
  assert.deepEqual(parseCards("no json"), []);
  assert.deepEqual(parseCards('[{"question":"too short","answer":""}]'), []);
});

test("a deck is built chunk by chunk and deduplicated", async () => {
  const { root, done } = drive();
  try {
    const text = Array.from({ length: 30 }, (_, i) => `Paragraph ${i}: ` + "detail ".repeat(150)).join("\n\n");
    let calls = 0;
    const fetchImpl = async (_url, init) => {
      calls += 1;
      const body = JSON.parse(init.body);
      const isFirst = body.messages[1].content.includes("Paragraph 0");
      const cards = isFirst
        ? [{ question: "What is the first fact?", answer: "The first one." }, { question: "Repeated?", answer: "Yes." }]
        : [{ question: "What is another fact?", answer: "Another one." }];
      return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(cards) } }] }) };
    };
    const deck = await buildDeck(root, {
      title: "arena",
      text,
      llamaUrl: "http://llama",
      fetchImpl,
      now: NOW,
      chunkSize: 2000,
    });
    assert.ok(calls >= 2, "one call per chunk");
    assert.ok(deck.cards.length >= 3);
    assert.equal(new Set(deck.cards.map((row) => row.question.toLowerCase())).size, deck.cards.length);
    assert.equal(deck.cards[0].due, NOW, "new cards are due immediately");
    const onDisk = loadDeck(root, deck.id);
    assert.equal(onDisk.cards.length, deck.cards.length);
    assert.equal(fs.existsSync(`${deckPath(root, deck.id)}.tmp`), false, "atomic write leaves no temp file");
  } finally {
    done();
  }
});

test("a chunk that fails is retried once, then dropped", async () => {
  const { root, done } = drive();
  try {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      if (calls === 1) return { ok: false, status: 500, json: async () => ({}) };
      return {
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify([
                  { question: "Question one here?", answer: "Answer one." },
                  { question: "Question two here?", answer: "Answer two." },
                  { question: "Question three here?", answer: "Answer three." },
                ]),
              },
            },
          ],
        }),
      };
    };
    const deck = await buildDeck(root, { title: "t", text: "some text ".repeat(400), llamaUrl: "http://llama", fetchImpl, now: NOW });
    assert.equal(calls, 2, "the failed chunk was retried");
    assert.ok(deck.cards.length >= 3);
  } finally {
    done();
  }
});

test("a model that never returns usable cards is an error, not an empty deck", async () => {
  const { root, done } = drive();
  try {
    const fetchImpl = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: "sorry, no json" } }] }) });
    await assert.rejects(
      () => buildDeck(root, { title: "t", text: "some text here ".repeat(400), llamaUrl: "http://llama", fetchImpl, now: NOW }),
      /not return enough/,
    );
    assert.deepEqual(listDecks(root), []);
  } finally {
    done();
  }
});

test("grading a card saves the new schedule", () => {
  const { root, done } = drive();
  try {
    saveDeck(root, deckWith([card()]));
    const result = gradeCard(root, "deck-1", "c1", "good", NOW);
    assert.equal(result.card.reps, 1);
    assert.equal(result.card.due, NOW + DAY);
    assert.equal(loadDeck(root, "deck-1").cards[0].due, NOW + DAY);
    assert.equal(gradeCard(root, "deck-1", "nope", "good", NOW), null);
    assert.throws(() => gradeCard(root, "deck-1", "c1", "perfect", NOW), /unknown grade/);
  } finally {
    done();
  }
});

test("due totals add up across decks", () => {
  const { root, done } = drive();
  try {
    saveDeck(root, { ...deckWith([card({ id: "a" }), card({ id: "b" })]), id: "deck-a" });
    saveDeck(root, { ...deckWith([card({ id: "c", due: NOW + DAY })]), id: "deck-b" });
    assert.equal(totalDue(root, NOW), 2);
    assert.equal(listDecks(root).length, 2);
  } finally {
    done();
  }
});

test("quiz questions parse, answers match loosely, and scoring is honest", () => {
  const raw = JSON.stringify([
    { question: "When does the arena launch?", answer: "March 3", options: ["March 3", "April 1", "May 5", "June 6"] },
    { question: "What must be renewed?", answer: "The passport", options: [] },
    { question: "Bad", answer: "" },
  ]);
  const quiz = parseQuiz(raw);
  assert.equal(quiz.length, 2);
  assert.equal(quiz[0].options.length, 4);
  assert.deepEqual(quiz[1].options, []);

  assert.equal(answersMatch("march 3", "March 3"), true);
  assert.equal(answersMatch("The passport", "passport"), true);
  assert.equal(answersMatch("renew the passport before the trip", "The passport"), true);
  assert.equal(answersMatch("April 1", "March 3"), false);

  const scored = scoreQuiz([{ correct: true }, { correct: false }, { correct: true }]);
  assert.deepEqual(scored, { score: 2, total: 3, percent: 67 });
});

test("a quiz result is stored on the deck", () => {
  const { root, done } = drive();
  try {
    saveDeck(root, deckWith([card()]));
    const deck = recordQuiz(root, "deck-1", { score: 4, total: 5, results: [{ question: "q", correct: true }] }, NOW);
    assert.equal(deck.quizzes.length, 1);
    assert.equal(loadDeck(root, "deck-1").quizzes[0].score, 4);
  } finally {
    done();
  }
});

test("a quiz is generated from the relevant excerpts", async () => {
  let seen = "";
  const quiz = await buildQuiz("http://llama", "The arena launches on March 3. ".repeat(30), {
    question: "launch",
    fetchImpl: async (_url, init) => {
      seen = JSON.parse(init.body).messages[1].content;
      return {
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify([
                  { question: "When is the launch?", answer: "March 3", options: ["March 3", "June 1"] },
                ]),
              },
            },
          ],
        }),
      };
    },
  });
  assert.match(seen, /launches on March 3/);
  assert.equal(quiz.length, 1);
});
