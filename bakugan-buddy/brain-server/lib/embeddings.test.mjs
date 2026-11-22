import assert from "node:assert/strict";
import test from "node:test";
import { CONNECT_TIMEOUT_MS } from "./netTimeout.mjs";
import { embeddingsEndpoint, embedText, embedTexts } from "./embeddings.mjs";

const URL = "http://192.168.31.88:8792/v1/embeddings";

function vector(seed, length = 4) {
  return Array.from({ length }, (_, index) => seed + index / 10);
}

test("an unset EMBEDDINGS_URL returns null and does not connect", async () => {
  let called = false;
  const rows = await embedTexts(["hello"], {
    env: {},
    connect: async () => {
      called = true;
      return true;
    },
  });
  assert.equal(rows, null);
  assert.equal(called, false);
  assert.equal(embeddingsEndpoint({}), "");
  assert.equal(embeddingsEndpoint({ EMBEDDINGS_URL: "http://192.168.31.88:8792" }), URL);
  assert.equal(embeddingsEndpoint({ EMBEDDINGS_URL: `${URL}/` }), URL);
});

test("a reachable helper returns one vector per input", async () => {
  const seen = [];
  const rows = await embedTexts(["alpha", "beta"], {
    env: { EMBEDDINGS_URL: URL, EMBEDDINGS_MODEL: "qwen3-embedding-0.6b" },
    connect: async () => true,
    fetchImpl: async (url, init) => {
      seen.push({ url, body: JSON.parse(init.body) });
      return {
        ok: true,
        json: async () => ({
          data: [
            { index: 1, embedding: vector(2) },
            { index: 0, embedding: vector(1, 1024) },
          ],
        }),
      };
    },
  });
  assert.equal(seen[0].url, URL);
  assert.equal(seen[0].body.model, "qwen3-embedding-0.6b");
  assert.deepEqual(seen[0].body.input, ["alpha", "beta"]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].length, 1024);
  assert.equal(rows[1][0], 2);
  const one = await embedText("alpha", {
    env: { EMBEDDINGS_URL: URL },
    connect: async () => true,
    fetchImpl: async () => ({ ok: true, json: async () => ({ data: [{ embedding: vector(1) }] }) }),
  });
  assert.deepEqual(one, vector(1));
});

test("an unreachable helper, a bad body, and a failed request all return null", async () => {
  const env = { EMBEDDINGS_URL: URL };
  assert.equal(await embedTexts(["hello"], { env, connect: async () => false, fetchImpl: async () => { throw new Error("no"); } }), null);
  let timeoutSeen = 0;
  assert.equal(
    await embedText("hello", {
      env,
      connect: async (_url, timeoutMs) => {
        timeoutSeen = timeoutMs;
        return false;
      },
    }),
    null,
  );
  assert.equal(timeoutSeen, CONNECT_TIMEOUT_MS);
  assert.equal(
    await embedText("hello", {
      env,
      connect: async () => true,
      fetchImpl: async () => ({ ok: false, json: async () => ({}) }),
    }),
    null,
  );
  assert.equal(
    await embedText("hello", {
      env,
      connect: async () => true,
      fetchImpl: async () => {
        throw new Error("reset");
      },
    }),
    null,
  );
  assert.equal(
    await embedText("hello", {
      env,
      connect: async () => true,
      fetchImpl: async () => ({ ok: true, json: async () => ({ data: [{ embedding: [1, Number.NaN] }] }) }),
    }),
    null,
  );
  assert.equal(await embedTexts(["  ", ""], { env, connect: async () => true }), null);
});
