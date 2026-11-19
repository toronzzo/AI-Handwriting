/// <reference types="node" />
import assert from "node:assert/strict";
import test from "node:test";
import { FILL_SHARE, fitScale } from "./fitScale.ts";

/** A 24 pixel sprite, the real Preyas size. */
const SIZE = 24;

test("a tall stage gives the whole-number scale that fills about 60% of its height", () => {
  // 300 x 214-ish stage: 214 * 0.6 = 128.4 -> 128 / 24 = 5.35 -> 5
  assert.equal(fitScale(214, 300, SIZE), 5);
  // 5 * 24 = 120 pixels tall, about 56% of 214
  assert.ok((5 * SIZE) / 214 >= FILL_SHARE - 0.1);
});

test("the result is always a whole number and always fits the box", () => {
  for (const height of [100, 137, 200, 240, 320, 480]) {
    for (const width of [90, 160, 300, 480, 760]) {
      const scale = fitScale(height, width, SIZE);
      assert.equal(Number.isInteger(scale), true, `${height}x${width} gave ${scale}`);
      assert.ok(scale >= 1, `${height}x${width} gave ${scale}`);
      assert.ok(scale * SIZE <= width, `${height}x${width} is too narrow for ${scale}`);
      assert.ok(scale * SIZE <= height, `${height}x${width} is too short for ${scale}`);
    }
  }
});

test("a narrow box limits the scale even when it is tall", () => {
  // 400 tall wants 10, but 60 wide only fits 2.
  assert.equal(fitScale(400, 60, SIZE), 2);
});

test("tiny boxes still draw him at scale 1 rather than vanishing", () => {
  assert.equal(fitScale(10, 10, SIZE), 1);
  assert.equal(fitScale(24, 24, SIZE), 1);
});

test("a box that is not measured yet falls back to the given scale", () => {
  assert.equal(fitScale(0, 0, SIZE), 5);
  assert.equal(fitScale(0, 300, SIZE, 4), 4);
  assert.equal(fitScale(Number.NaN, 300, SIZE, 6), 6);
  assert.equal(fitScale(200, Number.NaN, SIZE, 3), 3);
  // A measured box ignores the fallback, even a nonsense one.
  assert.equal(fitScale(200, 300, SIZE, 0), 5);
});

test("a nonsense sprite size never divides by zero", () => {
  assert.equal(fitScale(300, 400, 0), 1);
  assert.equal(fitScale(300, 400, Number.NaN), 1);
  assert.equal(fitScale(300, 400, -24), 1);
});
