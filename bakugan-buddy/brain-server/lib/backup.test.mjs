import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";

const SCRIPT = path.join(import.meta.dirname, "..", "..", "launcher", "preyas-backup.sh");

function sandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "preyas-backup-"));
  const buddy = path.join(root, "BakuganBuddy");
  fs.mkdirSync(path.join(buddy, "history"), { recursive: true });
  fs.mkdirSync(path.join(buddy, "memory"), { recursive: true });
  fs.writeFileSync(path.join(buddy, "history", "chat.jsonl"), '{"role":"user"}\n');
  fs.writeFileSync(path.join(buddy, "memory", "notes.md"), "- a note\n");
  return { root, buddy, done: () => fs.rmSync(root, { recursive: true, force: true }) };
}

function run(root) {
  return execFileSync("bash", [SCRIPT], {
    env: { ...process.env, PREYAS_DRIVE: root },
    encoding: "utf8",
  });
}

test("a backup archives history and memory but not cache, models or documents", () => {
  const { root, buddy, done } = sandbox();
  try {
    fs.mkdirSync(path.join(buddy, "cache"), { recursive: true });
    fs.mkdirSync(path.join(buddy, "documents"), { recursive: true });
    fs.writeFileSync(path.join(buddy, "cache", "big.bin"), "x".repeat(100));
    fs.writeFileSync(path.join(buddy, "documents", "secret.txt"), "x");
    run(root);
    const backups = fs.readdirSync(path.join(buddy, "backups")).filter((name) => name.endsWith(".zip"));
    assert.equal(backups.length, 1);
    assert.match(backups[0], /^preyas-\d{4}-\d{2}-\d{2}\.zip$/);
    const listing = execFileSync("unzip", ["-l", path.join(buddy, "backups", backups[0])], { encoding: "utf8" });
    assert.match(listing, /history\/chat\.jsonl/);
    assert.match(listing, /memory\/notes\.md/);
    assert.doesNotMatch(listing, /cache\//);
    assert.doesNotMatch(listing, /documents\//);
    assert.equal(fs.existsSync(path.join(buddy, "backups", ".partial-" + backups[0].slice(7))), false);
  } finally {
    done();
  }
});

test("running twice in one day does not create a second archive", () => {
  const { root, buddy, done } = sandbox();
  try {
    run(root);
    run(root);
    const backups = fs.readdirSync(path.join(buddy, "backups")).filter((name) => name.endsWith(".zip"));
    assert.equal(backups.length, 1);
  } finally {
    done();
  }
});

test("only the newest fourteen are kept, and only preyas zips are removed", () => {
  const { root, buddy, done } = sandbox();
  try {
    const dir = path.join(buddy, "backups");
    fs.mkdirSync(dir, { recursive: true });
    for (let day = 1; day <= 16; day += 1) {
      fs.writeFileSync(path.join(dir, `preyas-2026-10-${String(day).padStart(2, "0")}.zip`), "old");
    }
    fs.writeFileSync(path.join(dir, "keep-me.zip"), "another tool");
    fs.writeFileSync(path.join(dir, "notes.txt"), "keep");
    run(root);
    const names = fs.readdirSync(dir).sort();
    const preyas = names.filter((name) => /^preyas-.*\.zip$/.test(name));
    const today = new Date().toISOString().slice(0, 10);
    assert.ok(preyas.length <= 14, `kept ${preyas.length}`);
    assert.ok(preyas.includes(`preyas-${today}.zip`), "today's archive is kept");
    assert.equal(names.includes("keep-me.zip"), true, "foreign zips are never deleted");
    assert.equal(names.includes("notes.txt"), true);
    const oldest = preyas.filter((name) => name.includes("2026-10-01"));
    if (preyas.length >= 14) assert.equal(oldest.length, 0, "oldest removed first");
  } finally {
    done();
  }
});

test("an unmounted drive is a quiet no-op", () => {
  const missing = path.join(os.tmpdir(), `preyas-missing-${Date.now()}`);
  const output = execFileSync("bash", [SCRIPT], {
    env: { ...process.env, PREYAS_DRIVE: missing },
    encoding: "utf8",
  });
  assert.match(output, /not mounted/i);
  assert.equal(fs.existsSync(missing), false, "nothing is created off the drive");
});
