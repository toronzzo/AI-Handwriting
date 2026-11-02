import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  MAX_TEXT_BYTES,
  cachePath,
  chunkText,
  documentKind,
  extractDocumentText,
  listDocuments,
  pdfTextFromBuffer,
  pickRelevantChunks,
  readDocumentText,
  safeDocumentName,
} from "./documents.mjs";
import { keyPointsFrom, summarizeDocument } from "./docSummary.mjs";

function inbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "preyas-docs-"));
  return { root, done: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test("a document name can never point at a path", () => {
  assert.equal(safeDocumentName("report.pdf"), "report.pdf");
  assert.equal(safeDocumentName("  notes.md  "), "notes.md");
  for (const bad of ["../secrets.env", "a/b.txt", "..", ".", "", "x/../y.txt", "dir/", "a\\b.txt"]) {
    assert.throws(() => safeDocumentName(bad), /document name|empty/, bad);
  }
});

test("document kinds come from the extension", () => {
  assert.equal(documentKind("a.txt"), "text");
  assert.equal(documentKind("a.md"), "markdown");
  assert.equal(documentKind("a.pdf"), "pdf");
  assert.equal(documentKind("a.docx"), "word");
  assert.equal(documentKind("a.rtf"), "word");
  assert.equal(documentKind("a.png"), "other");
});

test("the inbox lists readable documents only, newest first", () => {
  const { root, done } = inbox();
  try {
    fs.writeFileSync(path.join(root, "old.md"), "# old");
    fs.writeFileSync(path.join(root, "new.txt"), "new");
    fs.writeFileSync(path.join(root, "photo.png"), "x");
    fs.writeFileSync(path.join(root, ".hidden.txt"), "x");
    fs.mkdirSync(path.join(root, "folder.txt"));
    fs.utimesSync(path.join(root, "old.md"), new Date(1000), new Date(1000));
    fs.utimesSync(path.join(root, "new.txt"), new Date(2000), new Date(2000));
    const listed = listDocuments(root);
    assert.deepEqual(listed.map((row) => row.name), ["new.txt", "old.md"]);
    assert.equal(listed[0].type, "txt");
    assert.ok(listed[0].modified >= 1900);
  } finally {
    done();
  }
});

test("txt and md are read as-is, capped at the text limit", async () => {
  const { root, done } = inbox();
  try {
    fs.writeFileSync(path.join(root, "a.txt"), "hello   world\n\nsecond line\n");
    fs.writeFileSync(path.join(root, "b.md"), "# Title\n\nBody text.");
    assert.equal(await extractDocumentText("a.txt", { inbox: root }), "hello   world\n\nsecond line");
    assert.equal(await extractDocumentText("b.md", { inbox: root }), "# Title\n\nBody text.");
    fs.writeFileSync(path.join(root, "big.txt"), "a".repeat(MAX_TEXT_BYTES + 500));
    const big = await extractDocumentText("big.txt", { inbox: root });
    assert.ok(big.length <= MAX_TEXT_BYTES + 1);
    await assert.rejects(() => extractDocumentText("missing.txt", { inbox: root }));
  } finally {
    done();
  }
});

test("chunks stay inside the context budget and keep whole words", () => {
  const text = Array.from({ length: 60 }, (_, index) => `Paragraph ${index}. ` + "word ".repeat(80)).join("\n\n");
  const chunks = chunkText(text, 4000);
  assert.ok(chunks.length > 1);
  for (const chunk of chunks) {
    assert.ok(chunk.length <= 4000, `chunk of ${chunk.length} is too big`);
    assert.doesNotMatch(chunk, /\s$/);
  }
  assert.deepEqual(chunkText("short"), ["short"]);
  assert.deepEqual(chunkText("   "), []);
});

test("a question picks the chunk that mentions its words", () => {
  const chunks = ["apples and pears", "the rent is due in April", "nothing here"];
  assert.deepEqual(pickRelevantChunks(chunks, "when is the rent due?", 1), ["the rent is due in April"]);
  assert.deepEqual(pickRelevantChunks(chunks, "", 2), chunks.slice(0, 2));
});

test("a PDF content stream yields its text", () => {
  const pdf = fs.readFileSync(path.join(import.meta.dirname, "fixtures", "sample.pdf"));
  const text = pdfTextFromBuffer(pdf);
  assert.match(text, /Bakugan launch plan/);
  assert.match(text, /March 3/);
});

test("extraction is cached by path and mtime", async () => {
  const { root, done } = inbox();
  const cacheRoot = path.join(root, "cache");
  try {
    fs.writeFileSync(path.join(root, "note.txt"), "first version");
    let calls = 0;
    const extract = async (name) => {
      calls += 1;
      return fs.readFileSync(path.join(root, name), "utf8");
    };
    const first = await readDocumentText("note.txt", { inbox: root, cacheRoot, extract });
    assert.equal(first.cached, false);
    const second = await readDocumentText("note.txt", { inbox: root, cacheRoot, extract });
    assert.equal(second.cached, true);
    assert.equal(calls, 1);
    // Rewriting the file changes mtime, so the cache must miss.
    fs.writeFileSync(path.join(root, "note.txt"), "second version");
    fs.utimesSync(path.join(root, "note.txt"), new Date(Date.now() + 5000), new Date(Date.now() + 5000));
    const third = await readDocumentText("note.txt", { inbox: root, cacheRoot, extract });
    assert.equal(third.cached, false);
    assert.equal(third.text, "second version");
    assert.equal(calls, 2);
    assert.ok(fs.existsSync(cachePath("note.txt", third.mtime)));
  } finally {
    done();
  }
});

test("a long document is summarised chunk by chunk, then merged", async () => {
  const text = Array.from({ length: 40 }, (_, index) => `Chunk body ${index}. ` + "detail ".repeat(120)).join("\n\n");
  const calls = [];
  const fakeFetch = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body.messages[1].content);
    const isMerge = body.messages[0].content.includes("merge partial summaries");
    const content = isMerge ? "- Merged point\n- Second point\nIn short: done." : "- point from part";
    return { ok: true, json: async () => ({ choices: [{ message: { content } }] }) };
  };
  const progress = [];
  const summary = await summarizeDocument(text, {
    llamaUrl: "http://llama",
    chunkSize: 3000,
    fetchImpl: fakeFetch,
    onProgress: (done, total) => progress.push(`${done}/${total}`),
  });
  assert.match(summary, /Merged point/);
  assert.ok(calls.length >= 3, "at least two parts and a merge");
  assert.ok(progress.length >= 2);
  assert.match(progress[0], /^1\/\d+$/);
});

test("key points become notes with a guessed kind", () => {
  const points = keyPointsFrom("- Deadline: ship the arena by March 3\n- We decided to use the local model\n- TODO: call the venue\nIn short: all good.");
  assert.equal(points.length, 3);
  assert.equal(points[0].kind, "deadline");
  assert.equal(points[1].kind, "decision");
  assert.equal(points[2].kind, "todo");
  assert.ok(!points.some((point) => /all good/i.test(point.text)));
});
