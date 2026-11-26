import test from "node:test";
import assert from "node:assert/strict";
import { normalize, numbersIn, scoreAnswer, summarize, byKind } from "./score.mjs";

test("normalize strips markdown and unifies dashes and case", () => {
  assert.equal(normalize("  **Qwen3 8B Q4** \u2014 main  "), "qwen3 8b q4 - main");
});

test("numbers are tokens, so 17 never answers 7", () => {
  assert.ok(numbersIn("we met at 17:00").has("17"));
  assert.ok(!numbersIn("we met at 17").has("7"));
  const scored = scoreAnswer({ answer: "17 years", must: ["7"] });
  assert.equal(scored.facts.score, 0);
});

test("must and any both count toward the fact score", () => {
  const scored = scoreAnswer({
    answer: "You are **jobless** and want a job.",
    must: [],
    any: [["jobless", "unemployed"]],
  });
  assert.equal(scored.facts.score, 1);
  assert.equal(scored.pass, true);
});

test("a missing must phrase fails the item even when the rest is right", () => {
  const scored = scoreAnswer({ answer: "Use Qwen3 8B as the main model.", must: ["Qwen3 8B Q4"] });
  assert.equal(scored.pass, false);
  assert.deepEqual(scored.facts.missing, ["Qwen3 8B Q4"]);
});

test("a hyphenated model filename satisfies the spaced requirement", () => {
  const scored = scoreAnswer({
    answer: "Use **Huihui-Qwen3-14B-abliterated-v2.Q4_K_M.gguf** for hard questions.",
    must: ["Qwen3 14B"],
  });
  assert.equal(scored.pass, true);
});

test("separator folding does not let one model answer another", () => {
  const scored = scoreAnswer({ answer: "Use Qwen3.5-0.8B for quick answers.", must: ["Qwen3 8B Q4"] });
  assert.equal(scored.pass, false);
});

test("contradictions are reported separately from recall", () => {
  const scored = scoreAnswer({
    answer: "Your main model is Qwen3 14B.",
    must: ["Qwen3 14B"],
    mustNot: ["main model is Qwen3 14B"],
  });
  assert.equal(scored.facts.score, 1);
  assert.equal(scored.contradictions.length, 1);
  assert.equal(scored.pass, false);
});

test("fabricated numbers are those the item does not allow", () => {
  const scored = scoreAnswer({
    answer: "The arena ships on March 3 and costs 500 PLN, around 1200 total.",
    must: ["March 3"],
    allow: ["500"],
    source: "Ship Bakugan arena on March 3.",
  });
  assert.deepEqual(scored.fabricated, ["1200"]);
  assert.equal(scored.pass, true);
});

test("a number that lives in another note is recalled, not invented", () => {
  const scored = scoreAnswer({
    answer: "Qwen3.5-0.8B handles quick answers; the 14B file is 8.4 GB.",
    must: ["Qwen3.5 0.8B"],
    known: ["0.8", "14"],
  });
  assert.deepEqual(scored.fabricated, ["8.4"]);
  assert.equal(scored.pass, true);
});

test("summary counts passes, errors and timings without dividing by zero", () => {
  const rows = [
    { kind: "fact", pass: true, facts: { score: 1 }, contradictions: [], fabricated: [], seconds: 10, tokens: 100 },
    { kind: "fact", pass: false, facts: { score: 0.5 }, contradictions: ["x"], fabricated: ["9"], seconds: 20, tokens: 300 },
    { kind: "fact", error: "timeout" },
  ];
  const all = summarize(rows);
  assert.equal(all.count, 2);
  assert.equal(all.errors, 1);
  assert.equal(all.factScore, 0.75);
  assert.equal(all.passRate, 0.5);
  assert.equal(all.meanSeconds, 15);
  assert.equal(all.meanTokens, 200);
  assert.equal(byKind(rows)[0].kind, "fact");
  assert.equal(summarize([]).factScore, 0);
});
