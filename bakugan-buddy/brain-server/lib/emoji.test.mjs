import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { emojiClusters } from "../../packages/alive/src/emojiRuns.ts";
import {
  EMOJI_MODE_MAX,
  EMOJI_PROMPT_MAX,
  buildEmojiPrompt,
  emojiModeFromMessages,
  emojiModeFromText,
  explainEmoji,
  getEmojiIndex,
  readEmojiMode,
  searchEmoji,
  withEmoji,
  writeEmojiMode,
} from "./emoji.mjs";

const index = getEmojiIndex();

function chat(user, extra = []) {
  return JSON.stringify({
    model: "preyas",
    messages: [
      { role: "system", content: "You are Preyas, a calm coach. [[ASK_PAID]]" },
      ...extra,
      { role: "user", content: user },
    ],
  });
}

function injected(raw, options) {
  const out = withEmoji(raw, options);
  return JSON.parse(Buffer.isBuffer(out) ? out.toString("utf8") : String(out));
}

test("the bundled set is Unicode 18, offline, and covers the full qualified list", () => {
  assert.equal(index.unicode, "18.0");
  assert.equal(index.cldr, "49");
  assert.equal(index.license, "Unicode-3.0");
  assert.ok(index.fullyQualified >= 3700, `fully qualified ${index.fullyQualified}`);
  assert.ok(index.bases >= 1500, `bases ${index.bases}`);
  const license = fs.readFileSync(new URL("./emoji/LICENSE", import.meta.url), "utf8");
  assert.match(license, /UNICODE LICENSE V3/);
  const source = fs.readFileSync(new URL("./emoji.mjs", import.meta.url), "utf8");
  assert.equal(source.includes("fetch("), false, "lookup must not download");
  assert.equal(source.includes("https://"), false, "lookup must not name a runtime URL");
});

test("lookup finds emoji by keyword, mood, and exact glyph", () => {
  const dragons = searchEmoji(index, "tell me about a dragon", { mood: "neutral", limit: 8 });
  assert.equal(dragons[0].emoji, "🐉");
  assert.equal(dragons[0].name, "dragon");

  const japan = searchEmoji(index, "flag of japan", { mood: "neutral", limit: 8 });
  assert.equal(japan[0].emoji, "🇯🇵");

  const coder = searchEmoji(index, "a coder at work", { mood: "neutral", limit: 8 });
  assert.ok(coder.some((entry) => entry.emoji === "👨‍💻"));

  const sad = searchEmoji(index, "hello", { mood: "sad", limit: 8 });
  assert.ok(sad.some((entry) => /cry|sad|tear|broken/i.test(`${entry.name} ${entry.keywords.join(" ")}`)));
  assert.ok(new Set(sad.map((entry) => entry.group)).size >= 2, "sad palette is not one group");

  const battle = searchEmoji(index, "", { mood: "battle", limit: 12 });
  assert.ok(battle.some((entry) => entry.emoji === "🐉"));
  assert.ok(!battle.some((entry) => entry.emoji === "😀"));
});

test("a combo, a skin tone, a flag, and a ZWJ sequence are explained", () => {
  const combo = explainEmoji(index, "what does 🐉⚡💪 mean?");
  assert.deepEqual(
    combo.parts.map((part) => part.name),
    ["dragon", "high voltage", "flexed biceps"],
  );
  assert.equal(combo.combo, "dragon + high voltage + flexed biceps");

  const tone = explainEmoji(index, "👍🏻");
  assert.equal(tone.parts[0].name, "thumbs up");
  assert.equal(tone.parts[0].tone, "light skin tone");

  assert.match(explainEmoji(index, "🇯🇵").parts[0].name, /Japan/);
  assert.match(explainEmoji(index, "🏴󠁧󠁢󠁥󠁮󠁧󠁿").parts[0].name, /England/);
  assert.match(explainEmoji(index, "🏳️‍🌈").parts[0].name, /rainbow/i);
  assert.match(explainEmoji(index, "👨‍💻").parts[0].name, /technologist/i);
  assert.match(explainEmoji(index, "👨‍👩‍👧‍👦").parts[0].name, /family/i);
  assert.equal(explainEmoji(index, "1️⃣").parts[0].name, "keycap: 1");
  assert.deepEqual(emojiClusters("🐉⚡💪"), ["🐉", "⚡", "💪"]);
});

test("emoji mode is detected from the latest ask, in English, Russian, and Polish", () => {
  assert.equal(emojiModeFromText("answer only in emojis"), "only");
  assert.equal(emojiModeFromText("use more emojis please"), "more");
  assert.equal(emojiModeFromText("emoji mode"), "more");
  assert.equal(emojiModeFromText("stop emoji mode"), "off");
  assert.equal(emojiModeFromText("no emojis"), "off");
  assert.equal(emojiModeFromText("только эмодзи"), "only");
  assert.equal(emojiModeFromText("больше эмодзи"), "more");
  assert.equal(emojiModeFromText("bez emoji"), "off");
  assert.equal(emojiModeFromText("what does this emoji mean?"), null);
  assert.equal(
    emojiModeFromMessages([
      { role: "user", content: "answer only in emojis" },
      { role: "assistant", content: "🐉" },
      { role: "user", content: "use more emojis" },
    ]),
    "more",
  );
});

test("the prompt is a small slice: meanings, mood palette, and the active mode", () => {
  const plain = buildEmojiPrompt({ index, text: "hello", mood: "happy", mode: null });
  assert.match(plain, /Emoji \(Unicode 18\)/);
  assert.match(plain, /Palette:/);
  assert.ok(plain.length <= EMOJI_PROMPT_MAX, plain.length);
  assert.ok(emojiClusters(plain).length < 40);

  const dragon = buildEmojiPrompt({ index, text: "a dragon", mood: "battle", mode: null });
  assert.match(dragon, /🐉 dragon/);
  assert.ok(dragon.length <= EMOJI_PROMPT_MAX);

  const read = buildEmojiPrompt({ index, text: "what does 🐉⚡💪 mean?", mood: "excited", mode: null });
  assert.match(read, /They sent:/);
  assert.match(read, /Read the combo as dragon \+ high voltage \+ flexed biceps/);
  assert.ok(read.length <= EMOJI_PROMPT_MAX);

  const only = buildEmojiPrompt({ index, text: "answer only in emojis about rain", mood: "sad", mode: "only" });
  assert.match(only, /answer with emoji only/);
  assert.ok(only.length <= EMOJI_MODE_MAX);

  const off = buildEmojiPrompt({ index, text: "no emojis", mood: "happy", mode: "off" });
  assert.match(off, /words only/);
  assert.equal(off.includes("Palette:"), false);

  const flood = buildEmojiPrompt({ index, text: "🇯🇵".repeat(40), mood: "neutral", mode: null });
  assert.ok(flood.length <= EMOJI_PROMPT_MAX, flood.length);
});

test("withEmoji injects after the persona and leaves the partner's words alone", () => {
  const json = injected(chat("tell me about a dragon\n/no_think"), { mood: "battle" });
  assert.equal(json.messages[0].role, "system");
  assert.match(json.messages[0].content, /calm coach/);
  assert.equal(json.messages[1].role, "system");
  assert.match(json.messages[1].content, /🐉/);
  assert.equal(json.messages.at(-1).content, "tell me about a dragon\n/no_think");
  assert.ok(json.messages[1].content.length <= EMOJI_PROMPT_MAX);
});

test("emoji mode sticks after the ask scrolls out of the trimmed history", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "preyas-emoji-"));
  const memory = { mode: null };
  injected(chat("answer only in emojis"), { mood: "happy", memory, dataDir: dir });
  assert.equal(memory.mode, "only");
  assert.equal(readEmojiMode(dir), "only");
  const later = injected(chat("how are you"), { mood: "happy", memory, dataDir: dir });
  assert.match(later.messages[1].content, /answer with emoji only/);
  writeEmojiMode(dir, "off");
  const quiet = injected(chat("hello"), { mood: "neutral", dataDir: dir });
  assert.match(quiet.messages[1].content, /words only/);
  assert.equal(quiet.messages[1].content.includes("Palette:"), false);
});

test("room barks and broken bodies are not rewritten", () => {
  const room = JSON.stringify({
    messages: [
      { role: "system", content: "You are Preyas, an Aquos Bakugan in ball form, living in your partner's room." },
      { role: "user", content: "dragon" },
    ],
  });
  assert.equal(withEmoji(room), room);
  assert.equal(withEmoji("not json"), "not json");
  assert.equal(withEmoji(JSON.stringify({ messages: [] })), JSON.stringify({ messages: [] }));
});

test("chat completions pass through withEmoji", () => {
  const proxy = fs.readFileSync(new URL("../proxy.mjs", import.meta.url), "utf8");
  assert.match(proxy, /withEmoji\(body, \{ mood: lastMood, dataDir \}\)/);
});
