/// <reference types="node" />
import assert from "node:assert/strict";
import test from "node:test";
import {
  BIT_PALETTE,
  TRANSPARENT,
  bitColour,
  bitHex,
  bitIndexAtDigit,
} from "./bitPalette.ts";

/** "#rrggbb", lower or upper case, nothing else. */
const HEX = /^#[0-9a-fA-F]{6}$/;
/** The red family we refuse to put in the 8-bit look. */
const RED = /^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/;
const isRedFamily = (hex: string): boolean => {
  const match = RED.exec(hex);
  if (!match) return false;
  const r = Number.parseInt(match[1], 16);
  const g = Number.parseInt(match[2], 16);
  const b = Number.parseInt(match[3], 16);
  return r > 200 && g < 80 && b < 80;
};

test("the 8-bit palette has exactly 16 entries and index 0 is transparent", () => {
  assert.equal(BIT_PALETTE.length, 16);
  const first = BIT_PALETTE[TRANSPARENT];
  assert.ok(first);
  assert.equal(first.transparent, true);
  assert.equal(first.hex, null);
  assert.equal(bitColour(TRANSPARENT), null);
  BIT_PALETTE.forEach((entry, index) => assert.equal(entry.index, index));
});

test("every colour after the transparent slot is a valid #rrggbb and not red", () => {
  for (const entry of BIT_PALETTE.slice(1)) {
    assert.equal(entry.transparent, false, entry.name);
    assert.ok(entry.hex !== null, entry.name);
    assert.match(entry.hex, HEX, entry.name);
    assert.equal(isRedFamily(entry.hex), false, `${entry.name} is a red family: ${entry.hex}`);
    assert.equal(bitColour(entry.index), entry.hex);
  }
  // 15 real colours plus the transparent slot.
  assert.equal(BIT_PALETTE.filter((entry) => !entry.transparent).length, 15);
});

test("the palette covers the families the sprite needs", () => {
  const names = BIT_PALETTE.map((entry) => entry.name);
  for (const needed of [
    "transparent",
    "outline",
    "water",
    "aqua",
    "teal",
    "cream",
    "greyLight",
    "greyDark",
    "warmAccent",
  ]) {
    assert.ok(names.includes(needed), `missing ${needed}`);
  }
});

test("bitIndexAtDigit reads 0-f and rejects anything else", () => {
  assert.equal(bitIndexAtDigit("0"), 0);
  assert.equal(bitIndexAtDigit("a"), 10);
  assert.equal(bitIndexAtDigit("F"), 15);
  assert.equal(bitIndexAtDigit("g"), -1);
  assert.equal(bitIndexAtDigit(""), -1);
  assert.equal(bitIndexAtDigit("10"), -1);
});

test("bitHex knows the named colours and refuses the transparent slot", () => {
  assert.equal(bitHex("aqua"), BIT_PALETTE[5].hex);
  assert.equal(bitHex("cream"), BIT_PALETTE[11].hex);
  assert.throws(() => bitHex("transparent"));
});
