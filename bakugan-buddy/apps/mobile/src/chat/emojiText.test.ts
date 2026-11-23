/**
 * The chat shell has to keep emoji sequences in one font. This reads the
 * source, the same way the other UI rules do, and checks the cluster splitter.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { emojiClusters, splitEmojiRuns } from "../../../../packages/alive/src/emojiRuns.ts";

const root = process.cwd();
const chat = readFileSync(join(root, "src/screens/ChatScreen.tsx"), "utf8");
const theme = readFileSync(join(root, "src/installTheme.ts"), "utf8");
const text = readFileSync(join(root, "src/chat/emojiText.tsx"), "utf8");

test("chat bubbles and the composer use the emoji-safe text", () => {
  assert.match(chat, /import \{ CHAT_FONT_FAMILY, EmojiText \} from "\.\.\/chat\/emojiText"/);
  assert.match(chat, /<EmojiText style=\{\[styles\.bubbleText, mine && styles\.bubbleTextMine\]\}>\{message\.content\}<\/EmojiText>/);
  assert.match(chat, /<EmojiText style=\{styles\.bubbleText\}>\{live\.text\}<\/EmojiText>/);
  assert.match(chat, /fontFamily: isWeb \? CHAT_FONT_FAMILY : undefined/);
});

test("web emoji runs opt into an emoji font and cannot break inside a cluster", () => {
  for (const face of ["Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji"]) {
    assert.ok(text.includes(face), face);
    assert.ok(theme.includes(face), face);
  }
  assert.match(text, /emoji, "Apple Color Emoji"/);
  assert.match(theme, /\[data-emoji\]/);
  // Inputs keep a text face first. The emoji face's space is much wider, and
  // this rule is !important, so it also covers the composer and the daily limit.
  assert.match(theme, /input,textarea\{font-family:Inter,system-ui,-apple-system,sans-serif,emoji,"Apple Color Emoji"/);
  assert.equal(/input,textarea\{font-family:emoji/.test(theme), false);
  assert.match(theme, /font-variant-emoji:emoji/);
  assert.match(theme, /white-space:nowrap/);
  assert.match(theme, /!important/);
  assert.match(text, /dataSet: \{ emoji: "1" \}/);
});

test("chat sentences use a text face before the emoji face", () => {
  assert.match(
    text,
    /export const CHAT_FONT_FAMILY = `Inter, system-ui, -apple-system, sans-serif, \$\{EMOJI_FONT_FAMILY\}`/,
  );
  assert.match(text, /const EMOJI_FONT_FAMILY =\s*'emoji, "Apple Color Emoji"/);
});

test("curated emoji become stickers and every other cluster stays in the emoji font", () => {
  assert.match(text, /StickerGlyph/);
  assert.match(text, /useReducedMotion/);
  assert.match(text, /stickerCodeFor/);
  assert.match(text, /dataSet: \{ emoji: "1" \}/);
});

test("the splitter the bubbles use keeps ZWJ, skin tone, and flag glyphs whole", () => {
  for (const sample of ["👨‍👩‍👧‍👦", "👍🏻", "🇯🇵", "🏴󠁧󠁢󠁥󠁮󠁧󠁿", "🏳️‍🌈"]) {
    assert.equal(splitEmojiRuns(sample)[0]?.text, sample);
  }
  assert.deepEqual(emojiClusters("🐉⚡💪"), ["🐉", "⚡", "💪"]);
});
