import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { scanDrive } from "./driveMap.mjs";

function sandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "preyas-drive-"));
  const make = (...parts) => {
    const dir = path.join(root, ...parts);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  };
  const file = (...parts) => {
    const full = path.join(root, ...parts);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, "x".repeat(8));
    return full;
  };
  return { root, make, file, done: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test("the scanner skips secrets, node_modules, .git and hidden files", () => {
  const s = sandbox();
  try {
    s.make("agent", "repos", "myrepo");
    s.file("agent", "repos", "myrepo", "README.md");
    s.make("agent", "secrets");
    s.file("agent", "secrets", ".env");
    s.make("agent", "node_modules", "pkg");
    s.file("agent", "node_modules", "pkg", "index.js");
    s.make("agent", "models", "ripple-body");
    s.file("agent", "models", "ripple-body", "weights.npz");
    s.file("agent", ".hidden.txt");
    s.make(".spotlight");

    const map = scanDrive(s.root, { now: 1 });

    const every = JSON.stringify(map);
    assert.ok(!every.includes("secrets"), "secrets must never appear in the map");
    assert.ok(!every.includes("node_modules"), "node_modules must never appear");
    assert.ok(!every.includes(".git"), "git internals must never appear");
    assert.ok(!every.includes(".env"), "secret file names must never appear");
    assert.ok(!every.includes(".hidden"), "hidden files must never appear");
    assert.ok(!every.includes(".spotlight"), "hidden folders must never appear");
  } finally {
    s.done();
  }
});

test("the scanner respects the three-level depth limit", () => {
  const s = sandbox();
  try {
    // agent/repos/myrepo/src/deep.ts is depth 4 from the root; it must be skipped.
    s.file("agent", "repos", "myrepo", "src", "deep.ts");
    s.file("agent", "repos", "myrepo", "shallow.ts");

    const map = scanDrive(s.root, { now: 1 });
    const repos = map.folders.find((folder) => folder.path === "agent/repos");
    assert.ok(repos, "agent/repos key folder is present");
    // shallow.ts lives at depth 3 (root/agent/repos/myrepo/shallow.ts); deep.ts at depth 4.
    const names = JSON.stringify(map);
    assert.ok(names.includes("shallow.ts"), "depth-3 file is listed");
    assert.ok(!names.includes("deep.ts"), "depth-4 file is not listed");
  } finally {
    s.done();
  }
});

test("the scanner lists models with their type and top-level + key folders", () => {
  const s = sandbox();
  try {
    s.file("BakuganBuddy", "models", "Qwen.Q4_K_M.gguf");
    s.file("agent", "models", "ripple-body", "weights.npz");
    s.file("BakuganBuddy", "documents", "memo.docx");
    s.file("BakuganBuddy", "vault", "Preyas.md");

    const map = scanDrive(s.root, { now: 2 });
    const paths = map.folders.map((folder) => folder.path);

    assert.ok(paths.includes("agent"), "top-level agent folder is present");
    assert.ok(paths.includes("BakuganBuddy"), "top-level BakuganBuddy folder is present");
    assert.ok(paths.includes("agent/models"), "key folder agent/models is present");
    assert.ok(paths.includes("BakuganBuddy/documents"), "key folder documents is present");
    assert.ok(paths.includes("BakuganBuddy/vault"), "key folder vault is present");

    const gguf = map.models.find((model) => model.name.endsWith(".gguf"));
    assert.ok(gguf, "gguf model is listed");
    assert.equal(gguf.type, "gguf");
    const npz = map.models.find((model) => model.name.endsWith(".npz"));
    assert.ok(npz, "npz model is listed");
    assert.equal(npz.type, "npz");
    assert.ok(map.totalFiles > 0);
  } finally {
    s.done();
  }
});

test("a cache key folder is reported without walking its internals", () => {
  const s = sandbox();
  try {
    s.file("agent", "cache", "slot", "deep", "never.txt");
    s.file("agent", "cache", "top.txt");

    const map = scanDrive(s.root, { now: 3 });
    const cache = map.folders.find((folder) => folder.path === "agent/cache");
    assert.ok(cache, "agent/cache key folder is present");
    const every = JSON.stringify(map);
    assert.ok(!every.includes("never.txt"), "cache internals are not walked");
    assert.ok(every.includes("top.txt"), "a cache file at the top level is still reported");
  } finally {
    s.done();
  }
});
