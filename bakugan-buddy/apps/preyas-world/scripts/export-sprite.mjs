#!/usr/bin/env node
/**
 * Export the 24x24 pixel Preyas into data/preyas-sprite.json for the Godot
 * desktop pet (Preyas World).
 *
 * The art comes straight from the mobile app's sources — it reads
 * apps/mobile/src/bits/preyasSprite.ts and bitPalette.ts (plus the canonical
 * mood order from packages/mood). No new art is drawn and no other art is
 * copied. Godot builds its textures from this JSON at startup.
 *
 * Run from anywhere; paths resolve relative to this file:
 *   node scripts/export-sprite.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const buddyRoot = resolve(here, "../../.."); // bakugan-buddy
const spritePath = join(buddyRoot, "apps/mobile/src/bits/preyasSprite.ts");
const palettePath = join(buddyRoot, "apps/mobile/src/bits/bitPalette.ts");
const moodPath = join(buddyRoot, "packages/mood/src/index.ts");

/** Where the Godot project picks the art up. */
export const SPRITE_JSON_PATH = join(here, "../data/preyas-sprite.json");

/**
 * Pull one JS object/array literal out of a TypeScript source file by its
 * anchor name and parse it as JSON. The literals we read are pure data:
 * string rows made of hex digits, palette entries, and a mood name list —
 * so key-quoting plus a brace scan is enough (no TS parser needed).
 */
function extractLiteral(source, anchor, openChar) {
  const anchorAt = source.indexOf(anchor);
  if (anchorAt === -1) throw new Error(`missing "${anchor}" in ${source}`);
  const openAt = source.indexOf(openChar, source.indexOf("=", anchorAt));
  if (openAt === -1) throw new Error(`missing "${openChar}" after "${anchor}"`);
  const closeChar = openChar === "{" ? "}" : "]";
  let depth = 0;
  for (let i = openAt; i < source.length; i++) {
    const ch = source[i];
    if (ch === openChar) depth += 1;
    else if (ch === closeChar) {
      depth -= 1;
      if (depth === 0) {
        const literal = source.slice(openAt, i + 1);
        // Quote unquoted object keys and drop trailing commas so JSON.parse
        // accepts the literal. Safe here: our data strings never contain
        // braces, brackets or commas.
        const json = literal
          .replace(/([{,]\s*)([A-Za-z_$][\w$]*)(\s*:)/g, '$1"$2"$3')
          .replace(/,\s*([}\]])/g, "$1");
        return JSON.parse(json);
      }
    }
  }
  throw new Error(`unbalanced "${openChar}" after "${anchor}"`);
}

/** Validate one 24x24 frame (24 rows of 24 hex digits) with a clear error. */
function checkFrame(mood, frameIndex, frame) {
  if (!Array.isArray(frame) || frame.length !== 24) {
    throw new Error(`mood ${mood} frame ${frameIndex}: expected 24 rows, got ${Array.isArray(frame) ? frame.length : "not a list"}`);
  }
  for (const row of frame) {
    if (typeof row !== "string" || row.length !== 24) {
      throw new Error(`mood ${mood} frame ${frameIndex}: row must be a 24-char string`);
    }
    for (const digit of row) {
      if (!/^[0-9a-f]$/.test(digit)) {
        throw new Error(`mood ${mood} frame ${frameIndex}: bad digit "${digit}"`);
      }
    }
  }
}

/**
 * Build the export object fresh from the TypeScript sources. Exported for the
 * node test, which compares this against the very same modules.
 */
export function buildSpriteJSON() {
  const spriteSource = readFileSync(spritePath, "utf8");
  const paletteSource = readFileSync(palettePath, "utf8");
  const moodSource = readFileSync(moodPath, "utf8");

  const moodOrder = extractLiteral(moodSource, "CANONICAL_MOODS", "[");
  const frames = extractLiteral(spriteSource, "MOOD_FRAMES", "{");
  const palette = extractLiteral(paletteSource, "BIT_PALETTE", "[");

  if (!Array.isArray(moodOrder) || moodOrder.length !== 9) {
    throw new Error(`expected 9 canonical moods, got ${moodOrder.length}`);
  }
  if (palette.length !== 16) throw new Error(`expected 16 palette entries, got ${palette.length}`);

  for (const mood of moodOrder) {
    const pair = frames[mood];
    if (!Array.isArray(pair) || pair.length !== 2) {
      throw new Error(`mood ${mood}: expected 2 frames`);
    }
    checkFrame(mood, 0, pair[0]);
    checkFrame(mood, 1, pair[1]);
  }

  return {
    size: 24,
    moodOrder,
    palette,
    frames: Object.fromEntries(moodOrder.map((mood) => [mood, frames[mood]])),
  };
}

const invokedAsMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsMain) {
  const json = buildSpriteJSON();
  mkdirSync(dirname(SPRITE_JSON_PATH), { recursive: true });
  writeFileSync(SPRITE_JSON_PATH, JSON.stringify(json, null, 2) + "\n");
  console.log(`wrote ${SPRITE_JSON_PATH} (${json.moodOrder.length} moods, 18 frames, 16 palette entries)`);
}
