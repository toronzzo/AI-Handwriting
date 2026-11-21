/**
 * Brain view pure-logic tests: node placement and the status palette mapping.
 * Pure node with no react-native import, so it runs under `node --test`.
 */
/// <reference types="node" />
import assert from "node:assert/strict";
import test from "node:test";
import {
  BRAIN_CX,
  BRAIN_CY,
  BRAIN_RADIUS,
  brainRingPoints,
  STATUS_LABEL,
  STATUS_TOKEN,
} from "./brainGeometry.ts";
import { DEMO_BRAIN_MAP } from "./demoBrains.ts";
import type { BrainStatus } from "./types.ts";

test("the map has a core and exactly the six first brains", () => {
  assert.equal(DEMO_BRAIN_MAP.isDemo, true);
  assert.equal(DEMO_BRAIN_MAP.nodes.length, 6);
  assert.deepEqual(
    DEMO_BRAIN_MAP.nodes.map((node) => node.id),
    ["local-model", "paid-fallback", "free-provider", "router", "drawing", "memory"],
  );
});

test("every node carries a status, a hint and a description", () => {
  const all = [DEMO_BRAIN_MAP.core, ...DEMO_BRAIN_MAP.nodes];
  for (const node of all) {
    assert.ok(node.name.length > 0, node.id + " name");
    assert.ok(node.hint.length > 0, node.id + " hint");
    assert.ok(node.description.length > 20, node.id + " description");
    assert.ok(["online", "fallback", "planned", "unavailable"].includes(node.status), node.id + " status");
  }
});

test("every status maps to a theme token and a plain label", () => {
  const statuses: BrainStatus[] = ["online", "fallback", "planned", "unavailable"];
  for (const status of statuses) {
    assert.ok(STATUS_TOKEN[status] in { good: 1, accent: 1, off: 1, note: 1 }, status + " token");
    assert.ok(STATUS_LABEL[status].length > 0, status + " label");
  }
});

test("no status uses the danger (red) token", () => {
  for (const value of Object.values(STATUS_TOKEN)) {
    assert.notEqual(value, "danger");
  }
});

test("ring points sit on the radius around the centre, evenly spaced", () => {
  const points = brainRingPoints(6);
  assert.equal(points.length, 6);
  for (const p of points) {
    const dx = p.x - BRAIN_CX;
    const dy = p.y - BRAIN_CY;
    const dist = Math.hypot(dx, dy);
    assert.ok(Math.abs(dist - BRAIN_RADIUS) < 0.001, `node off the ring: ${dist}`);
  }
  // First point is straight up; the rest are 60 degrees apart going clockwise.
  assert.ok(Math.abs(points[0].x - BRAIN_CX) < 0.001);
  assert.ok(points[0].y < BRAIN_CY);
});

test("ring placement handles empty and one-node maps without error", () => {
  assert.deepEqual(brainRingPoints(0), []);
  assert.equal(brainRingPoints(1).length, 1);
});
