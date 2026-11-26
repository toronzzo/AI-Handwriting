import assert from "node:assert/strict";
import test from "node:test";
import { createGraph } from "./graph.mjs";

const DAY = 86_400_000;
const now = 1_700_000_000_000;

const nodes = [
  { id: "n1", kind: "record", type: "note", label: "Qwen3 decision", at: now - 40 * DAY },
  { id: "n2", kind: "entity", type: "thing", label: "Qwen3 8B", at: now - 20 * DAY },
  { id: "n3", kind: "entity", type: "project", label: "Preyas", at: now - 3_600_000 },
  { id: "n4", kind: "entity", type: "promise", label: "Teach GitHub", at: now - 60 * DAY },
  { id: "n5", kind: "record", type: "note", label: "Loose note", at: now - 90 * DAY },
];

const edges = [
  { from: "n1", to: "n2", relation: "mentions", confidence: 1, why: "rule:proper", at: now - 2 * DAY },
  { from: "n2", to: "n3", relation: "relates", confidence: 0.9, why: "shared topic", at: now - 40 * DAY },
  { from: "n1", to: "n4", relation: "mentions", confidence: 0.4, why: "rule:phrase", at: now - 200 * DAY },
];

test("neighbours come back one hop at a time", () => {
  const graph = createGraph({ nodes, edges });
  const one = graph.neighbors("n1").map((entry) => entry.node.id);
  assert.deepEqual(one.sort(), ["n2", "n4"]);
  const two = graph.neighbors("n1", { depth: 2 }).map((entry) => entry.node.id);
  assert.deepEqual(two.sort(), ["n2", "n3", "n4"]);
});

test("a walk never returns the same node twice", () => {
  const graph = createGraph({ nodes, edges });
  const ids = graph.neighbors("n1", { depth: 4 }).map((entry) => entry.node.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("edges can be filtered by relation", () => {
  const graph = createGraph({ nodes, edges });
  const related = graph.neighbors("n2", { relations: ["relates"] }).map((entry) => entry.node.id);
  assert.deepEqual(related, ["n3"]);
});

test("a walk from a node that is not on the map is empty, not an error", () => {
  const graph = createGraph({ nodes, edges });
  assert.deepEqual(graph.neighbors("ghost"), []);
  assert.equal(graph.node("ghost"), null);
});

test("an edge pointing at a missing node is dropped rather than inventing an end", () => {
  const graph = createGraph({
    nodes: [nodes[0]],
    edges: [...edges, { from: "n1", to: "ghost", relation: "mentions", confidence: 1, why: "bad", at: now }],
  });
  assert.equal(graph.edges().length, 0);
  assert.equal(graph.degree("n1"), 0);
});

test("the shortest path comes back inclusive", () => {
  const graph = createGraph({ nodes, edges });
  assert.deepEqual(graph.path("n1", "n3"), ["n1", "n2", "n3"]);
  assert.deepEqual(graph.path("n1", "n1"), ["n1"]);
});

test("disconnected or unknown ends have no path", () => {
  const graph = createGraph({ nodes, edges });
  assert.deepEqual(graph.path("n1", "n5"), []);
  assert.deepEqual(graph.path("n1", "ghost"), []);
});

test("the timeline is the evidence behind a node, oldest first", () => {
  const graph = createGraph({ nodes, edges });
  const rows = graph.timeline("n1");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].other.id, "n4");
  assert.equal(rows[1].other.id, "n2");
  assert.equal(rows[1].why, "rule:proper");
});

test("heat reads how recently a node moved", () => {
  const graph = createGraph({ nodes, edges });
  assert.equal(graph.heat("n1", now), 2);
  assert.equal(graph.heat("n3", now), 3);
  assert.equal(graph.heat("n5", now), 0);
});

test("staleSince finds the nodes that have gone quiet", () => {
  const graph = createGraph({ nodes, edges });
  const stale = graph.staleSince(now - 30 * DAY).map((entry) => entry.id);
  assert.deepEqual(stale, ["n4", "n5"]);
});

test("orphans are the loose notes with no thread yet", () => {
  const graph = createGraph({ nodes, edges });
  assert.deepEqual(graph.orphans().map((entry) => entry.id), ["n5"]);
});

test("stats add up honestly, including the dashed share", () => {
  const graph = createGraph({ nodes, edges });
  const stats = graph.stats();
  assert.equal(stats.nodes, 5);
  assert.equal(stats.edges, 3);
  assert.equal(stats.orphans, 1);
  assert.equal(stats.orphanShare, 0.2);
  assert.equal(stats.avgDegree, 1.2);
  assert.equal(stats.dashed, 1);
  assert.deepEqual(stats.byKind, { record: 2, entity: 3 });
});

test("a subgraph is the seed, its neighbourhood and the edges between them", () => {
  const graph = createGraph({ nodes, edges });
  const slice = graph.subgraph("n2", { depth: 1 });
  assert.equal(slice.nodes.length, 3);
  assert.equal(slice.edges.length, 2);
  assert.deepEqual(graph.subgraph("ghost"), { nodes: [], edges: [] });
});
