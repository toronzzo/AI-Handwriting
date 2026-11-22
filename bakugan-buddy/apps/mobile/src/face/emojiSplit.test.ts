/**
 * Sticker splitting. The Lottie files stay out of this test.
 */
/// <reference types="node" />
import assert from "node:assert/strict";
import test from "node:test";
import { EMOJI_STICKERS } from "./emojiCatalog.ts";
import { splitStickers } from "./emojiSplit.ts";

test("the curated set is a dozen stickers with unique codepoints", () => {
  assert.equal(EMOJI_STICKERS.length, 12);
  const codes = new Set(EMOJI_STICKERS.map((sticker) => sticker.code));
  assert.equal(codes.size, 12);
});

test("a line splits into words and the stickers we can animate", () => {
  const parts = splitStickers("Say now 😂 partner");
  assert.deepEqual(parts, [
    { kind: "text", value: "Say now " },
    { kind: "sticker", code: "1f602", emoji: "😂" },
    { kind: "text", value: " partner" },
  ]);
});

test("a heart with or without the variation selector is the same sticker", () => {
  assert.equal(splitStickers("❤️")[0]?.kind, "sticker");
  assert.equal(splitStickers("❤")[0]?.kind, "sticker");
  const heart = splitStickers("love ❤️");
  assert.equal(heart[1]?.kind, "sticker");
  if (heart[1]?.kind === "sticker") assert.equal(heart[1].code, "2764");
});

test("emoji outside the set stay in the text", () => {
  const parts = splitStickers("hi 🐸 there");
  assert.equal(parts.length, 1);
  assert.equal(parts[0]?.kind, "text");
  if (parts[0]?.kind === "text") assert.match(parts[0].value, /🐸/);
});

test("adjacent stickers do not grow a text gap", () => {
  const parts = splitStickers("🔥🎉");
  assert.deepEqual(
    parts.map((part) => part.kind),
    ["sticker", "sticker"],
  );
});

test("a line with no emoji is one text part", () => {
  assert.deepEqual(splitStickers("just words"), [{ kind: "text", value: "just words" }]);
  assert.deepEqual(splitStickers(""), [{ kind: "text", value: "" }]);
});
