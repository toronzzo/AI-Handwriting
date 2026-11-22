import assert from "node:assert/strict";
import test from "node:test";
import { CONNECT_TIMEOUT_MS, connectWithTimeout, endpointOf } from "./netTimeout.mjs";

test("the connect budget is about three seconds", () => {
  assert.equal(CONNECT_TIMEOUT_MS, 3_000);
  assert.deepEqual(endpointOf("http://192.168.31.88:8178/inference"), { host: "192.168.31.88", port: 8178 });
  assert.equal(endpointOf("http://example.com/v1/embeddings").port, 80);
});

test("a handshake that arrives in time counts as reachable", async () => {
  let ended = false;
  const netImpl = {
    connect() {
      const socket = {
        once(event, cb) {
          if (event === "connect") queueMicrotask(cb);
          return socket;
        },
        end() {
          ended = true;
        },
        destroy() {},
      };
      return socket;
    },
  };
  const ok = await connectWithTimeout("http://192.168.31.88:8790/health", 3_000, netImpl);
  assert.equal(ok, true);
  assert.equal(ended, true);
});

test("a sleeping host is abandoned and the socket is destroyed", async () => {
  let destroyed = false;
  const netImpl = {
    connect() {
      const handlers = {};
      const socket = {
        once(event, cb) {
          handlers[event] = cb;
          return socket;
        },
        end() {},
        destroy() {
          destroyed = true;
          if (handlers.error) handlers.error();
        },
      };
      setTimeout(() => {
        if (handlers.connect) handlers.connect();
      }, 500);
      return socket;
    },
  };
  const started = Date.now();
  const ok = await connectWithTimeout("http://192.168.31.88:8178", 40, netImpl);
  const elapsed = Date.now() - started;
  assert.equal(ok, false);
  assert.equal(destroyed, true);
  assert.ok(elapsed < 300, `connect waited ${elapsed}ms`);
});

test("a bad URL is simply unreachable", async () => {
  assert.equal(await connectWithTimeout("not a url", 20), false);
});
