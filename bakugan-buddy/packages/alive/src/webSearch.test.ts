import assert from "node:assert/strict";
import test from "node:test";
import {
  htmlToText,
  isPrivateHost,
  needsWebSearch,
  parseDuckDuckGoHtml,
  searchQueryFrom,
  sourcesPrompt,
  unwrapDuckDuckGoUrl,
  withSources,
} from "./webSearch.ts";

test("plain questions do not search; fresh-information requests do", () => {
  assert.equal(needsWebSearch("hi Preyas"), false);
  assert.equal(needsWebSearch("tell me a story"), false);
  assert.equal(needsWebSearch("remember the dentist on Friday"), false);
  assert.equal(needsWebSearch("search for bakugan news"), true);
  assert.equal(needsWebSearch("look up the latest season"), true);
  assert.equal(needsWebSearch("/search aquos"), true);
  assert.equal(needsWebSearch("who is Dan Kuso"), true);
  assert.equal(needsWebSearch("price of a Bakugan toy"), true);
});

test("queries are cleaned and sources are numbered for citation", () => {
  assert.equal(searchQueryFrom("/search bakugan  season"), "bakugan season");
  const results = [
    { title: "One", url: "https://a.example/1", snippet: "first" },
    { title: "Two", url: "https://b.example/2", snippet: "second" },
  ];
  const prompt = sourcesPrompt("bakugan", results);
  assert.match(prompt, /\[1\] One/);
  assert.match(prompt, /\[2\] Two/);
  assert.match(withSources("what happened?", "bakugan", results), /They said: what happened\?/);
  assert.equal(withSources("nothing", "x", []), "nothing");
});

test("loopback and private addresses are refused", () => {
  assert.equal(isPrivateHost("127.0.0.1"), true);
  assert.equal(isPrivateHost("192.168.0.10"), true);
  assert.equal(isPrivateHost("10.1.2.3"), true);
  assert.equal(isPrivateHost("::1"), true);
  assert.equal(isPrivateHost("example.com"), false);
});

test("redirect unwrapping and HTML text work", () => {
  assert.equal(
    unwrapDuckDuckGoUrl("//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpage"),
    "https://example.com/page",
  );
  const results = parseDuckDuckGoHtml(
    '<div class="result"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fa.example%2F1">A</a><a class="result__snippet">snip</a></div>',
  );
  assert.deepEqual(results, [{ title: "A", url: "https://a.example/1", snippet: "snip" }]);
  assert.match(htmlToText("<p>Hello &amp; welcome</p>"), /Hello & welcome/);
});
