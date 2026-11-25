import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { hasAnswerContent, pipeChatCompletion } from "./chatPipe.mjs";

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
  emit(event, ...args) {
    for (const cb of [...(this.listeners.get(event) || [])]) cb(...args);
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
}

function startUpstream(handler) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => handler(req, res));
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function upstreamUrl(server) {
  const { port } = server.address();
  return `http://127.0.0.1:${port}/v1/chat/completions`;
}

async function waitFor(cond, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (cond()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("waitFor timed out");
}

const CONTENT_CHUNK = 'data: {"choices":[{"delta":{"content":"Hi there"}}]}\n\n';

function runPipe(server, events, timeoutMs = 3000, body = JSON.stringify({ stream: true })) {
  const brainRecords = [];
  const brain = { emit: (record) => brainRecords.push(record) };
  const res = new FakeResponse();
  const running = pipeChatCompletion(brain, {}, res, upstreamUrl(server), body, "llama is down", timeoutMs, events);
  return { running, res, brainRecords };
}

function eventsWith(onAnswered) {
  return { neuron: "chat-small", local: true, paid: false, ramPromise: Promise.resolve(123), onAnswered };
}

test("hasAnswerContent: real answer text counts, usage and reasoning do not", () => {
  const sse = (blocks) => blocks.map((block) => `data: ${JSON.stringify(block)}\n\n`).join("");
  assert.equal(hasAnswerContent(sse([{ choices: [{ delta: { content: "Hi" } }] }]), true), true);
  assert.equal(hasAnswerContent(sse([{ choices: [{ delta: { content: "" } }] }]), true), false);
  assert.equal(hasAnswerContent(sse([{ choices: [{ delta: { reasoning_content: "secret" } }] }]), true), false);
  assert.equal(hasAnswerContent('data: {"usage":{"completion_tokens":3}}\n\ndata: [DONE]\n\n', true), false);
  assert.equal(hasAnswerContent("", true), false);
  assert.equal(hasAnswerContent(JSON.stringify({ choices: [{ message: { content: "Hello" } }] }), false), true);
  assert.equal(hasAnswerContent(JSON.stringify({ choices: [{ message: { content: "  " } }] }), false), false);
  assert.equal(hasAnswerContent(JSON.stringify({ usage: { completion_tokens: 3 } }), false), false);
});

test("a fully received reply with content resets the idle window once", async () => {
  const server = await startUpstream((req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write('data: {"choices":[{"delta":{"content":"Hi "}}]}\n\n');
    res.write('data: {"choices":[{"delta":{"content":"there"}}]}\n\n');
    res.write("data: [DONE]\n\n");
    res.end();
  });
  try {
    let answered = 0;
    const { running, res, brainRecords } = runPipe(server, eventsWith(() => (answered += 1)));
    await running;
    assert.equal(answered, 1, "one real answer, one reset");
    assert.equal(res.statusCode, 200);
    assert.equal(res.writableEnded, true);
    assert.equal(res.headers["X-Preyas-Brain"], undefined);
    assert.ok(brainRecords.some((record) => record.state === "done"));
  } finally {
    server.close();
  }
});

test("200 headers then a stalled stream that times out never resets the idle window", async () => {
  const server = await startUpstream((req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write(CONTENT_CHUNK); // content arrived, but the stream never finishes
  });
  try {
    let answered = 0;
    const { running, res } = runPipe(server, eventsWith(() => (answered += 1)), 150);
    await running;
    assert.equal(answered, 0, "a timed-out stream is not an answer");
    assert.equal(res.statusCode, 200, "the headers went out before the stall");
    assert.equal(res.writableEnded, true);
  } finally {
    server.close();
  }
});

test("200 headers then a client that leaves never resets the idle window", async () => {
  const server = await startUpstream((req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write(CONTENT_CHUNK); // content arrived, then the client walked away
  });
  try {
    let answered = 0;
    const { running, res, brainRecords } = runPipe(server, eventsWith(() => (answered += 1)), 5000);
    await waitFor(() => res.chunks.length > 0, 2000);
    res.emit("close");
    await running;
    assert.equal(answered, 0, "a disconnected stream is not an answer");
    assert.ok(!brainRecords.some((record) => record.state === "done"), "the brain never saw a completed reply");
  } finally {
    server.close();
  }
});

test("a client that leaves while the reply finishes flushing never resets the idle window", async () => {
  const server = await startUpstream((req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write(CONTENT_CHUNK);
    res.write("data: [DONE]\n\n");
    res.end(); // the upstream completed: the reply is fully buffered
  });
  try {
    let answered = 0;
    let resolveRam;
    const ramPromise = new Promise((resolve) => (resolveRam = resolve));
    const { running, res, brainRecords } = runPipe(server, {
      neuron: "chat-small",
      local: true,
      paid: false,
      ramPromise, // the flush is still awaiting this when the client leaves
      onAnswered: () => (answered += 1),
    });
    await waitFor(() => res.chunks.length > 0, 2000);
    await new Promise((resolve) => setImmediate(resolve));
    res.emit("close"); // the user left during the final flush
    resolveRam(123);
    await running;
    assert.equal(answered, 0, "the reply never reached the user, so it is not activity");
    assert.ok(!brainRecords.some((record) => record.state === "done"), "the brain never saw it as done");
  } finally {
    server.close();
  }
});

test("a completed stream without answer content never resets the idle window", async () => {
  const server = await startUpstream((req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write('data: {"choices":[{"delta":{"reasoning_content":"thinking only"}}]}\n\n');
    res.write('data: {"usage":{"completion_tokens":4}}\n\n');
    res.write("data: [DONE]\n\n");
    res.end();
  });
  try {
    let answered = 0;
    const { running, brainRecords } = runPipe(server, eventsWith(() => (answered += 1)));
    await running;
    assert.equal(answered, 0, "reasoning and usage are not an answer");
    assert.ok(brainRecords.some((record) => record.state === "done"));
  } finally {
    server.close();
  }
});

test("a news sentence is written in front of the answer and only remembered when it was sent", async () => {
  const server = await startUpstream((req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write(CONTENT_CHUNK);
    res.end();
  });
  try {
    let delivered = 0;
    const { running, res } = runPipe(server, {
      ...eventsWith(() => {}),
      introPrefix: "New since last time: I can now use Groq.",
      onIntroDelivered: () => {
        delivered += 1;
      },
    });
    await running;
    const text = Buffer.concat(res.chunks).toString("utf8");
    assert.ok(text.startsWith("data: "));
    assert.ok(text.indexOf("New since last time: I can now use Groq.") < text.indexOf("Hi there"));
    assert.equal(delivered, 1);
  } finally {
    server.close();
  }
});

test("a failed upstream does not deliver the news sentence", async () => {
  const server = await startUpstream((req, res) => {
    res.writeHead(503, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "llama is down" }));
  });
  try {
    let delivered = 0;
    const { running, res } = runPipe(server, {
      introPrefix: "New since last time: I can now use Groq.",
      onIntroDelivered: () => {
        delivered += 1;
      },
    });
    await running;
    const text = Buffer.concat(res.chunks).toString("utf8");
    assert.ok(!text.includes("New since last time"));
    assert.equal(delivered, 0);
  } finally {
    server.close();
  }
});

test("deferError keeps a failed local reply off the wire", async () => {
  const server = await startUpstream((req, res) => {
    res.writeHead(503, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "llama is down" }));
  });
  try {
    const brain = { emit: () => {} };
    const res = new FakeResponse();
    const result = await pipeChatCompletion(
      brain,
      {},
      res,
      upstreamUrl(server),
      JSON.stringify({ stream: false }),
      "llama is down",
      3000,
      { neuron: "chat-small", deferError: true },
    );
    assert.equal(result.ok, false);
    assert.equal(result.wrote, false);
    assert.equal(res.headersSent, false);
    assert.equal(res.chunks.length, 0);
  } finally {
    server.close();
  }
});

test("a paid reply reports what it really cost, so the brain can write the ledger", async () => {
  const server = await startUpstream((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        choices: [{ message: { content: "Hello" } }],
        usage: { prompt_tokens: 1000, completion_tokens: 200 },
      }),
    );
  });
  try {
    const reported = [];
    const brain = { emit: () => {} };
    const res = new FakeResponse();
    const result = await pipeChatCompletion(brain, {}, res, upstreamUrl(server), JSON.stringify({ stream: false }), "paid gateway is down", 3000, {
      neuron: "hands",
      paid: true,
      local: false,
      paidEstimateUsd: 0.002,
      onPaidCost: (usd, exact) => reported.push({ usd, exact }),
    });
    assert.equal(result.ok, true);
    assert.equal(reported.length, 1, "one ledger line per paid turn");
    assert.ok(reported[0].usd > 0, "usage turns into a real cost");
    assert.ok(reported[0].usd < 0.01, "one short turn is cents at most");
    assert.equal(reported[0].exact, true, "the provider reported the usage, so the line is measured");
  } finally {
    server.close();
  }
});

test("a paid reply with no usage still charges the estimate the gate allowed", async () => {
  const server = await startUpstream((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { content: "Hello" } }] }));
  });
  try {
    const reported = [];
    const brain = { emit: () => {} };
    const res = new FakeResponse();
    await pipeChatCompletion(brain, {}, res, upstreamUrl(server), JSON.stringify({ stream: false }), "paid gateway is down", 3000, {
      neuron: "hands",
      paid: true,
      local: false,
      paidEstimateUsd: 0.002,
      onPaidCost: (usd, exact) => reported.push({ usd, exact }),
    });
    assert.deepEqual(reported, [{ usd: 0.002, exact: false }], "no usage -> the reserved estimate stands, and says so");
  } finally {
    server.close();
  }
});

test("a local reply is never charged to the paid ledger", async () => {
  const server = await startUpstream((req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write(CONTENT_CHUNK);
    res.write('data: {"usage":{"prompt_tokens":900,"completion_tokens":100}}\n\n');
    res.write("data: [DONE]\n\n");
    res.end();
  });
  try {
    const reported = [];
    const brain = { emit: () => {} };
    const res = new FakeResponse();
    await pipeChatCompletion(brain, {}, res, upstreamUrl(server), JSON.stringify({ stream: true }), "llama is down", 3000, {
      neuron: "chat-small",
      paid: false,
      local: true,
      paidEstimateUsd: 0.002,
      onPaidCost: (usd) => reported.push(usd),
    });
    assert.deepEqual(reported, [], "the local model is free, so nothing is written");
    // The settled cost comes from the gateway's usage, never from the number
    // the app puts on its own message.
  } finally {
    server.close();
  }
});

test("a failed paid request settles nothing: no usage means no ledger line", async () => {
  const server = await startUpstream((req, res) => {
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "upstream exploded" }));
  });
  try {
    const reported = [];
    const brain = { emit: () => {} };
    const res = new FakeResponse();
    const result = await pipeChatCompletion(brain, {}, res, upstreamUrl(server), JSON.stringify({ stream: false }), "paid gateway is down", 3000, {
      neuron: "hands",
      paid: true,
      local: false,
      paidEstimateUsd: 0.002,
      onPaidCost: (usd) => reported.push(usd),
    });
    assert.equal(result.ok, false);
    assert.deepEqual(reported, [], "a refused or failed call charges nothing");
  } finally {
    server.close();
  }
});

test("a backup reply is labeled for the app and the brain log", async () => {
  const server = await startUpstream((req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write(CONTENT_CHUNK);
    res.end();
  });
  try {
    const brainRecords = [];
    const brain = { emit: (record) => brainRecords.push(record) };
    const res = new FakeResponse();
    const result = await pipeChatCompletion(
      brain,
      {},
      res,
      upstreamUrl(server),
      JSON.stringify({ stream: true }),
      "llama is down",
      3000,
      { neuron: "chat-small", brainSource: "backup", local: false },
    );
    assert.equal(result.ok, true);
    assert.equal(result.wrote, true);
    assert.equal(res.headers["X-Preyas-Brain"], "backup");
    assert.ok(brainRecords.some((record) => record.state === "done" && record.detail === "backup brain"));
    assert.ok(brainRecords.some((record) => record.state === "thinking" && record.detail === "backup brain"));
  } finally {
    server.close();
  }
});
