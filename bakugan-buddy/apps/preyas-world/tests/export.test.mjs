/**
 * The exported data/preyas-sprite.json must match the mobile app's art
 * sources exactly. This test builds a fresh export and compares it against
 * the very TypeScript modules the app renders, and against the committed
 * JSON file.
 *
 * Run: node --experimental-strip-types --disable-warning=ExperimentalWarning --test tests/export.test.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { buildSpriteJSON, SPRITE_JSON_PATH } from "../scripts/export-sprite.mjs";
import { MOOD_FRAMES, PREYAS_BITS_SIZE, PREYAS_SPRITE } from "../../mobile/src/bits/preyasSprite.ts";
import { BIT_PALETTE } from "../../mobile/src/bits/bitPalette.ts";
import { validateSprite } from "../../mobile/src/bits/sprite.ts";
import { CANONICAL_MOODS } from "../../../packages/mood/src/index.ts";

test("exported JSON matches preyasSprite.ts and bitPalette.ts", () => {
  const json = buildSpriteJSON();

  assert.equal(json.size, PREYAS_BITS_SIZE);
  assert.deepEqual(json.moodOrder, [...CANONICAL_MOODS]);

  for (const mood of json.moodOrder) {
    assert.deepEqual(json.frames[mood][0], MOOD_FRAMES[mood][0], `${mood} frame 1`);
    assert.deepEqual(json.frames[mood][1], MOOD_FRAMES[mood][1], `${mood} frame 2`);
  }

  assert.deepEqual(
    json.palette,
    BIT_PALETTE.map(({ index, name, hex, transparent }) => ({ index, name, hex, transparent })),
  );
});

test("exported frames pass the app's own sprite validation", () => {
  const json = buildSpriteJSON();
  const allFrames = json.moodOrder.flatMap((mood) => json.frames[mood]);
  const check = validateSprite({ w: json.size, h: json.size, frames: allFrames });
  assert.equal(check.ok, true, check.errors.join("; "));
  // The app's PREYAS_SPRITE lists every "breath in" frame first, then every
  // "breath out" frame; the export stores them per mood. Same 18 frames.
  const appOrder = json.moodOrder.map((mood) => json.frames[mood][0]).concat(
    json.moodOrder.map((mood) => json.frames[mood][1]),
  );
  assert.equal(PREYAS_SPRITE.frames.length, appOrder.length);
  for (let i = 0; i < appOrder.length; i++) {
    assert.deepEqual(PREYAS_SPRITE.frames[i], appOrder[i], `frame ${i}`);
  }
});

test("the committed JSON file is the fresh export", () => {
  const json = buildSpriteJSON();
  const onDisk = JSON.parse(readFileSync(SPRITE_JSON_PATH, "utf8"));
  assert.deepEqual(onDisk, json);
});
