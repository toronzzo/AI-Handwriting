/// <reference types="node" />
import assert from "node:assert/strict";
import test from "node:test";
import { radarPoints } from "./radarGeometry.ts";

const CX = 200;
const CY = 200;
const RADIUS = 160;

test("six values of 10 make a regular hexagon around the centre", () => {
  const points = radarPoints([10, 10, 10, 10, 10, 10], CX, CY, RADIUS);
  assert.equal(points.length, 6);

  // Every corner sits on the outer ring.
  for (const point of points) {
    const distance = Math.hypot(point.x - CX, point.y - CY);
    assert.ok(
      Math.abs(distance - RADIUS) < 1e-9,
      `corner distance ${distance} should be ${RADIUS}`,
    );
  }

  // A regular hexagon: every edge has the same length.
  const edge = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    Math.hypot(b.x - a.x, b.y - a.y);
  const first = edge(points[0], points[1]);
  for (let i = 1; i < points.length; i++) {
    const next = edge(points[i], points[(i + 1) % points.length]);
    assert.ok(Math.abs(next - first) < 1e-9, `edge ${i} differs from the first`);
  }
});

test("all zero values collapse onto the centre point", () => {
  const points = radarPoints([0, 0, 0, 0, 0, 0], 100, 50, 90);
  for (const point of points) {
    assert.equal(point.x, 100);
    assert.equal(point.y, 50);
  }
});

test("the first axis points straight up", () => {
  const points = radarPoints([10, 0, 0, 0, 0, 0], CX, CY, RADIUS);
  assert.ok(Math.abs(points[0].x - CX) < 1e-9);
  assert.ok(Math.abs(points[0].y - (CY - RADIUS)) < 1e-9);
});
