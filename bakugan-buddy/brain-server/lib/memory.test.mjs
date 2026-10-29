import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openMemory, relevantFacts, rememberFacts } from "./memory.mjs";

test("sqlite memory keeps a bounded set and recalls the overlapping fact", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "preyas-mem-"));
  const book = openMemory(path.join(dir, "facts.sqlite"));
  assert.equal(book.vec, false);
  const many = [];
  for (let i = 0; i < 42; i++) many.push({ text: `event ${i} happened`, kind: "event" });
  many.push({ text: "The partner likes tea by the window.", kind: "user" });
  rememberFacts(book, many);
  const recalled = relevantFacts(book, "tea window", 2);
  assert.equal(recalled[0], "The partner likes tea by the window.");
  const stored = book.db.prepare("SELECT COUNT(*) AS n FROM facts").get();
  assert.ok(stored.n <= 40);
  book.db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
