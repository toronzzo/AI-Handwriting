import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { appendHistory, paidAvailability, readHistory } from "./history.mjs";

test("history on the drive keeps every turn and a short summary", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "preyas-chat-"));
  appendHistory(root, { role: "user", who: "user", content: "What time is it?" });
  appendHistory(root, { role: "assistant", who: "preyas", content: "I live in the room, not the clock." });
  const book = readHistory(root, 10);
  assert.equal(book.messages.length, 2);
  assert.match(book.summary, /What time is it/);
  assert.match(book.summary, /not the clock/);
  const file = path.join(root, "history", "chat.jsonl");
  assert.equal(fs.existsSync(file), true);
  fs.rmSync(root, { recursive: true, force: true });
});

test("a missing or placeholder DeepSeek key stays unavailable and the key is not returned", () => {
  const empty = paidAvailability("DEEPSEEK_OFF_PEAK_ONLY=1\n");
  assert.equal(empty.available, false);
  assert.equal(empty.offPeakOnly, true);
  const fake = paidAvailability("DEEPSEEK_API_KEY=changeme\n");
  assert.equal(fake.available, false);
  const real = paidAvailability("DEEPSEEK_API_KEY=sk-test-secret\n");
  assert.equal(real.available, true);
  assert.equal(JSON.stringify(real).includes("sk-test-secret"), false);
});
