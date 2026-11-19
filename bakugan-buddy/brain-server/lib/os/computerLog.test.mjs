import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  appendComputerLog,
  dayName,
  logFilePath,
  purgeOldShots,
  shotsDir,
  shotFilePath,
  validShotId,
} from "./computerLog.mjs";

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "computer-log-"));
}

const NOW = new Date("2026-11-19T12:00:00.000Z");

test("appendComputerLog writes one append-only line per call", () => {
  const dir = tempDir();
  try {
    appendComputerLog(
      dir,
      { sessionId: "s1", n: 2, action: { action: "click", target: "e1" }, verdict: "proposed", decision: "no", result: "", ms: 0 },
      NOW,
    );
    appendComputerLog(
      dir,
      { sessionId: "s1", n: 3, action: { action: "key", combo: "cmd+c" }, verdict: "executed", decision: "yes", result: "ok", ms: 12 },
      NOW,
    );
    const file = logFilePath(dir, NOW);
    assert.equal(file, path.join(dir, "computer", "2026-11-19.jsonl"));
    const lines = fs.readFileSync(file, "utf8").trim().split("\n");
    assert.equal(lines.length, 2);
    const first = JSON.parse(lines[0]);
    assert.equal(first.v, 1);
    assert.equal(first.ts, NOW.getTime());
    assert.equal(first.sessionId, "s1");
    assert.equal(first.n, 2);
    assert.equal(first.decision, "no");
    const second = JSON.parse(lines[1]);
    assert.equal(second.decision, "yes");
    assert.equal(second.ms, 12);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the action in the log is redacted", () => {
  const dir = tempDir();
  try {
    appendComputerLog(
      dir,
      {
        sessionId: "s1",
        n: 1,
        action: { action: "type", text: "my key is sk-abcdef1234567890" },
        verdict: "proposed",
        decision: "no",
        result: "",
        ms: 0,
      },
      NOW,
    );
    const text = fs.readFileSync(logFilePath(dir, NOW), "utf8");
    assert.ok(!text.includes("sk-abcdef1234567890"));
    assert.ok(text.includes("sk-***"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("no screenshot bytes ever reach the log", () => {
  const dir = tempDir();
  try {
    const shotDir = shotsDir(dir);
    fs.mkdirSync(shotDir, { recursive: true });
    const id = "abc12345";
    fs.writeFileSync(path.join(shotDir, `${id}.jpg`), Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Buffer.from("jpegdata")]));
    appendComputerLog(
      dir,
      { sessionId: "s1", n: 1, action: { action: "click", target: "e1", shot: id }, verdict: "executed", decision: "yes", result: "ok", ms: 5 },
      NOW,
    );
    const text = fs.readFileSync(logFilePath(dir, NOW), "utf8");
    assert.ok(!text.includes("jpegdata"), "image bytes must not appear in the log");
    assert.ok(!text.includes("\ufffd\ufffd"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("validShotId accepts only the id pattern this feature creates", () => {
  assert.equal(validShotId("abc12345"), true);
  assert.equal(validShotId("abc-123-def"), true);
  assert.equal(validShotId("ab"), false);
  assert.equal(validShotId("../secrets"), false);
  assert.equal(validShotId("a/b.jpg"), false);
  assert.equal(validShotId("abc.jpg"), false);
  assert.equal(validShotId(""), false);
  assert.equal(validShotId(42), false);
});

test("shotFilePath stays inside the shots folder", () => {
  const dir = tempDir();
  try {
    assert.equal(shotFilePath(dir, "abc12345"), path.join(dir, "computer", "shots", "abc12345.jpg"));
    assert.equal(shotFilePath(dir, "../etc"), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("purgeOldShots removes only this feature's files older than 24 h", () => {
  const dir = tempDir();
  try {
    const shotDir = shotsDir(dir);
    fs.mkdirSync(shotDir, { recursive: true });
    const oldId = "oldfile1";
    const newId = "newfile2";
    fs.writeFileSync(path.join(shotDir, `${oldId}.jpg`), "old");
    fs.writeFileSync(path.join(shotDir, `${newId}.jpg`), "new");
    fs.writeFileSync(path.join(shotDir, "notes.txt"), "not ours");
    fs.mkdirSync(path.join(shotDir, "subfolder"));
    fs.writeFileSync(path.join(shotDir, "subfolder", "nested.jpg"), "nested");
    const oldTime = new Date(NOW.getTime() - 25 * 3600 * 1000);
    fs.utimesSync(path.join(shotDir, `${oldId}.jpg`), oldTime, oldTime);
    fs.utimesSync(path.join(shotDir, "notes.txt"), oldTime, oldTime);

    const removed = purgeOldShots(dir, NOW);
    assert.equal(removed, 1);
    assert.equal(fs.existsSync(path.join(shotDir, `${oldId}.jpg`)), false);
    assert.equal(fs.existsSync(path.join(shotDir, `${newId}.jpg`)), true);
    assert.equal(fs.existsSync(path.join(shotDir, "notes.txt")), true, "non-shot files are never deleted");
    assert.equal(fs.existsSync(path.join(shotDir, "subfolder", "nested.jpg")), true, "nothing outside the flat shots folder is deleted");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("purgeOldShots on a missing folder returns 0", () => {
  const dir = tempDir();
  try {
    assert.equal(purgeOldShots(dir, NOW), 0);
    assert.equal(purgeOldShots("", NOW), 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("dayName uses the local calendar day", () => {
  assert.equal(dayName(new Date(2026, 10, 19, 12)), "2026-11-19");
  assert.equal(dayName(new Date(2026, 10, 18, 23, 30)), "2026-11-18");
});
