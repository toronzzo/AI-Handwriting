import assert from "node:assert/strict";
import test from "node:test";
import { emojiClusters, isEmojiCluster, splitEmojiRuns } from "./emojiRuns.ts";

test("ZWJ sequences, skin tones, flags and keycaps stay one cluster", () => {
  const samples = ["👨‍💻", "👨‍👩‍👧‍👦", "👍🏻", "🇯🇵", "🏳️‍🌈", "🏴󠁧󠁢󠁥󠁮󠁧󠁿", "1️⃣", "❤️", "🐉"];
  for (const sample of samples) {
    assert.equal(isEmojiCluster(sample), true, sample);
    const runs = splitEmojiRuns(sample);
    assert.equal(runs.length, 1, sample);
    assert.equal(runs[0]!.emoji, true, sample);
    assert.equal(runs[0]!.text, sample, sample);
  }
});

test("a combo stays three clusters and words stay words", () => {
  const runs = splitEmojiRuns("hi 🐉⚡💪");
  assert.deepEqual(
    runs.map((run) => run.text),
    ["hi ", "🐉", "⚡", "💪"],
  );
  assert.deepEqual(emojiClusters("what does 🐉⚡💪 mean?"), ["🐉", "⚡", "💪"]);
});

test("neighbouring words merge and an empty string has no runs", () => {
  const runs = splitEmojiRuns("hello there");
  assert.equal(runs.length, 1);
  assert.equal(runs[0]!.emoji, false);
  assert.deepEqual(splitEmojiRuns(""), []);
  assert.deepEqual(emojiClusters("no emoji here"), []);
});
