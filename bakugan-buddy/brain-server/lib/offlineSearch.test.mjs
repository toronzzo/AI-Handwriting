import test from "node:test";
import assert from "node:assert/strict";
import {
  isLoopbackUrl,
  parseKiwixSearchJson,
  proxyOfflineImage,
  searchOffline,
} from "./offlineSearch.mjs";

test("parseKiwixSearchJson supports suggestions and results", () => {
  const rows = parseKiwixSearchJson({
    suggestions: [
      { title: "Mars", description: "Fourth planet", url: "/wikipedia_en_astronomy/Mars", image: "/I/mars.jpg" },
      { title: "Mars", description: "duplicate", url: "/wikipedia_en_astronomy/Mars" },
    ],
  }, 5);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, "Mars");
  assert.equal(rows[0].snippet, "Fourth planet");
});

test("searchOffline normalizes and proxies image URLs", async () => {
  const result = await searchOffline("Mars", {
    fetchImpl: async () => ({ ok: true, json: async () => ({
      results: [{ title: "Mars", text: "Red planet", url: "/A/Mars", imageUrl: "/I/mars.jpg", pack: "Wikipedia" }],
    }) }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.results[0].offline, true);
  assert.match(result.results[0].imageUrl, /^\/v1\/offline\/image\?path=/);
  assert.match(result.results[0].sourceLabel, /Offline/);
});

test("searchOffline rejects non-loopback service URLs", async () => {
  const result = await searchOffline("Mars", {
    baseUrl: "http://example.com",
    fetchImpl: async () => ({ ok: true }),
  });
  assert.equal(result.ok, false);
});

test("searchOffline handles unavailable kiwix", async () => {
  const result = await searchOffline("Mars", {
    fetchImpl: async () => { throw new Error("connection refused"); },
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.results, []);
});

test("loopback image proxy rejects remote hosts", () => {
  assert.equal(isLoopbackUrl("http://127.0.0.1:8791/I/mars.jpg"), true);
  assert.equal(isLoopbackUrl("http://example.com/I/mars.jpg"), false);
});

test("proxyOfflineImage validates type and size", async () => {
  const bytes = Buffer.from([1, 2, 3]);
  const result = await proxyOfflineImage("/I/mars.png", {
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: { get: () => "image/png" },
      arrayBuffer: async () => bytes,
    }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.type, "image/png");
});
