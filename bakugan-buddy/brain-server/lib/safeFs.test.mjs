import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { MAX_TEXT_BYTES, UnsafePathError, listDir, readTextFile, resolveSafePath } from "./safeFs.mjs";

function drive() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "preyas-fs-"));
  return { root, done: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test("text files under the drive can be listed and read", () => {
  const { root, done } = drive();
  fs.mkdirSync(path.join(root, "projects"), { recursive: true });
  fs.writeFileSync(path.join(root, "projects", "notes.txt"), "hello there");
  const listing = listDir(".", { root });
  assert.equal(listing.entries.some((entry) => entry.name === "projects"), true);
  const file = readTextFile("projects/notes.txt", { root });
  assert.equal(file.text, "hello there");
  assert.equal(file.size, 11);
  done();
});

test("a path outside the drive is refused, relative or absolute", () => {
  const { root, done } = drive();
  assert.throws(() => resolveSafePath("../escape.txt", root), UnsafePathError);
  assert.throws(() => resolveSafePath("/etc/passwd", root), UnsafePathError);
  assert.throws(() => resolveSafePath("../../../../etc/passwd", root), UnsafePathError);
  assert.throws(() => readTextFile("/etc/hosts", { root }), UnsafePathError);
  done();
});

test("a symlink that points outside the drive is refused", () => {
  const { root, done } = drive();
  const outside = path.join(path.dirname(root), `outside-${Date.now()}.txt`);
  fs.writeFileSync(outside, "secret");
  try {
    fs.symlinkSync(outside, path.join(root, "link.txt"));
    assert.throws(() => readTextFile("link.txt", { root }), UnsafePathError);
    assert.throws(() => resolveSafePath("link.txt", root), UnsafePathError);
  } finally {
    fs.rmSync(outside, { force: true });
    done();
  }
});

test("binaries, big files and folders are refused", () => {
  const { root, done } = drive();
  fs.writeFileSync(path.join(root, "blob.bin"), Buffer.from([0, 1, 2, 3]));
  assert.throws(() => readTextFile("blob.bin", { root }), /not text/);
  fs.writeFileSync(path.join(root, "big.txt"), "a".repeat(MAX_TEXT_BYTES + 10));
  assert.throws(() => readTextFile("big.txt", { root }), /larger than/);
  fs.mkdirSync(path.join(root, "folder"));
  assert.throws(() => readTextFile("folder", { root }), /not a file/);
  assert.throws(() => listDir("missing-dir", { root }), UnsafePathError);
  done();
});

test("empty and odd paths are refused", () => {
  const { root, done } = drive();
  assert.throws(() => resolveSafePath("", root), UnsafePathError);
  assert.throws(() => resolveSafePath("  ", root), UnsafePathError);
  assert.throws(() => resolveSafePath("a\0b", root), UnsafePathError);
  assert.equal(resolveSafePath(".", root), fs.realpathSync(root));
  done();
});
