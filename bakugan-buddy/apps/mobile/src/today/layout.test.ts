/// <reference types="node" />
import assert from "node:assert/strict";
import test from "node:test";
import { todayColumns } from "../layout.ts";

/**
 * The Today dashboard's column count at the real window sizes the user runs:
 * the 72 px Mac rail is subtracted first, so the layout is checked at the
 * width the content actually gets. Pure function checks, no React.
 */
test("three columns at 1280 and 1440 windows (minus the 72px rail)", () => {
  assert.equal(todayColumns(1280 - 72), 3); // 1208
  assert.equal(todayColumns(1440 - 72), 3); // 1368
});

test("two columns at a 900 window (minus the 72px rail)", () => {
  assert.equal(todayColumns(900 - 72), 2); // 828
});

test("one column on a phone", () => {
  assert.equal(todayColumns(390), 1);
});
