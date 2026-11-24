/// <reference types="node" />
import assert from "node:assert/strict";
import test from "node:test";
import { parseInline, parseMarkdown } from "./md.ts";

test("empty text has no blocks", () => {
  assert.deepEqual(parseMarkdown(""), []);
  assert.deepEqual(parseMarkdown("   \n\n "), []);
});

test("emphasis, code and links become runs, and plain words stay together", () => {
  assert.deepEqual(parseInline("say **hi** to \`x\` and [me](https://a.b)"), [
    { kind: "text", text: "say " },
    { kind: "bold", text: "hi" },
    { kind: "text", text: " to " },
    { kind: "code", text: "x" },
    { kind: "text", text: " and " },
    { kind: "link", text: "me", href: "https://a.b" },
  ]);
  assert.deepEqual(parseInline("a *b* c"), [
    { kind: "text", text: "a " },
    { kind: "italic", text: "b" },
    { kind: "text", text: " c" },
  ]);
});

test("an unclosed marker is just text", () => {
  assert.deepEqual(parseInline("2 * 3 = 6"), [{ kind: "text", text: "2 * 3 = 6" }]);
  assert.deepEqual(parseInline("**open"), [{ kind: "text", text: "**open" }]);
});

test("headings keep their level", () => {
  assert.deepEqual(parseMarkdown("# One\n## Two\n### Three"), [
    { kind: "h", level: 1, inlines: [{ kind: "text", text: "One" }] },
    { kind: "h", level: 2, inlines: [{ kind: "text", text: "Two" }] },
    { kind: "h", level: 3, inlines: [{ kind: "text", text: "Three" }] },
  ]);
});

test("bullets and numbers become lists", () => {
  assert.deepEqual(parseMarkdown("- a\n- b"), [
    { kind: "ul", items: [[{ kind: "text", text: "a" }], [{ kind: "text", text: "b" }]] },
  ]);
  assert.deepEqual(parseMarkdown("1. one\n2. two"), [
    { kind: "ol", items: [[{ kind: "text", text: "one" }], [{ kind: "text", text: "two" }]] },
  ]);
});

test("a fenced block keeps its lines and language", () => {
  assert.deepEqual(parseMarkdown("before\n\`\`\`js\nlet a = 1\nlet b = 2\n\`\`\`\nafter"), [
    { kind: "p", inlines: [{ kind: "text", text: "before" }] },
    { kind: "code", lang: "js", text: "let a = 1\nlet b = 2" },
    { kind: "p", inlines: [{ kind: "text", text: "after" }] },
  ]);
});

test("a paragraph joins its soft-wrapped lines", () => {
  assert.deepEqual(parseMarkdown("one\ntwo"), [{ kind: "p", inlines: [{ kind: "text", text: "one two" }] }]);
});
