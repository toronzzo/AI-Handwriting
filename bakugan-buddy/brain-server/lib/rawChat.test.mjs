import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import http from "node:http";
import { Readable } from "node:stream";
import test from "node:test";
import { handleRawChat, normalizeRawChatRequest, RAW_CHAT_PATH } from "./rawChat.mjs";

/** A minimal ServerResponse stand-in: records chunks, headers and close events. */
class FakeResponse {
  constructor() {
    this.chunks = [];
    this.statusCode = null;
    this.headers = null;
    this.writableEnded = false;
    this.headersSent = false;
    this.listeners = new Map();
  }
  on(event, cb) {
    const list = this.listeners.get(event);
    if (list) list.push(cb);
    else this.listeners.set(event, [cb]);
  }
  off(event, cb) {
    const list = this.listeners.get(event);
    if (!list) return;
    const index = list.indexOf(cb);
    if (index >= 0) list.splice(index, 1);
  }
  writeHead(status, headers) {
    this.statusCode = status;
    this.headers = headers;
    this.headersSent = true;
  }
  write(chunk) {
    this.chunks.push(Buffer.from(chunk));
    return true;
  }
  end(chunk) {
    if (chunk !== undefined) this.chunks.push(Buffer.from(chunk));
    this.writableEnded = true;
  }
  text() {
    return Buffer.concat(this.chunks).toString("utf8");
  }
  json() {
    return JSON.parse(this.text());
  }
}

function fakeRequest(body, options = {}) {
  const req = Readable.from([Buffer.from(JSON.stringify(body))]);
  req.method = options.method || "POST";
  req.headers = {};
  if (options.token) req.headers["x-preyas-token"] = options.token;
  if (options.origin) req.headers.origin = options.origin;
  req.socket = { remoteAddress: options.remoteAddress || "192.168.1.20" };
  return req;
}

function startUpstream(handler) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => handler(req, res));
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function upstreamBase(server) {
  return `http://127.0.0.1:${server.address().port}`;
}

const TOKEN = "a".repeat(24);
const BOOK = { devices: [{ token: TOKEN, name: "test phone", pairedAt: 1, lastSeen: 1 }] };
const USER = { messages: [{ role: "user", content: "hello" }] };

test("normalizeRawChatRequest keeps only the raw settings and clamps them", () => {
  const normalized = normalizeRawChatRequest({
    messages: [
      { role: "system", content: "Be brief." },
      { role: "user", content: "hello" },
      { role: "tool", content: "not passed" },
    ],
    temperature: 9,
    top_p: -1,
    max_tokens: 99999,
    model: "ignored",
  });
  const body = JSON.parse(normalized.body);
  assert.equal(body.temperature, 2);
  assert.equal(body.top_p, 0);
  assert.equal(body.max_tokens, 8192);
  assert.equal(body.stream, true);
  assert.equal(body.timings_per_token, true);
  assert.equal(body.chat_template_kwargs.enable_thinking, true);
  assert.deepEqual(body.messages, [
    { role: "system", content: "Be brief." },
    { role: "user", content: "hello" },
  ]);
  assert.equal(body.model, undefined);
});

test("normalizeRawChatRequest rejects requests with no user message", () => {
  assert.equal(normalizeRawChatRequest({ messages: [] }).error, "a user message is required");
  assert.equal(normalizeRawChatRequest({ messages: [{ role: "assistant", content: "hi" }] }).error, "a user message is required");
  assert.equal(normalizeRawChatRequest(null).error, "invalid request");
});

test("the raw route streams reasoning, content, timings and [DONE] from llama", async () => {
  let seenBody = null;
  const server = await startUpstream(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    seenBody = JSON.parse(raw);
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write(
      'data: {"choices":[{"delta":{"reasoning_content":"Think"}}],"timings":{"prompt_n":4,"predicted_n":1,"predicted_ms":12,"predicted_per_second":80}}\n\n',
    );
    res.write(
      'data: {"choices":[{"delta":{"content":"Hi"}}],"timings":{"prompt_n":4,"predicted_n":2,"predicted_ms":24,"predicted_per_second":81}}\n\n',
    );
    res.write("data: [DONE]\n\n");
    res.end();
  });
  try {
    const res = new FakeResponse();
    await handleRawChat(fakeRequest({ ...USER, temperature: 0.3, max_tokens: 64 }, { token: TOKEN }), res, {
      llamaUrl: upstreamBase(server),
      book: BOOK,
    });
    assert.equal(res.statusCode, 200);
    assert.match(res.headers["Content-Type"], /text\/event-stream/);
    assert.equal(res.writableEnded, true);
    assert.match(res.text(), /"reasoning_content":"Think"/);
    assert.match(res.text(), /"content":"Hi"/);
    assert.match(res.text(), /predicted_per_second/);
    assert.match(res.text(), /\[DONE\]/);
    assert.equal(seenBody.stream, true);
    assert.equal(seenBody.timings_per_token, true);
    assert.equal(seenBody.temperature, 0.3);
    assert.equal(seenBody.max_tokens, 64);
    assert.equal(seenBody.messages[0].content, "hello");
  } finally {
    server.close();
  }
});

test("the raw route refuses an unpaired caller with 401 and pair guidance", async () => {
  const res = new FakeResponse();
  await handleRawChat(fakeRequest(USER), res, { book: { devices: [] }, llamaUrl: "http://127.0.0.1:1" });
  assert.equal(res.statusCode, 401);
  assert.equal(res.json().pair, true);
  assert.match(res.json().error, /pair this device/i);
});

test("the raw route refuses a bad token too", async () => {
  const res = new FakeResponse();
  await handleRawChat(fakeRequest(USER, { token: "not-the-token" }), res, {
    book: BOOK,
    llamaUrl: "http://127.0.0.1:1",
  });
  assert.equal(res.statusCode, 401);
});

test("a down llama-server becomes 503, not a hung request", async () => {
  const res = new FakeResponse();
  await handleRawChat(fakeRequest(USER, { token: TOKEN }), res, {
    book: BOOK,
    llamaUrl: "http://127.0.0.1:8790",
    fetchImpl: async () => {
      throw new Error("ECONNREFUSED");
    },
  });
  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.json(), { error: "llama is down" });
});

test("the route is under /v1 and never imports the Memory or chat stores", () => {
  assert.equal(RAW_CHAT_PATH, "/v1/raw/chat");
  const source = readFileSync(new URL("./rawChat.mjs", import.meta.url), "utf8");
  assert.equal(/rememberFacts|openMemory|appendMessage|createChat|listChats|memory\.mjs|chats\.mjs/.test(source), false);
});
