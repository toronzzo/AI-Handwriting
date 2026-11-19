import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { exampleStats, listExamples, removeExample, saveLastPair, savePair } from "./gold.mjs";
import { appendMessage, createChat } from "../chats.mjs";

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "gold-test-"));
}

const NOW = new Date("2026-11-19T10:00:00.000Z").getTime();
const at = () => NOW;

test("append-only: bytes only grow, also after a tombstone", () => {
  const dir = tempDir();
  try {
    const first = savePair(dir, { q: "how do I merge a PR", a: "Open the PR and squash merge.", now: at });
    assert.equal(first.saved, true);
    const file = path.join(dir, "gold", "examples.jsonl");
    const before = fs.readFileSync(file, "utf8");
    savePair(dir, { q: "how do I sleep", a: "Cool dark room.", now: at });
    removeExample(dir, first.id, at);
    const after = fs.readFileSync(file, "utf8");
    assert.ok(after.startsWith(before), "earlier bytes stay");
    assert.equal(after.trim().split("\n").length, 3);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a tombstone hides an example, stats follow", () => {
  const dir = tempDir();
  try {
    const a = savePair(dir, { q: "merge question", a: "merge answer.", now: at });
    const b = savePair(dir, { q: "sleep question", a: "sleep answer.", now: at });
    assert.equal(exampleStats(dir).active, 2);
    removeExample(dir, a.id, at);
    const listed = listExamples(dir);
    assert.equal(listed.length, 1);
    assert.equal(listed[0].id, b.id);
    assert.equal(exampleStats(dir).active, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("duplicates are ignored, ASK_PAID and command replies are refused", () => {
  const dir = tempDir();
  try {
    savePair(dir, { q: "q1", a: "answer one.", now: at });
    const dupe = savePair(dir, { q: "q1", a: "answer one.", now: at });
    assert.equal(dupe.saved, false);
    assert.match(dupe.reason, /already saved/);
    const paid = savePair(dir, { q: "q2", a: "You need live data [[ASK_PAID]]", now: at });
    assert.equal(paid.saved, false);
    assert.match(paid.reason, /paid call/);
    const command = savePair(dir, { q: "q3", a: "Saved to notes: hello", now: at });
    assert.equal(command.saved, false);
    assert.match(command.reason, /command reply/);
    const coachReply = savePair(dir, { q: "q4", a: "Step 2 of 6: Check the checks", now: at });
    assert.equal(coachReply.saved, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a pasted sk- key is redacted, size caps apply", () => {
  const dir = tempDir();
  try {
    const saved = savePair(dir, { q: "use key sk-abcdef1234567890 to log in", a: "Never paste keys into chat.", now: at });
    assert.equal(saved.saved, true);
    const listed = listExamples(dir);
    assert.ok(!listed[0].q.includes("sk-abcdef1234567890"));
    const long = savePair(dir, { q: "x".repeat(2000), a: "y".repeat(3000), now: at });
    assert.equal(long.saved, true);
    const rows = listExamples(dir);
    const longRow = rows.find((row) => row.id === long.id);
    assert.equal(longRow.q.length, 600);
    assert.equal(longRow.a.length, 1200);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("torn lines are skipped", () => {
  const dir = tempDir();
  try {
    fs.mkdirSync(path.join(dir, "gold"), { recursive: true });
    const file = path.join(dir, "gold", "examples.jsonl");
    const good = { v: 1, id: "gx_a", ts: NOW, q: "q", a: "a", lang: "en", source: "chat" };
    fs.writeFileSync(file, [`{v:1, torn`, JSON.stringify(good), ""].join("\n"));
    const listed = listExamples(dir);
    assert.equal(listed.length, 1);
    assert.equal(listed[0].id, "gx_a");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("saveLastPair picks the newest chat's last model pair and refuses a command reply", () => {
  const dir = tempDir();
  try {
    const chat = createChat(dir, "gold chat");
    appendMessage(dir, chat.id, { role: "user", content: "how do I merge a PR", who: "user", model: "" });
    appendMessage(dir, chat.id, { role: "assistant", content: "Open the PR and squash merge into main.", who: "preyas", model: "preyas" });
    const saved = saveLastPair(dir, at);
    assert.equal(saved.saved, true);
    const rows = listExamples(dir);
    assert.equal(rows.length, 1);
    assert.match(rows[0].q, /how do I merge a PR/);
    assert.match(rows[0].a, /squash merge/);
    // A NEWER chat whose last reply is a command reply must not save anything.
    const chat2 = createChat(dir, "only commands");
    appendMessage(dir, chat2.id, { role: "user", content: "remember lunch", who: "user", model: "" });
    appendMessage(dir, chat2.id, { role: "assistant", content: "Saved to notes: lunch", who: "preyas", model: "preyas" });
    const refused = saveLastPair(dir, at);
    assert.equal(refused.saved, false, "the command reply is refused");
    assert.equal(listExamples(dir).length, 1, "nothing new was saved");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("saveLastPair refuses when there is no model answer", () => {
  const dir = tempDir();
  try {
    const refused = saveLastPair(dir, at);
    assert.equal(refused.saved, false);
    const chat = createChat(dir, "only commands");
    appendMessage(dir, chat.id, { role: "user", content: "remember lunch", who: "user", model: "" });
    appendMessage(dir, chat.id, { role: "assistant", content: "Saved to notes: lunch", who: "preyas", model: "preyas" });
    const refused2 = saveLastPair(dir, at);
    assert.equal(refused2.saved, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("stats count ru and en", () => {
  const dir = tempDir();
  try {
    savePair(dir, { q: "how do I merge", a: "Squash merge.", now: at });
    savePair(dir, { q: "как смержить", a: "Нажми Squash and merge.", now: at });
    const stats = exampleStats(dir);
    assert.equal(stats.active, 2);
    assert.equal(stats.en, 1);
    assert.equal(stats.ru, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
