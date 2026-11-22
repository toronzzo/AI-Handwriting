import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { handleOsRoute } from "./routes.mjs";
import { createBrain } from "./neurons.mjs";
import { activitySummary, emptyNeuronFeed, ingestNeuronSnapshot, activeNeuronIds } from "../../../apps/mobile/src/brain/neuronActivity.ts";

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "brain-route-"));
}

/** A response fake that keeps every write and can pretend the client left. */
function fakeRes() {
  const out = { status: 0, headers: {}, writes: [], body: "", ended: false, listeners: {} };
  const res = {
    writableEnded: false,
    destroyed: false,
    writeHead(status, headers) {
      out.status = status;
      out.headers = headers || {};
    },
    write(chunk) {
      out.writes.push(String(chunk));
    },
    end(chunk) {
      out.ended = true;
      if (chunk !== undefined) {
        out.body = String(chunk);
        out.writes.push(String(chunk));
      }
    },
    on(event, cb) {
      (out.listeners[event] ||= []).push(cb);
    },
    close() {
      // node marks the response ended and the socket destroyed on "close".
      res.writableEnded = true;
      res.destroyed = true;
      for (const cb of out.listeners.close || []) cb();
    },
  };
  return { res, out };
}

function route({ pathname, dataDir, brain, res, now = 42 }) {
  const ctx = {
    req: { method: "GET" },
    url: new URL(`http://localhost${pathname}`),
    dataDir,
    brain,
    readJson: async () => ({}),
    readBody: async () => Buffer.from(""),
    now: () => new Date(now),
    res,
  };
  return ctx;
}

test("GET /v1/brain answers with every neuron and its live state", async () => {
  const dir = tempDir();
  try {
    const brain = createBrain({ dataDir: dir, now: () => 42 });
    brain.emit({ neuron: "chat-small", state: "thinking", ts: 41 });
    const { res, out } = fakeRes();
    const answered = await handleOsRoute(route({ pathname: "/v1/brain", dataDir: dir, brain, res }));
    assert.equal(answered, true);
    assert.equal(out.status, 200);
    const body = JSON.parse(out.body);
    assert.equal(body.neurons.length, 9);
    assert.equal(body.ts, 42);
    const small = body.neurons.find((neuron) => neuron.id === "chat-small");
    assert.equal(small.state, "thinking");
    assert.equal(small.ts, 41);
    assert.equal(body.neurons.find((neuron) => neuron.id === "eyes-draw").state, "missing");
    assert.equal(body.neurons.find((neuron) => neuron.id === "hands").state, "off");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the SSE stream sends a snapshot, live events, and a heartbeat every 15 s", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const dir = tempDir();
  try {
    const brain = createBrain({ dataDir: dir, now: () => 42 });
    brain.emit({ neuron: "chat-small", state: "thinking", ts: 40 });
    const { res, out } = fakeRes();
    const answered = await handleOsRoute(route({ pathname: "/v1/brain/stream", dataDir: dir, brain, res }));
    assert.equal(answered, true);
    assert.equal(out.status, 200);
    assert.match(out.headers["Content-Type"], /text\/event-stream/);
    const text = () => out.writes.join("");

    assert.match(text(), /retry: 3000/);
    assert.match(text(), /event: snapshot/);
    assert.match(text(), /"neurons":/);
    assert.match(text(), /"state":"thinking"/, "the snapshot carries the current state");
    assert.match(text(), /"state":"missing"/, "unbuilt neurons are in the snapshot too");

    brain.emit({ neuron: "chat-small", state: "done", tps: 9.4, ts: 43 });
    assert.match(text(), /event: neuron/);
    assert.match(text(), /"neuron":"chat-small"/);
    assert.match(text(), /"state":"done"/);
    assert.match(text(), /"tps":9.4/);

    const pings = () => text().split(": ping").length - 1;
    assert.equal(pings(), 0);
    t.mock.timers.tick(15_000);
    assert.equal(pings(), 1, "one heartbeat after 15 s");
    t.mock.timers.tick(15_000);
    assert.equal(pings(), 2, "two heartbeats after 30 s");

    res.close();
    t.mock.timers.tick(60_000);
    assert.equal(pings(), 2, "heartbeats stop once the client left");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the stream survives a client disconnect: no throw, other viewers keep events", async () => {
  const dir = tempDir();
  try {
    const brain = createBrain({ dataDir: dir });
    const gone = fakeRes();
    await handleOsRoute(route({ pathname: "/v1/brain/stream", dataDir: dir, brain, res: gone.res }));
    const staying = fakeRes();
    await handleOsRoute(route({ pathname: "/v1/brain/stream", dataDir: dir, brain, res: staying.res }));

    gone.res.close();
    assert.doesNotThrow(() => brain.emit({ neuron: "ears", state: "thinking", ts: 1 }));
    assert.doesNotThrow(() => brain.emit({ neuron: "ears", state: "done", ts: 2 }));

    const text = staying.out.writes.join("");
    assert.match(text, /"neuron":"ears"/, "the surviving viewer still receives events");
    assert.equal(gone.out.writes.join("").includes('"neuron":"ears"'), false, "the gone viewer receives nothing");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the app reads the real GET /v1/brain body, including rows keyed by id", async () => {
  const dir = tempDir();
  try {
    const brain = createBrain({ dataDir: dir, now: () => 42 });
    brain.emit({ neuron: "chat-small", state: "thinking", ts: 41 });
    const { res, out } = fakeRes();
    const answered = await handleOsRoute(route({ pathname: "/v1/brain", dataDir: dir, brain, res }));
    assert.equal(answered, true);
    const body = JSON.parse(out.body);
    const small = body.neurons.find((neuron) => neuron.id === "chat-small");
    assert.equal(small.id, "chat-small");
    assert.equal(Object.hasOwn(small, "neuron"), false);
    const feed = ingestNeuronSnapshot(emptyNeuronFeed(), body, 42);
    assert.deepEqual(activeNeuronIds(feed), ["chat-small"]);
    assert.equal(activitySummary(feed, 42), "Chat small");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("an unknown path still answers false", async () => {
  const { res } = fakeRes();
  const answered = await handleOsRoute(route({ pathname: "/v1/nothing", dataDir: "", res }));
  assert.equal(answered, false);
});
