import assert from "node:assert/strict";
import test from "node:test";
import {
  PREYAS_CHAT_SYSTEM,
  completionExtras,
  isShortAffirmation,
  toModelMessages,
  wantsThinking,
  type ChatMessage,
} from "./chatTurn.ts";

const history: ChatMessage[] = [
  { role: "user", content: "tell me about bakugan" },
  { role: "assistant", content: "Bakugan are sphere-shaped battle creatures. Want me to explain it?" },
];

test("a bare yes is sent as the last turn, right after the question", () => {
  const messages = toModelMessages(history, "", "yes");
  assert.equal(messages[messages.length - 1].role, "user");
  assert.equal(messages[messages.length - 1].content, "yes", "the user text is not wrapped");
  assert.equal(messages[messages.length - 2].role, "assistant");
  assert.match(messages[messages.length - 2].content, /Want me to explain it\?$/);
});

test("memory rides in the system message, never in the user turn", () => {
  const messages = toModelMessages(history, "partner likes aquariums", "yes");
  assert.equal(messages[0].role, "system");
  assert.ok(messages[0].content.startsWith(PREYAS_CHAT_SYSTEM));
  assert.match(messages[0].content, /partner likes aquariums/);
  assert.equal(messages[messages.length - 1].content, "yes");
  assert.doesNotMatch(messages[messages.length - 1].content, /Memory/i);
});

test("short affirmations are recognised in English and Russian", () => {
  for (const text of ["yes", "Yes!", "ok", "okay", "sure", "go on", "please do", "да", "конечно", " ok "]) {
    assert.equal(isShortAffirmation(text), true, text);
  }
  for (const text of ["no", "yes but explain the arena rules first please", "tell me about bakugan", ""]) {
    assert.equal(isShortAffirmation(text), false, text);
  }
});

test("thinking turns on for stories, explanations, maths and hard questions", () => {
  for (const text of [
    "tell me a story about the arena",
    "explain how Bakugan battles work",
    "why does the arena collapse?",
    "what is 17 * 24",
    "solve this step by step",
    "compare Aquos and Pyrus factions",
    "plan my week from my notes",
  ]) {
    assert.equal(wantsThinking(text), true, text);
  }
});

test("quick chat stays on the fast path", () => {
  for (const text of ["hi", "hello", "yes", "ok", "what time is it", "", "thanks"]) {
    assert.equal(wantsThinking(text), false, text);
  }
});

test("the toggle forces thinking on and raises the token budget", () => {
  const off = completionExtras("preyas");
  const on = completionExtras("preyas", { think: true });
  assert.deepEqual(off.chat_template_kwargs, { enable_thinking: false });
  assert.deepEqual(on.chat_template_kwargs, { enable_thinking: true });
  assert.ok(on.max_tokens > off.max_tokens * 2, "reasoning needs room beyond the answer");
  assert.equal(on.max_tokens, 2048);
  // Paid models keep their own settings; thinking is a local feature.
  assert.deepEqual(completionExtras("paid", { think: true }).thinking, { type: "disabled" });
});
