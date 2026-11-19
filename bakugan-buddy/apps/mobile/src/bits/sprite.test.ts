/// <reference types="node" />
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CANONICAL_MOODS } from "../../../../packages/mood/src/index.ts";
import { BIT_PALETTE, bitIndexAtDigit } from "./bitPalette.ts";
import { MOOD_FRAMES, PREYAS_BITS_SIZE, PREYAS_SPRITE, moodFrames } from "./preyasSprite.ts";
import { validateSprite } from "./sprite.ts";

const SOURCE = readFileSync(join(process.cwd(), "src/bits/preyasSprite.ts"), "utf8");

test("the sprite is valid: 24x24, equal rows, only 0-f", () => {
  const check = validateSprite(PREYAS_SPRITE);
  assert.equal(check.ok, true, check.ok ? "" : check.errors.join("; "));
  assert.equal(PREYAS_SPRITE.w, PREYAS_BITS_SIZE);
  assert.equal(PREYAS_SPRITE.h, PREYAS_BITS_SIZE);
});

test("every canonical mood has two frames and no mood is missing", () => {
  assert.deepEqual([...CANONICAL_MOODS], [
    "neutral",
    "happy",
    "excited",
    "angry",
    "sad",
    "surprised",
    "thinking",
    "listening",
    "battle",
  ]);
  assert.equal(Object.keys(MOOD_FRAMES).length, CANONICAL_MOODS.length);
  for (const mood of CANONICAL_MOODS) {
    const frames = MOOD_FRAMES[mood];
    assert.ok(frames, `${mood} has no frames`);
    assert.equal(frames.length, 2, `${mood} must have exactly 2 frames`);
    for (const frame of frames) {
      assert.equal(frame.length, PREYAS_BITS_SIZE, `${mood} frame row count`);
      for (const row of frame) assert.equal(row.length, PREYAS_BITS_SIZE, `${mood} row width`);
    }
  }
  // 9 moods x 2 frames become 18 frames of one sprite.
  assert.equal(PREYAS_SPRITE.frames.length, CANONICAL_MOODS.length * 2);
  assert.deepEqual(moodFrames("neutral"), [0, CANONICAL_MOODS.length]);
  assert.deepEqual(moodFrames("not-a-mood"), [0, CANONICAL_MOODS.length]);
});

test("the two frames of a mood differ (the idle breath) and the art is not empty", () => {
  for (const mood of CANONICAL_MOODS) {
    const [first, second] = MOOD_FRAMES[mood];
    assert.notDeepEqual(first, second, `${mood} has two identical frames`);
    const usedRows = (frame: string[]) => frame.filter((row) => /[1-9a-f]/.test(row)).length;
    assert.ok(usedRows(first) >= 8, `${mood} is empty`);
  }
});

test("every frame draws a body, fins and an outline, using only palette digits", () => {
  for (const [mood, frames] of Object.entries(MOOD_FRAMES)) {
    for (const frame of frames) {
      const colours = new Set(frame.join("").split(""));
      assert.ok(colours.has("3"), `${mood} has no body colour`);
      assert.ok(colours.has("5"), `${mood} has no fin colour`);
      for (const digit of colours) assert.notEqual(bitIndexAtDigit(digit), -1, `${mood} has a bad digit ${digit}`);
    }
  }
});

test("only the palette is used; no colour literal is written in the art", () => {
  assert.equal(/#[0-9a-fA-F]{3,8}\b/.test(SOURCE), false, "preyasSprite.ts must not carry a hex colour");
  assert.equal(/#[0-9a-fA-F]{3,8}\b/.test(JSON.stringify(BIT_PALETTE)), true, "the palette holds the hex values");
});

test("Preyas has no face: the art has no eye or mouth marker", () => {
  // Word boundaries: the English word "eyes" must not appear anywhere, while
  // code words such as "key" are fine.
  assert.equal(/\beyes?\b/i.test(SOURCE), false, "no eyes: moods show through posture only");
  assert.equal(/\bmouths?\b/i.test(SOURCE), false, "no mouth: moods show through posture only");
  assert.equal(/\bfaces?\b/i.test(SOURCE), false, "no face marker");
});
