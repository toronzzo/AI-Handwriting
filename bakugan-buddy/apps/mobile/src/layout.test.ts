/// <reference types="node" />
import assert from "node:assert/strict";
import test from "node:test";
import {
  chatColumn,
  isPhone,
  isWide,
  listWidth,
  PAGE_MAX,
  pageColumn,
  pageGridColumns,
  ROOT_ATTR,
  SETTINGS_PROBE_MS,
  SHELL_ATTR,
  STAGE_ATTR,
  todayColumns,
  WEB_SHELL_CSS,
} from "./layout.ts";
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

test("the browser shell can shrink to the window, so the rail keeps Settings", () => {
  // A flex item defaults to min-height auto, which lets a long Memory list
  // stretch the page and push the rail's Settings button out of view.
  assert.match(WEB_SHELL_CSS, /\[data-shell\], \[data-stage\] \{ min-height: 0; overflow: hidden; \}/);
  // The page itself must not be taller than the window either.
  assert.match(WEB_SHELL_CSS, /#root \{ min-height: auto; \}/);
  assert.match(WEB_SHELL_CSS, /html, body, #root \{ height: 100%; overflow: hidden; \}/);
  // The root keeps the window floor, so a wide window is still filled.
  assert.match(WEB_SHELL_CSS, /\[data-root\] \{ min-height: max\(100%, 100vh\); \}/);
  assert.notEqual(new Set([SHELL_ATTR, STAGE_ATTR, ROOT_ATTR]).size, 1);
  for (const attr of [SHELL_ATTR, STAGE_ATTR, ROOT_ATTR]) {
    assert.match(attr, /^data-[a-z]+$/);
    assert.ok(WEB_SHELL_CSS.includes("[" + attr + "]"));
  }
});

test("every shell size is a whole number of pixels", () => {
  for (const value of Object.values(theme.size)) assert.ok(Number.isInteger(value) && value > 0);
  for (const value of Object.values(theme.space)) assert.equal(value % 4, 0);
});

test("Learn and Memory content is capped near 900px on a desktop window", () => {
  assert.equal(PAGE_MAX, 900);
  assert.deepEqual(pageColumn(1440), { maxWidth: 900, width: "100%", alignSelf: "center" });
  assert.deepEqual(pageColumn(390), { maxWidth: 390, width: "100%", alignSelf: "center" });
  assert.equal(pageGridColumns(1440), 2);
  assert.equal(pageGridColumns(390), 1);
});

test("settings status probes stay bounded", () => {
  assert.ok(SETTINGS_PROBE_MS >= 2_000 && SETTINGS_PROBE_MS <= 10_000);
});

test("phone and desktop widths stay distinct for the polish pass", () => {
  assert.equal(isPhone(390, 844), true);
  assert.equal(isWide(1440), true);
  assert.equal(chatColumn(1440).maxWidth, theme.size.maxChat);
});
