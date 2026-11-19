/// <reference types="node" />
import assert from "node:assert/strict";
import test from "node:test";
import {
  CAP_DEFAULT_USD,
  CAP_MAX_USD,
  CAP_MIN_USD,
  PRICE_SETUP_HINT,
  formatEstimate,
  formatUsd,
  parseUsd,
  spendRatio,
  todayLine,
  validateUsd,
} from "./dailyLimit.ts";

test("parseUsd: commas, spaces and plain numbers", () => {
  assert.equal(parseUsd("0,5"), 0.5);
  assert.equal(parseUsd(" 1.25 "), 1.25);
  assert.equal(parseUsd("2"), 2);
  assert.equal(parseUsd(".5"), 0.5);
  assert.equal(parseUsd(""), null);
  assert.equal(parseUsd("abc"), null);
  assert.equal(parseUsd("1.2.3"), null);
  assert.equal(parseUsd("-1"), -1);
});

test("validateUsd: bounds are $0.10 to $20.00", () => {
  assert.deepEqual(validateUsd(0.1), { ok: true, value: 0.1 });
  assert.deepEqual(validateUsd(1), { ok: true, value: 1 });
  assert.deepEqual(validateUsd(20), { ok: true, value: 20 });
  assert.equal(validateUsd(0.09).ok, false);
  assert.equal(validateUsd(20.01).ok, false);
  assert.equal(validateUsd(-1).ok, false);
  assert.equal(validateUsd(Number.NaN).ok, false);
  assert.equal(validateUsd(CAP_MIN_USD).ok, true);
  assert.equal(validateUsd(CAP_MAX_USD).ok, true);
  assert.equal(CAP_DEFAULT_USD, 1);
});

test("validateUsd: rounds to two decimals", () => {
  assert.deepEqual(validateUsd(0.555), { ok: true, value: 0.56 });
  assert.deepEqual(validateUsd(0.504), { ok: true, value: 0.5 });
});

test("formatUsd: always two decimals and never negative", () => {
  assert.equal(formatUsd(0.5), "$0.50");
  assert.equal(formatUsd(2), "$2.00");
  assert.equal(formatUsd(-1), "$0.00");
  assert.equal(formatUsd(Number.NaN), "$0.00");
});

test("formatEstimate: rough range, or the setup message when no price exists", () => {
  assert.equal(formatEstimate({ usdLow: 0.001, usdHigh: 0.006 }), "About $0.00 to $0.01. Rough estimate.");
  assert.equal(formatEstimate(null), PRICE_SETUP_HINT);
  assert.equal(formatEstimate({ usdHigh: 0.5 }), PRICE_SETUP_HINT);
  assert.match(PRICE_SETUP_HINT, /HARNESS_USD_PER_MTOK_IN/);
});

test("todayLine and spendRatio drive the row and the bar", () => {
  assert.equal(todayLine(0.5, 1), "Today: $0.50 of $1.00");
  assert.equal(spendRatio(0.5, 1), 0.5);
  assert.equal(spendRatio(2, 1), 1);
  assert.equal(spendRatio(0, 0), 0);
  assert.equal(spendRatio(-1, 1), 0);
  assert.equal(spendRatio(Number.NaN, 1), 0);
});
