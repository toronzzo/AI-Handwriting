import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MEMORY_CAP,
  cosine,
  mergeFacts,
  parseExtractedFacts,
  rankFacts,
  type MemoryFact,
} from "./longMemory.ts";

test("extraction keeps at most three short facts", () => {
  const raw = `
    <think>hmm</think>
    {"facts":[
      {"text":"The partner likes the window side.","kind":"user"},
      {"text":"They left the room and came back.","kind":"event"},
      {"text":"  too   spaced  "},
      {"text":"Fourth fact should drop.","kind":"user"}
    ]}
  `;
  const facts = parseExtractedFacts(raw);
  assert.equal(facts.length, 3);
  assert.equal(facts[0]!.kind, "user");
  assert.equal(facts[1]!.kind, "event");
  assert.equal(facts[2]!.text, "too spaced");
  assert.equal(parseExtractedFacts("nope").length, 0);
});

test("memory stays bounded and does not store the same fact twice", () => {
  const existing: MemoryFact[] = [];
  for (let i = 0; i < MEMORY_CAP; i++) existing.push({ text: `fact ${i}`, kind: "event" });
  const next = mergeFacts(existing, [
    { text: "fact 0", kind: "user" },
    { text: "The partner calls him Preyas.", kind: "user" },
  ]);
  assert.equal(next.length, MEMORY_CAP);
  assert.equal(next[0]!.text, "fact 1");
  assert.equal(next[next.length - 1]!.text, "The partner calls him Preyas.");
  assert.equal(next.some((fact) => fact.text === "fact 0"), false);
});

test("recall prefers the fact that shares words, and a vector can outrank that", () => {
  const facts: MemoryFact[] = [
    { text: "The cushion is the quiet spot.", kind: "event" },
    { text: "The partner drinks tea by the window.", kind: "user" },
  ];
  const words = rankFacts(facts, "tea window", 2);
  assert.equal(words[0]!.text, facts[1]!.text);
  const withVec: MemoryFact[] = [
    { text: "The cushion is the quiet spot.", kind: "event", vec: [1, 0] },
    { text: "The partner drinks tea by the window.", kind: "user", vec: [0, 1] },
  ];
  const vec = rankFacts(withVec, "tea window", 1, [1, 0]);
  assert.equal(vec[0]!.text, withVec[0]!.text);
  assert.ok(cosine([1, 0], [1, 0]) > cosine([1, 0], [0, 1]));
});
