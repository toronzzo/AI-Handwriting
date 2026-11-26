import assert from "node:assert/strict";
import test from "node:test";
import { buildMap, labelOffset, radiusFor, seededLayout, shouldLabel } from "./layout.mjs";

const nodes = ["a", "b", "c", "d", "e", "f"].map((id) => ({ id }));
const edges = [
  { from: "a", to: "b", confidence: 0.9 },
  { from: "b", to: "c", confidence: 0.8 },
  { from: "c", to: "d", confidence: 0.7 },
  { from: "d", to: "e", confidence: 0.9 },
  { from: "e", to: "f", confidence: 0.6 },
];

test("the same graph always draws the same constellation", () => {
  const first = seededLayout(nodes, edges);
  const second = seededLayout(nodes, edges);
  assert.deepEqual(first, second);
});

test("every point lands inside the plate", () => {
  const pos = seededLayout(nodes, edges);
  for (const [, point] of pos) {
    assert.ok(point.x >= 0 && point.x <= 1, `x ${point.x}`);
    assert.ok(point.y >= 0 && point.y <= 1, `y ${point.y}`);
  }
});

test("no two discs sit on top of each other", () => {
  const pos = seededLayout(nodes, edges);
  const points = [...pos.values()];
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const distance = Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y);
      assert.ok(distance > 0.01, `two points ${distance.toFixed(4)} apart`);
    }
  }
});

test("an empty graph is an empty map, not a crash", () => {
  assert.equal(seededLayout([], []).size, 0);
  const single = seededLayout([{ id: "only" }], []);
  const point = single.get("only");
  assert.ok(point.x >= 0 && point.x <= 1);
});

test("disc size grows with degree and never leaves its bounds", () => {
  assert.equal(radiusFor(0), 34);
  assert.equal(radiusFor(1, { maxDegree: 4 }), 45);
  assert.equal(radiusFor(4, { maxDegree: 4 }), 56);
  assert.equal(radiusFor(99, { maxDegree: 4 }), 56);
  assert.ok(radiusFor(2, { maxDegree: 8 }) <= radiusFor(4, { maxDegree: 8 }));
});

test("only well-connected nodes get a printed label", () => {
  assert.equal(shouldLabel(2), false);
  assert.equal(shouldLabel(3), true);
  assert.equal(labelOffset(34), 46);
});

test("the drawable map marks shaky threads dashed and sure ones solid", () => {
  const map = buildMap({
    nodes: [
      { id: "a", kind: "entity", type: "thing", label: "A" },
      { id: "b", kind: "entity", type: "thing", label: "B" },
    ],
    edges: [{ from: "a", to: "b", relation: "mentions", confidence: 0.4 }],
  });
  assert.equal(map.nodes.length, 2);
  assert.equal(map.edges[0].dashed, true);

  const sure = buildMap({
    nodes: [
      { id: "a", kind: "entity", type: "thing", label: "A" },
      { id: "b", kind: "entity", type: "thing", label: "B" },
    ],
    edges: [{ from: "a", to: "b", relation: "mentions", confidence: 0.9 }],
  });
  assert.equal(sure.edges[0].dashed, false);
});
