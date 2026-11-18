/// <reference types="node" />
import assert from "node:assert/strict";
import test from "node:test";
import { DAY, NIGHT, isNight } from "./palette.ts";

/** 06:00-18:59 is day, 19:00-05:59 is night. All dates are local time. */
test("isNight flips at 06:00 and 19:00", () => {
  assert.equal(isNight(new Date(2024, 0, 15, 5, 59)), true);
  assert.equal(isNight(new Date(2024, 0, 15, 6, 0)), false);
  assert.equal(isNight(new Date(2024, 0, 15, 18, 59)), false);
  assert.equal(isNight(new Date(2024, 0, 15, 19, 0)), true);
  assert.equal(isNight(new Date(2024, 0, 15, 0, 0)), true);
});

/** WCAG 2.x relative luminance for a #RRGGBB colour. */
function luminance(hex: string): number {
  const value = parseInt(hex.replace("#", ""), 16);
  const channels = [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

/** Contrast ratio between two #RRGGBB colours (order-independent). */
function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

const TEXT_COLOURS = ["text", "dim", "faint", "accentText", "danger", "note"] as const;
const PANELS = ["card", "cardSoft"] as const;

for (const [label, palette] of [
  ["day", DAY],
  ["night", NIGHT],
] as const) {
  for (const colour of TEXT_COLOURS) {
    for (const panel of PANELS) {
      test(`${label}: ${colour} on ${panel} meets WCAG AA`, () => {
        const ratio = contrast(palette[colour], palette[panel]);
        assert.ok(ratio >= 4.5, `expected >= 4.5, got ${ratio.toFixed(3)}`);
      });
    }
  }

  test(`${label}: onAccent on accent meets WCAG AA`, () => {
    const ratio = contrast(palette.onAccent, palette.accent);
    assert.ok(ratio >= 4.5, `expected >= 4.5, got ${ratio.toFixed(3)}`);
  });
}

/** Every palette key that the contrast tests rely on is a hex colour. */
const HEX_COLOURS = ["text", "dim", "faint", "accentText", "accent", "onAccent", "card", "cardSoft", "note"] as const;

test("contrast-checked colours are plain hex", () => {
  for (const palette of [DAY, NIGHT]) {
    for (const key of HEX_COLOURS) {
      assert.match(palette[key], /^#[0-9A-Fa-f]{6}$/);
    }
  }
});
