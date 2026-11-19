/// <reference types="node" />
import assert from "node:assert/strict";
import test from "node:test";
import { chatColumn, isPhone, isWide, listWidth, todayColumns } from "./layout.ts";
import { theme } from "./theme.ts";

test("the Mac layout starts at 900px", () => {
  assert.equal(isWide(899), false);
  assert.equal(isWide(900), true);
  assert.equal(isWide(1440), true);
});

test("an iPhone is phone-sized in portrait and landscape", () => {
  assert.equal(isPhone(390, 844), true);
  assert.equal(isPhone(844, 390), true);
  assert.equal(isPhone(1024, 768), false);
});

test("the chat column never grows past the reading width", () => {
  assert.deepEqual(chatColumn(1600), { maxWidth: theme.size.maxChat, width: "100%" });
  assert.equal(chatColumn(320).maxWidth, 320);
});

test("the chats list only shows on a Mac with room to spare", () => {
  assert.equal(listWidth(1400, true), theme.size.list);
  assert.equal(listWidth(390, true), 0);
  assert.equal(listWidth(1400, false), 0);
});

test("the Today dashboard uses three columns from 1100px, two from 700px", () => {
  assert.equal(todayColumns(1099), 2);
  assert.equal(todayColumns(1100), 3);
  assert.equal(todayColumns(1440), 3);
  assert.equal(todayColumns(699), 1);
  assert.equal(todayColumns(700), 2);
  assert.equal(todayColumns(900), 2);
  assert.equal(todayColumns(390), 1);
});

test("every shell size is a whole number of pixels", () => {
  for (const value of Object.values(theme.size)) assert.ok(Number.isInteger(value) && value > 0);
  for (const value of Object.values(theme.space)) assert.equal(value % 4, 0);
});
