/// <reference types="node" />
import assert from "node:assert/strict";
import test from "node:test";
import { todayColumns, todaySplit } from "../layout.ts";

/**
 * The Today dashboard's riso page split at the real window sizes the user
 * runs: the 72 px Mac rail is subtracted first, so the layout is checked at
 * the width the content actually gets. Two asymmetric columns (38% journal
 * column, 62% content column) from 700 px, stacked below. Pure function
 * checks, no React.
 */
test("asymmetric two columns at 1280 and 1440 windows (minus the 72px rail)", () => {
  assert.equal(todayColumns(1280 - 72), 2); // 1208
  assert.equal(todayColumns(1440 - 72), 2); // 1368
  assert.deepEqual(todaySplit(1440 - 72), { leftPct: 38, rightPct: 62 });
});

test("asymmetric two columns at a 900 window (minus the 72px rail)", () => {
  assert.equal(todayColumns(900 - 72), 2); // 828
  assert.deepEqual(todaySplit(900 - 72), { leftPct: 38, rightPct: 62 });
});

test("one column on a phone", () => {
  assert.equal(todayColumns(390), 1);
  assert.equal(todaySplit(390), null);
});
