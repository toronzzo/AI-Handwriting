import assert from "node:assert/strict";
import test from "node:test";
import {
  ALL_ENTITY_TYPES,
  CONFIDENCE,
  DISABLED_ENTITY_TYPES,
  ENTITY_TYPES,
  clampConfidence,
  edgeDashed,
  entityNode,
  recordNode,
  typeForNoteKind,
  validateEdge,
  validateNode,
} from "./schema.mjs";

const source = { kind: "note", id: "note-1" };

test("every note kind already names its ontology type", () => {
  assert.equal(typeForNoteKind("todo"), "promise");
  assert.equal(typeForNoteKind("decision"), "decision");
  assert.equal(typeForNoteKind("idea"), "project");
  assert.equal(typeForNoteKind("fact"), "thing");
  assert.equal(typeForNoteKind("deadline"), "moment");
});

test("an unknown or missing kind falls back to thing, never to a crash", () => {
  assert.equal(typeForNoteKind("gossip"), "thing");
  assert.equal(typeForNoteKind(undefined), "thing");
  assert.equal(typeForNoteKind("  TODO "), "promise");
});

test("money and place stay declared but out of the active set", () => {
  assert.ok(ENTITY_TYPES.includes("person"));
  assert.ok(!ENTITY_TYPES.includes("money"));
  assert.deepEqual(DISABLED_ENTITY_TYPES, ["money", "place"]);
  assert.ok(ALL_ENTITY_TYPES.includes("money"));
  assert.ok(ALL_ENTITY_TYPES.includes("person"));
});

test("a node keeps its provenance and defaults its alias list", () => {
  const node = validateNode({ id: "n1", kind: "entity", type: "thing", label: "  Qwen3   8B ", source, at: 12 });
  assert.deepEqual(node.aliases, []);
  assert.equal(node.label, "Qwen3 8B");
  assert.deepEqual(node.source, source);
  assert.equal(node.at, 12);
  assert.equal(node.confidence, 1);
});

test("confidence is clamped into 0..1", () => {
  assert.equal(clampConfidence(1.5), 1);
  assert.equal(clampConfidence(-2), 0);
  assert.equal(clampConfidence("nope"), 0);
  const node = validateNode({ id: "n1", kind: "entity", type: "thing", source, confidence: 4 });
  assert.equal(node.confidence, 1);
});

test("a node without a source is refused", () => {
  assert.throws(() => validateNode({ id: "n1", kind: "entity", type: "thing" }), /source/);
  assert.throws(() => validateNode({ id: "n1", kind: "record", type: "thing", source }), /not allowed/);
  assert.throws(() => validateNode({ id: "", kind: "entity", type: "thing", source }), /required/);
});

test("an edge must say why it exists", () => {
  assert.throws(
    () => validateEdge({ from: "a", to: "b", relation: "mentions", source }),
    /why/,
  );
  assert.throws(
    () => validateEdge({ from: "a", to: "a", relation: "mentions", why: "self", source }),
    /itself/,
  );
  const edge = validateEdge({
    from: "a",
    to: "b",
    relation: "mentions",
    why: "rule:proper",
    source,
    at: 5,
  });
  assert.equal(edge.confidence, CONFIDENCE.RULE);
  assert.equal(edge.why, "rule:proper");
  assert.equal(edge.at, 5);
});

test("a shaky edge is drawn dashed, a sure one solid", () => {
  assert.equal(edgeDashed(0.59), true);
  assert.equal(edgeDashed(0.6), false);
  assert.equal(edgeDashed(1), false);
  assert.equal(edgeDashed(undefined), true);
});

test("record and entity helpers build validated nodes", () => {
  const record = recordNode({ id: "r1", type: "note", text: "Use Qwen3 8B as main model", at: 3, source });
  assert.equal(record.kind, "record");
  assert.equal(record.type, "note");
  assert.equal(record.at, 3);

  const entity = entityNode({ id: "e1", type: "thing", label: "Qwen3 8B", source, at: 4 });
  assert.equal(entity.kind, "entity");
  assert.equal(entity.type, "thing");

  assert.throws(() => entityNode({ id: "e2", type: "money", label: "1500", source }), /not active/);
});
