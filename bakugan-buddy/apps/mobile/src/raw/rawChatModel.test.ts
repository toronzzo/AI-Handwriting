/// <reference types="node" />
import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_RAW_SETTINGS,
  RAW_CHATS_KEY,
  RAW_SETTINGS_KEY,
  addRawMessage,
  formatRawStats,
  loadRawChats,
  loadRawSettings,
  newRawChat,
  normalizeRawSettings,
  parseRawSse,
  rawChatPayload,
  rawChatTitle,
  saveRawChats,
  saveRawSettings,
  statsFromTimings,
  type RawChat,
  type RawChatStore,
  type RawMessage,
} from "./rawChatModel.ts";

function message(overrides: Partial<RawMessage> = {}): RawMessage {
  return {
    id: "m1",
    role: "user",
    content: "hello",
    reasoning: "",
    stats: null,
    at: 1_000,
    ...overrides,
  };
}

function memoryStore(): RawChatStore & { writes: Map<string, string> } {
  const writes = new Map<string, string>();
  return {
    writes,
    getItem: async (key) => writes.get(key) ?? null,
    setItem: async (key, value) => {
      writes.set(key, value);
    },
  };
}

test("parseRawSse keeps a torn tail and yields reasoning, content and done", () => {
  const firstFrame = `data: ${JSON.stringify({
    choices: [{ delta: { reasoning_content: "Think" } }],
    timings: { predicted_n: 1, predicted_ms: 12, predicted_per_second: 80 },
  })}\n\n`;
  const secondFrame = `data: ${JSON.stringify({ choices: [{ delta: { content: "Hi there" } }] })}\n\n`;
  const splitAt = firstFrame.length + 20;
  const first = parseRawSse((firstFrame + secondFrame).slice(0, splitAt));
  assert.equal(first.frames.length, 1);
  assert.equal(first.frames[0].reasoning, "Think");
  assert.equal(first.frames[0].timings?.predicted_per_second, 80);
  assert.ok(first.rest.length > 0);

  const second = parseRawSse(first.rest + secondFrame.slice(splitAt - firstFrame.length) + "data: [DONE]\n\n");
  assert.equal(second.frames.length, 2);
  assert.equal(second.frames[0].content, "Hi there");
  assert.equal(second.frames[1].done, true);
  assert.equal(second.rest, "");
});

test("parseRawSse tolerates CRLF and ignores a malformed frame", () => {
  const parsed = parseRawSse(
    'data: {"choices":[{"delta":{"content":"A"}}]}\r\n\r\n' +
      "data: not-json\r\n\r\n" +
      'data: {"choices":[{"delta":{"reasoning":"B"}}]}\r\n\r\n',
  );
  assert.equal(parsed.frames.length, 2);
  assert.equal(parsed.frames[0].content, "A");
  assert.equal(parsed.frames[1].reasoning, "B");
});

test("stats use llama timings and fall back to live counts before they arrive", () => {
  const final = statsFromTimings(
    { predicted_n: 42, predicted_ms: 2_100, predicted_per_second: 20.04 },
    1_000,
    4_000,
  );
  assert.deepEqual(final, { tokensPerSecond: 20, tokens: 42, ms: 2_100 });
  assert.equal(formatRawStats(final), "20.0 tok/s · 42 tokens · 2.1 s");

  const live = statsFromTimings(null, 1_000, 3_000, 20);
  assert.equal(live.tokens, 20);
  assert.equal(live.tokensPerSecond, 10);
  assert.equal(live.ms, 2_000);
  assert.equal(formatRawStats(null), "");
});

test("settings are clamped and a system prompt leads the payload", () => {
  const settings = normalizeRawSettings({ temperature: 99, topP: -2, maxTokens: 0, systemPrompt: "  Be brief.  " });
  assert.equal(settings.temperature, 2);
  assert.equal(settings.topP, 0);
  assert.equal(settings.maxTokens, 1);
  assert.equal(settings.systemPrompt, "  Be brief.  ");

  const chat: RawChat = {
    ...newRawChat(1_000, "chat-1"),
    messages: [message(), message({ id: "m2", role: "assistant", content: "Hi", reasoning: "secret", at: 1_100 })],
  };
  const payload = rawChatPayload(chat, settings);
  assert.deepEqual(payload.messages, [
    { role: "system", content: "Be brief." },
    { role: "user", content: "hello" },
    { role: "assistant", content: "Hi" },
  ]);
  assert.equal(payload.stream, true);
  assert.equal(payload.temperature, 2);
  assert.equal(payload.max_tokens, 1);
});

test("the first user message becomes the chat title", () => {
  assert.equal(rawChatTitle("  plan my week\nand more"), "plan my week");
  assert.equal(rawChatTitle(""), "New chat");
  const chat = newRawChat(5_000, "chat-1");
  const next = addRawMessage(chat, message({ content: "What is Qwen?", at: 6_000 }));
  assert.equal(next.title, "What is Qwen?");
  assert.equal(next.messages.length, 1);
  assert.equal(next.updatedAt, 6_000);
  assert.equal(DEFAULT_RAW_SETTINGS.maxTokens, 512);
});

test("raw chats and settings round-trip under their own local keys", async () => {
  const store = memoryStore();
  const chat = addRawMessage(newRawChat(1_000, "chat-1"), message({ content: "Raw only" }));
  await saveRawChats(store, [chat]);
  await saveRawSettings(store, { ...DEFAULT_RAW_SETTINGS, temperature: 0.2 });

  assert.deepEqual([...store.writes.keys()].sort(), [RAW_CHATS_KEY, RAW_SETTINGS_KEY].sort());
  assert.equal(RAW_CHATS_KEY.includes("memory"), false);
  assert.equal(RAW_SETTINGS_KEY.includes("memory"), false);

  const loaded = await loadRawChats(store);
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].title, "Raw only");
  assert.equal(loaded[0].messages[0].content, "Raw only");
  const settings = await loadRawSettings(store);
  assert.equal(settings.temperature, 0.2);
});

test("missing or corrupt raw storage falls back to an empty chat list", async () => {
  const store = memoryStore();
  assert.deepEqual(await loadRawChats(store), []);
  assert.deepEqual(await loadRawSettings(store), DEFAULT_RAW_SETTINGS);
  await store.setItem(RAW_CHATS_KEY, "{not json");
  assert.deepEqual(await loadRawChats(store), []);
});
