import assert from "node:assert/strict";
import test from "node:test";
import {
  dates,
  extractBatch,
  extractEntities,
  extractionPrompt,
  hashText,
  labelFromNote,
  amounts,
  mergeCandidates,
  parseBatchReply,
  phrases,
  properNouns,
  quotes,
  ruleEntities,
  ruleFacts,
} from "./extract.mjs";

test("a label drops the verb that adds nothing on a plate", () => {
  assert.equal(labelFromNote("Use Qwen3 8B Q4 as main model."), "Qwen3 8B Q4 as main model");
});

test("a label never ends on a dangling preposition", () => {
  assert.equal(labelFromNote("Calculate prices for deepseek based on"), "prices for deepseek");
});

test("a label never cuts inside a word", () => {
  const text = "Deterministic seeded force directed layout for the atlas graph with a reserved band";
  const label = labelFromNote(text, { max: 52 });
  assert.ok(label.length <= 52, `label is ${label.length} chars`);
  assert.ok(text.startsWith(label), "the label is a prefix of the note");
  assert.equal(text[label.length], " ", "the cut landed on a space, not mid-word");
});

test("a dot inside a version number is part of the name, not a full stop", () => {
  assert.equal(
    labelFromNote("Switch to Qwen2.5-VL-3B for photo questions."),
    "Qwen2.5-VL-3B for photo questions",
  );
});

test("parentheticals are dropped before the label is cut", () => {
  assert.equal(labelFromNote("Refine explanation of turbocharger (with corrections)"), "Refine explanation of turbocharger");
});

test("a capitalised name inside a sentence is an entity", () => {
  assert.deepEqual(properNouns("Use Qwen3 8B Q4 as main model."), ["Qwen3"]);
});

test("the capital that only starts a sentence is not an entity", () => {
  assert.deepEqual(properNouns("Partner explained what a data engineer does."), []);
  assert.deepEqual(properNouns("Done. Saturn is nice."), []);
});

test("a phrase after about turns into an entity", () => {
  assert.ok(phrases("Read more about supernovas").includes("supernovas"));
});

test("amounts, dates and quotes are read by rule", () => {
  assert.deepEqual(amounts("lunch plov 1500 сум"), ["1500 сум"]);
  assert.ok(dates("Dentist on 2026-11-30").includes("2026-11-30"));
  assert.deepEqual(quotes('She said "the plan is fine" today'), ["the plan is fine"]);
  const facts = ruleFacts('Pay 1500 сум on 2026-11-30, she said "done"');
  assert.equal(facts.amounts.length, 1);
  assert.equal(facts.dates.length, 1);
  assert.equal(facts.quotes.length, 1);
});

test("rule entities are deduped case-insensitively and keep their first rule", () => {
  const found = ruleEntities("Use Qwen3 8B. Qwen3 is fast.");
  const names = found.map((entry) => entry.surface.toLowerCase());
  assert.equal(names.filter((name) => name === "qwen3").length, 1);
  assert.equal(found.find((entry) => entry.surface === "Qwen3").rule, "proper");
});

test("a batched reply is only accepted when every note has its own index", () => {
  assert.deepEqual(parseBatchReply("1|Qwen3;Q4\n2|NASA", 2), [["Qwen3", "Q4"], ["NASA"]]);
});

test("a collapsed reply is rejected, not silently reused", () => {
  // The model once answered every note with the same "N" index.
  assert.equal(parseBatchReply("N|Qwen3;Q4\nN|NASA", 2), null);
  assert.equal(parseBatchReply("1|Qwen3\n1|NASA", 2), null);
  assert.equal(parseBatchReply("1|Qwen3", 2), null);
  assert.equal(parseBatchReply("", 2), null);
});

test("the extraction prompt always turns reasoning off", () => {
  const prompt = extractionPrompt(["one note"]);
  assert.ok(prompt.includes("/no_think"));
  assert.ok(prompt.includes("1. one note"));
});

test("rule and model names merge without duplicates", () => {
  const merged = mergeCandidates(
    [{ surface: "Qwen3", rule: "proper" }],
    ["qwen3", "Flash"],
  );
  assert.equal(merged.length, 2);
  assert.equal(merged[0].confidence, 0.9);
  assert.equal(merged[1].surface, "Flash");
  assert.equal(merged[1].why, "model");
});

test("rules alone are enough when they find something", async () => {
  let calls = 0;
  const chat = async () => {
    calls += 1;
    return "1|ignored";
  };
  const result = await extractEntities({ text: "Use DeepSeek Flash for tasks", chat });
  assert.equal(result.from, "rules");
  assert.equal(calls, 0, "the model is not asked when the rules already answered");
  assert.ok(result.entities.length >= 2);
});

test("the model fills in only when the rules came up short", async () => {
  const chat = async () => "1|DeepSeek;Flash;Tasks";
  const result = await extractEntities({
    text: "Use DeepSeek Flash for tasks",
    chat,
    minRuleEntities: 4,
  });
  assert.equal(result.from, "model");
  const names = result.entities.map((entry) => entry.surface.toLowerCase());
  assert.equal(new Set(names).size, names.length, "no surface appears twice");
  assert.ok(result.entities.every((entry) => entry.confidence === 0.9 || entry.confidence === 0.75));
});

test("a failed model call leaves the rules result standing", async () => {
  const chat = async () => {
    throw new Error("llama is down");
  };
  const result = await extractEntities({ text: "Use Qwen3 8B as main model", chat, minRuleEntities: 9 });
  assert.equal(result.from, "rules");
  assert.ok(result.entities.length >= 1);
});

test("a cached note never spends a second token", async () => {
  const cache = new Map();
  let calls = 0;
  const chat = async () => {
    calls += 1;
    return "1|DeepSeek;Flash;Tasks";
  };
  const text = "Use DeepSeek Flash for tasks";
  await extractEntities({ text, chat, cache, minRuleEntities: 4 });
  const second = await extractEntities({ text, chat, cache, minRuleEntities: 4 });
  assert.equal(second.from, "cache");
  assert.equal(calls, 1);
  assert.equal(hashText(text), second.hash);
});

test("one bad batch falls back to one call per note instead of losing the batch", async () => {
  let calls = 0;
  const chat = async () => {
    calls += 1;
    return "N|nothing";
  };
  const results = await extractBatch({ texts: ["alpha one", "beta two"], chat });
  assert.equal(results.length, 2);
  assert.equal(calls, 3, "one batch attempt plus one per note");
});

test("a good batch is used as is", async () => {
  let calls = 0;
  const chat = async () => {
    calls += 1;
    return "1|alpha\n2|beta";
  };
  const results = await extractBatch({ texts: ["note one", "note two"], chat });
  assert.equal(calls, 1);
  assert.equal(results[0].from, "batch");
  assert.equal(results[0].entities[0].surface, "alpha");
});
