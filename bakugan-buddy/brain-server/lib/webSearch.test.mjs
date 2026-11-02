import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  htmlToText,
  isFetchableUrl,
  isPrivateHost,
  needsWebSearch,
  parseDuckDuckGoHtml,
  searchQueryFrom,
  sourcesPrompt,
  unwrapDuckDuckGoUrl,
  withSources,
} from "../../packages/alive/src/webSearch.ts";
import { CACHE_TTL_MS, fetchPageText, readCache, searchWeb, writeCache } from "./webSearch.mjs";

const FIXTURE = path.join(import.meta.dirname, "fixtures", "duckduckgo.html");
const sample = () => fs.readFileSync(FIXTURE, "utf8");

test("the saved DuckDuckGo page parses into titled, unwrapped results", () => {
  const results = parseDuckDuckGoHtml(sample(), 5);
  assert.equal(results.length, 4, "private link and duplicate are dropped");
  assert.equal(results[0].title, "Bakugan & the New Season");
  assert.equal(results[0].url, "https://www.bakugan.com/release");
  assert.match(results[0].snippet, /starts on March 3/);
  assert.equal(results[1].url, "https://example.org/guide?id=7&ref=x");
  assert.equal(results[2].url, "https://plain.example.net/no-wrapper");
  assert.equal(results[3].url, "https://news.example.com/story");
  assert.equal(parseDuckDuckGoHtml(sample(), 1).length, 1);
  assert.deepEqual(parseDuckDuckGoHtml("<html><body>nothing</body></html>"), []);
});

test("DuckDuckGo redirect links are unwrapped to the real target", () => {
  assert.equal(
    unwrapDuckDuckGoUrl("//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa%3Fb%3D1"),
    "https://example.com/a?b=1",
  );
  assert.equal(
    unwrapDuckDuckGoUrl("https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fx&amp;rut=y"),
    "https://example.com/x",
  );
  assert.equal(unwrapDuckDuckGoUrl("https://example.com/plain"), "https://example.com/plain");
  assert.equal(unwrapDuckDuckGoUrl(""), "");
});

test("private and loopback hosts are never fetchable", () => {
  for (const host of ["localhost", "127.0.0.1", "10.0.0.5", "192.168.1.2", "172.16.0.1", "172.31.255.255", "169.254.1.1", "::1", "[::1]", "fe80::1", "100.64.1.1", "router.local"]) {
    assert.equal(isPrivateHost(host), true, `${host} must be private`);
  }
  for (const host of ["example.com", "8.8.8.8", "172.32.0.1", "duckduckgo.com"]) {
    assert.equal(isPrivateHost(host), false, `${host} must be public`);
  }
  assert.equal(isFetchableUrl("http://127.0.0.1:8080/x"), false);
  assert.equal(isFetchableUrl("http://localhost/x"), false);
  assert.equal(isFetchableUrl("ftp://example.com/x"), false);
  assert.equal(isFetchableUrl("file:///etc/passwd"), false);
  assert.equal(isFetchableUrl("https://example.com/x"), true);
});

test("search triggers only for messages that want outside information", () => {
  for (const text of [
    "search bakugan news",
    "look up the latest Bakugan season",
    "what is the latest version of llama.cpp",
    "price of a new MacBook",
    "who is Dan Kuso",
    "/search aquos attributes",
    "what's in the news today",
  ]) {
    assert.equal(needsWebSearch(text), true, text);
  }
  for (const text of [
    "tell me a story",
    "remember the dentist on Friday",
    "what did I say about the dentist?",
    "plan my week from my notes",
    "hi Preyas",
    "",
  ]) {
    assert.equal(needsWebSearch(text), false, text);
  }
});

test("the query keeps the words and drops the /search prefix", () => {
  assert.equal(searchQueryFrom("/search bakugan season"), "bakugan season");
  assert.equal(searchQueryFrom("  search   for   me  "), "search for me");
  assert.equal(searchQueryFrom("/search"), "");
});

test("sources are numbered and the citation rule travels with them", () => {
  const results = [
    { title: "First", url: "https://a.example/1", snippet: "one" },
    { title: "Second", url: "https://b.example/2", snippet: "two" },
  ];
  const prompt = sourcesPrompt("bakugan", results);
  assert.match(prompt, /\[1\] First/);
  assert.match(prompt, /\[2\] Second/);
  assert.match(prompt, /cite the number/);
  const user = withSources("what is new?", "bakugan", results);
  assert.match(user, /They said: what is new\?/);
  assert.equal(withSources("plain", "q", []), "plain");
});

test("page HTML becomes capped plain text", () => {
  const text = htmlToText("<html><head><style>x{}</style></head><body><h1>Hi</h1><script>bad()</script><p>Body &amp; more</p></body></html>");
  assert.match(text, /Hi/);
  assert.match(text, /Body & more/);
  assert.doesNotMatch(text, /bad\(\)/);
  assert.ok(htmlToText("<p>" + "a".repeat(9000) + "</p>", 6000).length <= 6001);
});

test("results are cached for an hour, then expire", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "preyas-search-"));
  try {
    const results = [{ title: "t", url: "https://e.example/1", snippet: "s" }];
    writeCache(root, "Bakugan Season", results, 1000);
    assert.deepEqual(readCache(root, "bakugan season", 1000 + CACHE_TTL_MS - 1), results);
    assert.equal(readCache(root, "bakugan season", 1000 + CACHE_TTL_MS + 1), null);
    assert.equal(readCache(root, "never asked", 1000), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a search uses the cache, and a network failure is reported not thrown", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "preyas-search-"));
  try {
    writeCache(root, "bakugan", [{ title: "old", url: "https://e.example/1", snippet: "s" }]);
    const cached = await searchWeb("bakugan", { root });
    assert.equal(cached.ok, true);
    assert.equal(cached.cached, true);
    assert.equal(cached.results[0].title, "old");

    const offline = await searchWeb("something else", {
      root,
      fetchImpl: async () => {
        throw new Error("no internet");
      },
    });
    assert.equal(offline.ok, false);
    assert.match(offline.error, /no internet/);
    assert.deepEqual(offline.results, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a search parses a live-shaped response through the fetch seam", async () => {
  let asked = "";
  const result = await searchWeb("bakugan release", {
    fetchImpl: async (url) => {
      asked = String(url);
      return { ok: true, text: async () => sample() };
    },
  });
  assert.match(asked, /^https:\/\/html\.duckduckgo\.com\/html\/\?q=bakugan%20release$/);
  assert.equal(result.ok, true);
  assert.equal(result.results.length, 4);
  assert.equal(result.results[0].url, "https://www.bakugan.com/release");
});

test("page fetch refuses private targets before any request", async () => {
  let called = false;
  const denied = await fetchPageText("http://127.0.0.1:8080/admin", {
    fetchImpl: async () => {
      called = true;
      return { ok: true, text: async () => "secret" };
    },
  });
  assert.equal(denied.ok, false);
  assert.equal(called, false);
});
