import assert from "node:assert/strict";
import test from "node:test";
import {
  citedSourceEntries,
  htmlToText,
  isPrivateHost,
  needsWebSearch,
  parseDuckDuckGoHtml,
  searchQueryFrom,
  shouldWebSearch,
  shouldOfflineSearch,
  sourcesPrompt,
  unwrapDuckDuckGoUrl,
  withSources,
} from "./webSearch.ts";

test("offline library topics prefer Kiwix", () => {
  assert.equal(shouldOfflineSearch("What planet is Mars"), true);
  assert.equal(shouldOfflineSearch("how to fix a toaster"), true);
  assert.equal(shouldOfflineSearch("step-by-step repair for a bicycle"), true);
  assert.equal(shouldOfflineSearch("hello Preyas"), false);
});

test("encyclopedic and astronomy questions route to the offline library", () => {
  for (const ask of [
    "what is a supernova",
    "tell me about the Andromeda galaxy",
    "who was Galileo",
    "explain orbital mechanics",
    "how do I replace an iPhone battery",
    "ifixit guide for a MacBook fan",
    "what is the closest star",
  ]) {
    assert.equal(shouldOfflineSearch(ask), true, ask + " should look offline first");
  }
});

test("offline conditions route to the library even without topic words", () => {
  for (const ask of ["offline: what causes an eclipse", "I have no internet, tell me about Jupiter", "answer without wifi"]) {
    assert.equal(shouldOfflineSearch(ask), true, ask + " should look offline first");
  }
});

test("ordinary chat, code help and long pastes stay off the offline path", () => {
  for (const ask of [
    "hello Preyas",
    "tell me a story",
    "use big",
    "write a function that sorts a list",
    "how do I feel about today",
  ]) {
    assert.equal(shouldOfflineSearch(ask), false, ask + " should keep its existing path");
  }
  const pasted = "what is this\n".repeat(40);
  assert.equal(shouldOfflineSearch(pasted), false, "a long paste is not a lookup");
});

test("normal live questions still use web search exactly as before", () => {
  // Choosing the offline library must not change the web rules themselves.
  for (const ask of ["latest news about the election", "/search mars landing", "what's the current price of bitcoin"]) {
    assert.equal(shouldWebSearch(ask), true, ask + " should still be a web question");
  }
  assert.equal(shouldWebSearch("hi Preyas"), false);
  assert.equal(shouldWebSearch("tell me a story"), false);
});

test("plain questions do not search; fresh-information requests do", () => {
  assert.equal(shouldWebSearch("hi Preyas"), false);
  assert.equal(shouldWebSearch("tell me a story"), false);
  assert.equal(shouldWebSearch("remember the dentist on Friday"), false);
  assert.equal(shouldWebSearch("search for bakugan news"), true);
  assert.equal(shouldWebSearch("look up the latest season"), true);
  assert.equal(shouldWebSearch("/search aquos"), true);
  assert.equal(shouldWebSearch("who is Dan Kuso"), true);
  assert.equal(shouldWebSearch("price of a Bakugan toy"), true);
  assert.equal(needsWebSearch("search latest iPhone price"), true);
});

test("a long pasted block is answered, not searched", () => {
  const pasted = `# PR #32: web search\n${"Some change to the search pipeline and its tests. ".repeat(12)}\nwhat does this mean?`;
  assert.equal(shouldWebSearch(pasted), false);
  const multiline = "Here is my report:\nline two of the report\nline three — what does this mean?";
  assert.equal(shouldWebSearch(multiline), false);
  // ...unless the user explicitly asks for a search.
  assert.equal(shouldWebSearch(`${pasted} search what others say about it`), true);
});

test("questions about our own world never search", () => {
  assert.equal(shouldWebSearch("what did I say about the dentist?"), false);
  assert.equal(shouldWebSearch("what are my reminders today?"), false);
  assert.equal(shouldWebSearch("show me my notes about work"), false);
  assert.equal(shouldWebSearch("quiz me on the study deck"), false);
  assert.equal(shouldWebSearch("summarize the document in my vault"), false);
});

test("small talk and short follow-ups never search", () => {
  assert.equal(shouldWebSearch("yes"), false);
  assert.equal(shouldWebSearch("why"), false);
  assert.equal(shouldWebSearch("go on"), false);
  assert.equal(shouldWebSearch("how are you feeling today?"), false);
});

test("fresh real-world questions do search", () => {
  assert.equal(shouldWebSearch("search latest iPhone price"), true);
  assert.equal(shouldWebSearch("what's the weather in Warsaw today"), true);
  assert.equal(shouldWebSearch("any news about the election"), true);
});

test("only sources the reply cites are shown, with their numbers", () => {
  const results = [
    { title: "One", url: "https://a.example/1", snippet: "first" },
    { title: "Two", url: "https://b.example/2", snippet: "second" },
    { title: "Three", url: "https://c.example/3", snippet: "third" },
  ];
  const cited = citedSourceEntries("It starts in March [1] and the guide agrees [3].", results);
  assert.deepEqual(
    cited.map((entry) => [entry.n, entry.source.title]),
    [[1, "One"], [3, "Three"]],
  );
  // A reply built only on pasted text shows no sources at all.
  assert.deepEqual(citedSourceEntries("The PR adds search and caching.", results), []);
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
