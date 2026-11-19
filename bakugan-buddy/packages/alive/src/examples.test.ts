import { test } from "node:test";
import assert from "node:assert/strict";
import { formatExamples, pickExamples, type Example } from "./examples.ts";

const EXAMPLES: Example[] = [
  { id: "e1", q: "How do I merge a pull request on GitHub?", a: "Open the pull request, check the green checks, click Squash and merge. Always merge into main from a harness branch.", lang: "en" },
  { id: "e2", q: "How can I sleep better?", a: "Stop screens 30 minutes before bed and keep the bedroom dark and cool. The same wake-up time every day matters more than bedtime.", lang: "en" },
  { id: "e3", q: "How should I split my monthly budget?", a: "Try 50 percent needs, 30 percent wants, 20 percent savings. Track every tenge for one week first, then adjust the split.", lang: "en" },
  { id: "e4", q: "Summarise the book Dune for me.", a: "Dune is about Paul Atreides, a desert planet called Arrakis, spice that powers space travel, and the fight for freedom.", lang: "en" },
  { id: "e5", q: "What should I check when reviewing a pull request?", a: "Check the diff file list first, then that CI is green, then read the riskiest file line by line. Never merge with failing checks.", lang: "en" },
  { id: "e6", q: "How do I stay focused during study?", a: "Use a 25 minute focus block, phone in another room, one task per block. Break for five minutes and write down what distracted you.", lang: "en" },
  { id: "e7", q: "Как смержить пулреквест на GitHub?", a: "Открой пулреквест, проверь зелёные галочки, нажми Squash and merge. Всегда в main и только с ветки harness.", lang: "ru" },
  { id: "e8", q: "Как лучше спать?", a: "Убери экраны за полчаса до сна и держи комнату прохладной. Подъём в одно и то же время важнее времени отбоя.", lang: "ru" },
  { id: "e9", q: "Как распределить бюджет на месяц?", a: "Попробуй 50 процентов на необходимое, 30 на желания, 20 в сбережения. Сначала неделю записывай каждый тенге.", lang: "ru" },
  { id: "e10", q: "Расскажи про книгу Дюна.", a: "Дюна — про Пола Атрейдеса, пустынную планету Арракис, спайс и борьбу за свободу.", lang: "ru" },
  { id: "e11", q: "Что проверять при ревью пулреквеста?", a: "Сначала список файлов, потом зелёный CI, потом самый рискованный файл построчно. Не мержи при падающих проверках.", lang: "ru" },
  { id: "e12", q: "Как сосредоточиться на учёбе?", a: "Блок 25 минут, телефон в другой комнате, одна задача на блок. Потом перерыв пять минут и запиши, что отвлекало.", lang: "ru" },
];

const QUESTIONS: [string, string][] = [
  ["how do I merge a pull request", "e1"],
  ["как смержить пулреквест", "e7"],
  ["I can't sleep well at night", "e2"],
  ["как распределить деньги на месяц", "e9"],
  ["what do I check in a code review", "e5"],
  ["что проверить при ревью", "e11"],
  ["tell me about the book Dune", "e4"],
  ["как сосредоточиться на учёбе", "e12"],
];

test("8 fixture questions each pick the expected example first", () => {
  for (const [question, id] of QUESTIONS) {
    const picked = pickExamples(EXAMPLES, question);
    assert.ok(picked.length > 0, `"${question}" picked nothing`);
    assert.equal(picked[0].id, id, `"${question}" should pick ${id}, got ${picked[0].id}`);
  }
});

test("an unrelated question picks none", () => {
  assert.deepEqual(pickExamples(EXAMPLES, "what is the weather in Gdansk today"), []);
  assert.deepEqual(pickExamples(EXAMPLES, "what is 17 times 24"), []);
});

test("at most 2, and short or command text picks none", () => {
  const both = pickExamples(EXAMPLES, "merge the pull request and check the review");
  assert.ok(both.length <= 2);
  assert.deepEqual(pickExamples(EXAMPLES, "hi"), []);
  assert.deepEqual(pickExamples(EXAMPLES, "/briefing"), []);
  assert.deepEqual(pickExamples(EXAMPLES, "coach merge the PR"), []);
  assert.deepEqual(pickExamples(EXAMPLES, "remember buy milk"), []);
});

test("formatExamples stays within 1000 chars and never cuts inside a word", () => {
  const long = EXAMPLES.map((example) => ({
    ...example,
    a: `answer with many words: ${"word ".repeat(120)}`,
  }));
  const block = formatExamples(pickExamples(long, "how do I merge a pull request"));
  assert.ok(block.length <= 1000, `block is ${block.length} chars`);
  assert.ok(block.startsWith("Examples of good answers (copy the style, not the facts):"));
  const words = block.split(/\s+/).filter(Boolean);
  assert.ok(words.length > 5);
  // The block ends at a word boundary: its last word appears whole in a source answer.
  const lastWord = words[words.length - 1].replace(/[^a-zа-яё]/gi, "");
  assert.ok(long.some((example) => example.a.includes(lastWord) || example.q.includes(lastWord)), `last word "${lastWord}" is cut`);
});

test("empty list -> empty string", () => {
  assert.equal(formatExamples([]), "");
  assert.equal(formatExamples(pickExamples([], "how do I merge a pull request")), "");
});
