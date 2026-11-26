import assert from "node:assert/strict";
import test from "node:test";
import {
  aliasKey,
  editDistance,
  findEntity,
  foldPlural,
  mergeNodes,
  normalizeSurface,
} from "./resolve.mjs";

test("surfaces are trimmed and collapsed without losing their case", () => {
  assert.equal(normalizeSurface('  "Hello   World"  '), "Hello World");
  assert.equal(normalizeSurface("Qwen3 8B, "), "Qwen3 8B");
});

test("a name is never turned into a plural stem", () => {
  // The first pass folded every trailing s: Preyas became preya.
  assert.equal(aliasKey("Preyas"), "preyas");
  assert.equal(foldPlural("Preyas"), "Preyas");
  assert.equal(aliasKey("Kimi"), "kimi");
});

test("a known plural still folds, in either case", () => {
  assert.equal(aliasKey("flashcards"), "flashcard");
  assert.equal(aliasKey("models"), "model");
  // Keys are lowercased before folding, so "Models" and "models" must agree.
  // Names stay safe because the allowlist has no singular for them, not
  // because of their case: foldPlural("Preyas") is checked above.
  assert.equal(aliasKey("Models"), "model");
});

test("an unknown lowercase word ending in s is left alone", () => {
  assert.equal(foldPlural("bakugans"), "bakugans");
  assert.equal(foldPlural("glass"), "glass");
});

test("edit distance bails out once it cannot come under the cap", () => {
  assert.equal(editDistance("deepseek", "deepseek"), 0);
  assert.equal(editDistance("deepseek", "deepsek"), 1);
  assert.equal(editDistance("nasa", "nada"), 1);
  assert.ok(editDistance("nasa", "a-very-long-name", 2) > 2);
});

test("an exact alias wins", () => {
  const nodes = [{ id: "e1", label: "Qwen3", aliases: ["Qwen3 8B"] }];
  const found = findEntity(nodes, "qwen3");
  assert.equal(found.node.id, "e1");
  assert.equal(found.match, "exact");
  assert.equal(findEntity(nodes, "Qwen3 8B").node.id, "e1");
});

test("a near miss of five characters or more is a fuzzy match", () => {
  const nodes = [{ id: "e1", label: "deepseek", aliases: [] }];
  const found = findEntity(nodes, "deepsek");
  assert.equal(found.match, "fuzzy");
  assert.equal(found.distance, 1);
});

test("short names are never fuzzy-matched", () => {
  const nodes = [{ id: "e1", label: "NASA", aliases: [] }];
  assert.equal(findEntity(nodes, "NADA"), null);
  assert.equal(findEntity(nodes, "unrelated word"), null);
});

test("a merge keeps the older node, carries both labels and writes an audit row", () => {
  const a = { id: "a", label: "Preyas", aliases: [], at: 100, confidence: 0.5, props: { colour: "blue" } };
  const b = { id: "b", label: "preyas", aliases: ["Pre"], at: 50, confidence: 0.9, props: { mood: "calm" } };
  const { node, audit, merged } = mergeNodes(a, b, 999);

  assert.equal(node.id, "b", "the older node survives");
  assert.equal(node.at, 50);
  assert.equal(node.confidence, 0.9);
  assert.deepEqual(node.props, { mood: "calm", colour: "blue" });
  assert.ok(node.aliases.includes("Preyas"));
  assert.ok(node.aliases.includes("preyas"));
  assert.ok(node.aliases.includes("Pre"));

  assert.equal(audit.op, "merge");
  assert.equal(audit.keep, "b");
  assert.equal(audit.drop, "a");
  assert.equal(audit.at, 999);
  assert.deepEqual(merged, ["b", "a"]);
});

test("a merge never mutates the nodes it was given", () => {
  const a = { id: "a", label: "Qwen3", aliases: [], at: 1, confidence: 1, props: {} };
  const b = { id: "b", label: "Qwen3 8B", aliases: [], at: 2, confidence: 1, props: {} };
  mergeNodes(a, b, 0);
  assert.deepEqual(a.aliases, []);
  assert.equal(b.aliases.length, 0);
});
