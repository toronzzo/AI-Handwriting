import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { appendGuardLog, readGuardLog } from "./guardLog.mjs";
import { reviewAction } from "./guard.mjs";

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "guard-log-"));
}

test("audit lines append and never rewrite earlier bytes", () => {
  const dir = tempDir();
  try {
    const now = new Date("2026-11-19T10:00:00.000Z");
    appendGuardLog(dir, { ts: now.getTime(), kind: "read_file", source: "task", verdict: "allow", rule: "R1-R7", why: "reading is safe", argsPreview: '{"path":"a.md"}', model: false });
    const file = path.join(dir, "guard", "2026-11-19.jsonl");
    const before = fs.readFileSync(file, "utf8");
    appendGuardLog(dir, { ts: now.getTime() + 1, kind: "delete_note", source: "chat", verdict: "block", rule: "R3", why: "no", argsPreview: "{}", model: false });
    const after = fs.readFileSync(file, "utf8");
    assert.ok(after.startsWith(before));
    assert.equal(after.trim().split("\n").length, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a pasted key is redacted in argsPreview", () => {
  const dir = tempDir();
  try {
    appendGuardLog(dir, {
      ts: Date.now(),
      kind: "read_file",
      source: "task",
      verdict: "allow",
      rule: "R1-R7",
      why: "ok",
      argsPreview: '{"path":"/Volumes/Agent/agent/secrets/.env","key":"sk-abcdef1234567890"}',
      model: false,
    });
    const lines = readGuardLog(dir, null);
    assert.equal(lines.length, 1);
    assert.ok(!lines[0].argsPreview.includes("sk-abcdef1234567890"));
    assert.match(lines[0].argsPreview, /sk-\*\*\*/);
    assert.ok(lines[0].argsPreview.length <= 200);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("readGuardLog filters by day and skips torn lines", () => {
  const dir = tempDir();
  try {
    const guardDir = path.join(dir, "guard");
    fs.mkdirSync(guardDir, { recursive: true });
    fs.writeFileSync(
      path.join(guardDir, "2026-11-18.jsonl"),
      [
        JSON.stringify({ v: 1, ts: 1, kind: "a", source: "", verdict: "allow", rule: "", why: "", argsPreview: "", model: false }),
        "{torn",
        "",
      ].join("\n"),
    );
    fs.writeFileSync(
      path.join(guardDir, "2026-11-19.jsonl"),
      JSON.stringify({ v: 1, ts: 2, kind: "b", source: "", verdict: "block", rule: "R1", why: "", argsPreview: "", model: false }) + "\n",
    );
    assert.equal(readGuardLog(dir, "2026-11-19").length, 1);
    assert.equal(readGuardLog(dir, null).length, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a failing log write never changes the verdict", async () => {
  const dir = tempDir();
  try {
    // Make "guard" a file, so mkdirSync fails and the log write throws.
    fs.writeFileSync(path.join(dir, "guard"), "not a directory");
    const review = await reviewAction(
      { kind: "read_file", args: { path: "notes/a.md" }, userRequest: "read my notes", origin: "user", source: "task" },
      { dataDir: dir, fsRoot: dir },
    );
    assert.equal(review.verdict, "allow", "the verdict stands even though the log is broken");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
