import test from "node:test";
import assert from "node:assert/strict";
import {
  isLoopbackUrl,
  parseKiwixSearchJson,
  proxyOfflineArticle,
  proxyOfflineImage,
  searchOffline,
} from "./offlineSearch.mjs";

/** A fake kiwix-serve response; no sockets are opened in these tests. */
function fakeResponse(body, { ok = true, status = 200, type = "application/json" } = {}) {
  return {
    ok,
    status,
    headers: { get: (name) => (name.toLowerCase() === "content-type" ? type : null) },
    json: async () => body,
    arrayBuffer: async () => (typeof body === "string" ? Buffer.from(body) : Buffer.from(body)),
    text: async () => String(body),
  };
}

test("parseKiwixSearchJson reads a kiwix-serve suggestions payload", () => {
  const rows = parseKiwixSearchJson({
    suggestions: [
      { title: "Mars", description: "Fourth planet", url: "/wikipedia_en_astronomy/Mars", img: "/I/mars.jpg" },
      { title: "Mars", description: "duplicate", url: "/wikipedia_en_astronomy/Mars" },
      { title: "Moon", text: "Natural satellite", url: "/wikipedia_en_astronomy/Moon" },
    ],
  }, 5);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].title, "Mars");
  assert.equal(rows[0].snippet, "Fourth planet");
  assert.equal(rows[1].title, "Moon");
});

test("parseKiwixSearchJson strips markup and honours the result limit", () => {
  const rows = parseKiwixSearchJson({
    suggestions: [
      { title: "<b>Jupiter</b>", description: "  largest  <i>planet</i> ", url: "/A" },
      { title: "Saturn", description: "rings", url: "/B" },
      { title: "Venus", description: "hot", url: "/C" },
    ],
  }, 2);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].title, "Jupiter");
  assert.equal(rows[0].snippet, "largest planet");
});

test("parseKiwixSearchJson tolerates junk and an empty payload", () => {
  assert.deepEqual(parseKiwixSearchJson(null), []);
  assert.deepEqual(parseKiwixSearchJson({ suggestions: [null, {}, { title: "", url: "/x" }] }), []);
});

test("searchOffline returns titles, snippets, pack and proxied image urls", async () => {
  const result = await searchOffline("Mars", {
    fetchImpl: async () => fakeResponse({
      suggestions: [{ title: "Mars", description: "Red planet", url: "/A/Mars", image: "/I/mars.jpg", book: "Wikipedia" }],
    }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.results.length, 1);
  const [hit] = result.results;
  assert.equal(hit.title, "Mars");
  assert.equal(hit.snippet, "Red planet");
  assert.equal(hit.offline, true);
  assert.match(hit.sourceLabel, /Wikipedia/);
  // Both the picture and the article go through brain-server, never kiwix-serve.
  assert.match(hit.imageUrl, /^\/v1\/offline\/image\?path=/);
  assert.match(hit.url, /^\/v1\/offline\/article\?path=/);
});

test("searchOffline reports unavailable kiwix without throwing", async () => {
  const result = await searchOffline("Mars", {
    fetchImpl: async () => {
      throw new Error("connection refused");
    },
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.results, []);
  assert.match(result.error, /refused/);
});

test("searchOffline treats a non-2xx kiwix answer as unavailable", async () => {
  const result = await searchOffline("Mars", {
    fetchImpl: async () => fakeResponse({}, { ok: false, status: 503 }),
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /503/);
});

test("searchOffline rejects an empty query without calling kiwix", async () => {
  let called = false;
  const result = await searchOffline("   ", {
    fetchImpl: async () => {
      called = true;
      return fakeResponse({});
    },
  });
  assert.equal(result.ok, false);
  assert.equal(called, false);
});

test("searchOffline refuses a non-loopback kiwix server", async () => {
  const result = await searchOffline("Mars", {
    baseUrl: "http://example.com:8791",
    fetchImpl: async () => fakeResponse({}),
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /loopback/);
});

test("searchOffline passes a bounded timeout to fetch", async () => {
  let sawSignal = false;
  await searchOffline("Mars", {
    timeoutMs: 1234,
    fetchImpl: async (_url, init) => {
      sawSignal = init && init.signal instanceof AbortSignal;
      return fakeResponse({ suggestions: [] });
    },
  });
  assert.equal(sawSignal, true);
});

test("isLoopbackUrl only allows the local kiwix port", () => {
  assert.equal(isLoopbackUrl("http://127.0.0.1:8791/I/mars.jpg"), true);
  assert.equal(isLoopbackUrl("http://localhost:8791/I/mars.jpg"), true);
  assert.equal(isLoopbackUrl("http://example.com/I/mars.jpg"), false);
  assert.equal(isLoopbackUrl("http://127.0.0.1:9999/I/mars.jpg"), false);
  assert.equal(isLoopbackUrl("http://192.168.1.5:8791/I/mars.jpg"), false);
  // No port means port 80, which is some other local server, not kiwix.
  assert.equal(isLoopbackUrl("http://127.0.0.1/I/mars.jpg"), false);
  assert.equal(isLoopbackUrl(""), false);
});

test("proxyOfflineImage returns a verified png", async () => {
  const result = await proxyOfflineImage("/I/mars.png", {
    fetchImpl: async () => fakeResponse(Buffer.from([1, 2, 3]), { type: "image/png" }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.type, "image/png");
  assert.equal(result.buffer.byteLength, 3);
});

test("proxyOfflineImage rejects a non-image content type", async () => {
  const result = await proxyOfflineImage("/I/mars.png", {
    fetchImpl: async () => fakeResponse("<html>nope</html>", { type: "text/html" }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 415);
});

test("proxyOfflineImage enforces the byte limit", async () => {
  const result = await proxyOfflineImage("/I/big.jpg", {
    maxBytes: 2,
    fetchImpl: async () => fakeResponse(Buffer.from([1, 2, 3, 4]), { type: "image/jpeg" }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 413);
});

test("proxyOfflineImage refuses remote and traversal paths", async () => {
  let called = false;
  const fetchImpl = async () => {
    called = true;
    return fakeResponse(Buffer.from([1]), { type: "image/png" });
  };
  assert.equal((await proxyOfflineImage("http://evil.example/x.png", { fetchImpl })).ok, false);
  assert.equal((await proxyOfflineImage("//evil.example/x.png", { fetchImpl })).ok, false);
  assert.equal((await proxyOfflineImage("relative.png", { fetchImpl })).ok, false);
  assert.equal(called, false);
});

test("proxyOfflineArticle returns html through the loopback", async () => {
  let seen = "";
  const result = await proxyOfflineArticle("/wikipedia_en_astronomy/A/Mars", {
    fetchImpl: async (url) => {
      seen = url;
      return fakeResponse("<h1>Mars</h1>", { type: "text/html; charset=utf-8" });
    },
  });
  assert.equal(result.ok, true);
  assert.match(seen, /^http:\/\/127\.0\.0\.1:8791\//);
  assert.match(result.type, /text\/html/);
  assert.equal(result.buffer.toString("utf8"), "<h1>Mars</h1>");
});

test("proxyOfflineArticle caps the body size", async () => {
  const result = await proxyOfflineArticle("/A/Big", {
    maxBytes: 4,
    fetchImpl: async () => fakeResponse("<p>too big</p>", { type: "text/html" }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 413);
});

test("proxyOfflineArticle rejects remote, protocol-relative and bad paths", async () => {
  let called = false;
  const fetchImpl = async () => {
    called = true;
    return fakeResponse("<p>x</p>", { type: "text/html" });
  };
  assert.equal((await proxyOfflineArticle("http://evil.example/A", { fetchImpl })).ok, false);
  assert.equal((await proxyOfflineArticle("//evil.example/A", { fetchImpl })).ok, false);
  assert.equal((await proxyOfflineArticle("A/B", { fetchImpl })).ok, false);
  assert.equal((await proxyOfflineArticle("", { fetchImpl })).ok, false);
  assert.equal(called, false);
});

test("proxyOfflineArticle maps failures to non-200 statuses", async () => {
  const notFound = await proxyOfflineArticle("/A/Missing", {
    fetchImpl: async () => fakeResponse("", { ok: false, status: 404 }),
  });
  assert.equal(notFound.ok, false);
  assert.equal(notFound.status, 404);

  const down = await proxyOfflineArticle("/A/Mars", {
    fetchImpl: async () => {
      throw new Error("ECONNREFUSED");
    },
  });
  assert.equal(down.ok, false);
  assert.equal(down.status, 502);
});
