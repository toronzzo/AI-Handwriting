import assert from "node:assert/strict";
import test from "node:test";
import { BACKUP_BRAIN, BACKUP_SOURCE, CONNECT_TIMEOUT_MS, createLlamaRouter, HEALTH_TTL_MS } from "./llamaFallback.mjs";
import { CONNECT_TIMEOUT_MS as NET_CONNECT_TIMEOUT_MS } from "./netTimeout.mjs";

const LOCAL = "http://127.0.0.1:8790";
const LAPTOP = "http://192.168.31.88:8790";

function router(overrides = {}) {
  return createLlamaRouter({
    env: { LLAMA_URL: LOCAL, LLAMA_FALLBACK_URL: LAPTOP },
    connect: async () => true,
    ...overrides,
  });
}

test("with no fallback URL the local brain is used and /health is never probed", async () => {
  let probed = false;
  const calls = [];
  const gate = createLlamaRouter({
    env: { LLAMA_URL: LOCAL },
    fetchImpl: async () => {
      probed = true;
      return { ok: false };
    },
  });
  const result = await gate.run(async (url, source) => {
    calls.push({ url, source });
    return { ok: true, wrote: true };
  });
  assert.equal(probed, false);
  assert.equal(result.source, "local");
  assert.deepEqual(calls, [{ url: LOCAL, source: "local" }]);
  assert.equal(BACKUP_BRAIN, "backup brain");
  assert.equal(CONNECT_TIMEOUT_MS, NET_CONNECT_TIMEOUT_MS);
});

test("a down /health sends the turn to the backup brain", async () => {
  let healthCalls = 0;
  const calls = [];
  const gate = router({
    fetchImpl: async (url) => {
      healthCalls += 1;
      assert.match(String(url), /\/health$/);
      return { ok: false };
    },
  });
  const result = await gate.run(async (url, source) => {
    calls.push({ url, source });
    return { ok: true, wrote: true };
  });
  assert.equal(result.source, BACKUP_SOURCE);
  assert.equal(result.ok, true);
  assert.deepEqual(calls, [{ url: LAPTOP, source: "backup" }]);
  assert.equal(healthCalls, 1);
});

test("the health check is cached so the next turn does not probe", async () => {
  let now = 1_000;
  let healthCalls = 0;
  const gate = router({
    now: () => now,
    ttlMs: HEALTH_TTL_MS,
    fetchImpl: async () => {
      healthCalls += 1;
      return { ok: true };
    },
  });
  const first = await gate.run(async (_url, source) => ({ ok: true, wrote: true, source }));
  const second = await gate.run(async (_url, source) => ({ ok: true, wrote: true, source }));
  assert.equal(first.source, "local");
  assert.equal(second.source, "local");
  assert.equal(healthCalls, 1);
  now += HEALTH_TTL_MS;
  await gate.run(async () => ({ ok: true, wrote: true }));
  assert.equal(healthCalls, 2);
});

test("a failed local request is retried once on the fallback and marked backup", async () => {
  const calls = [];
  const gate = router({
    fetchImpl: async () => ({ ok: true }),
  });
  const result = await gate.run(async (url, source) => {
    calls.push({ url, source });
    if (source === "local") return { ok: false, wrote: false };
    return { ok: true, wrote: true };
  });
  assert.deepEqual(calls, [
    { url: LOCAL, source: "local" },
    { url: LAPTOP, source: "backup" },
  ]);
  assert.equal(result.source, "backup");
  assert.equal(result.ok, true);
});

test("a thrown local request is the same single retry", async () => {
  const calls = [];
  const gate = router({ fetchImpl: async () => ({ ok: true }) });
  const result = await gate.run(async (_url, source) => {
    calls.push(source);
    if (source === "local") throw new Error("connect ECONNREFUSED");
    return { ok: true, wrote: true };
  });
  assert.deepEqual(calls, ["local", "backup"]);
  assert.equal(result.source, "backup");
});

test("a reply that already reached the client is not sent twice", async () => {
  const calls = [];
  const gate = router({ fetchImpl: async () => ({ ok: true }) });
  const result = await gate.run(async (_url, source) => {
    calls.push(source);
    return { ok: false, wrote: true };
  });
  assert.deepEqual(calls, ["local"]);
  assert.equal(result.source, "local");
  assert.equal(result.wrote, true);
});

test("the client leaving is not a failover", async () => {
  const calls = [];
  const gate = router({ fetchImpl: async () => ({ ok: true }) });
  const result = await gate.run(async (_url, source) => {
    calls.push(source);
    return { ok: false, wrote: false, clientClosed: true };
  });
  assert.deepEqual(calls, ["local"]);
  assert.equal(result.clientClosed, true);
});

test("after a failed local request the next turn skips /health and uses the backup", async () => {
  let healthCalls = 0;
  const sources = [];
  const gate = router({
    fetchImpl: async () => {
      healthCalls += 1;
      return { ok: true };
    },
  });
  await gate.run(async (_url, source) => {
    sources.push(source);
    if (source === "local") return { ok: false, wrote: false };
    return { ok: true, wrote: true };
  });
  await gate.run(async (_url, source) => {
    sources.push(source);
    return { ok: true, wrote: true };
  });
  assert.equal(healthCalls, 1);
  assert.deepEqual(sources, ["local", "backup", "backup"]);
});

test("a health probe that never answers counts as down within its timeout", async () => {
  const gate = router({
    healthTimeoutMs: 40,
    fetchImpl: (_url, init) =>
      new Promise((resolve, reject) => {
        // A ref'd timer keeps the loop alive. AbortSignal.timeout itself does
        // not, so without this the probe would look hung when nothing else is scheduled.
        const giveUp = setTimeout(() => resolve({ ok: true }), 500);
        const signal = init && init.signal;
        if (!signal) return;
        signal.addEventListener("abort", () => {
          clearTimeout(giveUp);
          reject(signal.reason || new Error("aborted"));
        });
      }),
  });
  const started = Date.now();
  const result = await gate.run(async (_url, source) => {
    assert.equal(source, "backup");
    return { ok: true, wrote: true };
  });
  assert.equal(result.source, "backup");
  assert.ok(Date.now() - started < 500, "the hung probe was not waited out");
});

test("a sleeping backup laptop is skipped after the connect budget", async () => {
  const calls = [];
  let seenTimeout = 0;
  const gate = router({
    fetchImpl: async () => ({ ok: false }),
    connect: async (url, timeoutMs) => {
      seenTimeout = timeoutMs;
      assert.match(String(url), /192\.168\.31\.88/);
      return false;
    },
  });
  const result = await gate.run(async (_url, source) => {
    calls.push(source);
    return { ok: true, wrote: true };
  });
  assert.deepEqual(calls, []);
  assert.equal(result.ok, false);
  assert.equal(result.wrote, false);
  assert.equal(result.source, "backup");
  assert.equal(seenTimeout, 3_000);
});
