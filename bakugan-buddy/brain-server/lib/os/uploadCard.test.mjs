import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { formatBytes, lastNavigationUrl, uploadCardDetail } from "./uploadCard.mjs";

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "preyas-upload-"));
}

test("formatBytes renders file sizes readably", () => {
  assert.equal(formatBytes(0), "0 B");
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(1024), "1 KB");
  assert.equal(formatBytes(1536), "1.5 KB");
  assert.equal(formatBytes(1024 * 1024), "1 MB");
});

test("the upload card lists every file's name, full path, size and the site", () => {
  const root = tempDir();
  try {
    const notes = path.join(root, "notes");
    fs.mkdirSync(notes, { recursive: true });
    fs.writeFileSync(path.join(notes, "a.md"), "hello world\n"); // 12 bytes
    fs.writeFileSync(path.join(root, "scan.pdf"), "x".repeat(2048)); // 2 KB
    const task = {
      steps: [
        { tool: { name: "browser_navigate", args: { url: "https://example.com/contact" } } },
        { tool: { name: "browser_snapshot", args: {} } },
        { tool: { name: "browser_click", args: { element: "file input", ref: "e1" } } },
      ],
    };
    const detail = uploadCardDetail(
      { paths: [path.join(notes, "a.md"), path.join(root, "scan.pdf")] },
      { fsRoot: root, repoRoot: "", task },
    );
    assert.match(detail, /Uploading 2 files to https:\/\/example\.com\/contact:/);
    assert.match(detail, /a\.md/);
    assert.match(detail, new RegExp(path.join(notes, "a.md").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(detail, /12 B/);
    assert.match(detail, /scan\.pdf/);
    assert.match(detail, /2 KB/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("the site is the last page the task opened, files come first in the list order", () => {
  const root = tempDir();
  try {
    fs.writeFileSync(path.join(root, "one.txt"), "1");
    const detail = uploadCardDetail({ paths: [path.join(root, "one.txt")] }, { fsRoot: root, task: { steps: [] } });
    assert.match(detail, /Uploading 1 file:/);
    assert.match(detail, /one\.txt/);
    assert.doesNotMatch(detail, / to /);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a file that cannot be resolved still appears, without a size", () => {
  const root = tempDir();
  try {
    const detail = uploadCardDetail({ paths: [path.join(root, "ghost.txt")] }, { fsRoot: root, task: null });
    assert.match(detail, /ghost\.txt/);
    assert.doesNotMatch(detail, /ghost\.txt \(/, "no size suffix follows an unresolvable file");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("lastNavigationUrl takes the most recent browser_navigate step", () => {
  const task = {
    steps: [
      { tool: { name: "browser_navigate", args: { url: "https://first.example/" } } },
      { tool: { name: "browser_snapshot", args: {} } },
      { tool: { name: "browser_navigate", args: { url: "https://second.example/form" } } },
    ],
  };
  assert.equal(lastNavigationUrl(task), "https://second.example/form");
  assert.equal(lastNavigationUrl({ steps: [] }), "");
});
