import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createActivityHub, dayKey, redactSecrets } from "./activity.mjs";

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "preyas-activity-"));
}

function tool(runId = "r-1", tool = "search_web", detail = "weather") {
  return { runId, kind: "tool", tool, label: "Searched web", detail, status: "done" };
}

test("seq grows by one for every event", () => {
  const hub = createActivityHub({ now: () => 1000 });
  const first = hub.emit(tool());
  const second = hub.emit(tool());
  assert.equal(first.seq, 1);
  assert.equal(second.seq, 2);
  assert.equal(first.v, 1);
  assert.equal(first.detail, "weather");
});

test("the ring keeps only the newest 500", () => {
  const hub = createActivityHub({ now: () => 1000 });
  for (let index = 0; index < 640; index += 1) hub.emit(tool("r-1", "read_file", `file ${index}`));
  assert.equal(hub.size, 500);
  assert.equal(hub.ring[0].seq, 141);
  assert.equal(hub.ring[499].seq, 640);
});

test("since() returns only newer events and filters by run", () => {
  const hub = createActivityHub({ now: () => 1000 });
  hub.emit(tool("r-1"));
  hub.emit(tool("r-2"));
  hub.emit(tool("r-1"));
  const all = hub.since(0);
  assert.deepEqual(all.events.map((event) => event.seq), [1, 2, 3]);
  assert.equal(all.last, 3);
  const after = hub.since(1);
  assert.deepEqual(after.events.map((event) => event.seq), [2, 3]);
  const onlyR1 = hub.since(0, { runId: "r-1" });
  assert.deepEqual(onlyR1.events.map((event) => event.seq), [1, 3]);
  const none = hub.since(3);
  assert.deepEqual(none.events, []);
  assert.equal(none.last, 3);
  const capped = hub.since(0, { limit: 2 });
  assert.equal(capped.events.length, 2);
  assert.equal(capped.last, 2);
});

test("the JSONL file has one line per event, in a dated folder", () => {
  const dataDir = tempDir();
  const at = new Date(2026, 10, 19, 12, 0, 0).getTime();
  const hub = createActivityHub({ dataDir, now: () => at + 5 });
  hub.emit(tool("r-1", "search_web", "oslo"));
  hub.begin("r-1", "read_file", "notes.md").done();
  const file = path.join(dataDir, "activity", `${dayKey(at + 5)}.jsonl`);
  const lines = fs.readFileSync(file, "utf8").trim().split("\n");
  assert.equal(lines.length, 3);
  const rows = lines.map((line) => JSON.parse(line));
  assert.deepEqual(rows.map((row) => row.seq), [1, 2, 3]);
  assert.equal(rows[0].v, 1);
  assert.equal(rows[0].runId, "r-1");
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test("a secret-looking detail is redacted in memory and in the file", () => {
  const dataDir = tempDir();
  const hub = createActivityHub({ dataDir, now: () => 1000 });
  const keyed = hub.emit(tool("r-1", "search_web", "key sk-abcdefgh12345678 leaked"));
  const bearer = hub.emit(tool("r-1", "read_file", "Authorization: Bearer abc.def.ghi"));
  const line = hub.emit(tool("r-1", "read_file", "DEEPSEEK_API_KEY=abcdef123456"));
  const known = hub.emit({ ...tool("r-1", "read_file", "opened with hunter2hunter2"), secrets: ["hunter2hunter2"] });
  assert.equal(known.detail, "opened with [redacted]");
  for (const event of [keyed, bearer, line]) {
    assert.equal(/sk-abcdefgh12345678|abc\.def\.ghi|abcdef123456|hunter2hunter2/.test(event.detail), false, event.detail);
    assert.match(event.detail, /redacted/);
  }
  const file = path.join(dataDir, "activity", `${dayKey(1000)}.jsonl`);
  const text = fs.readFileSync(file, "utf8");
  assert.equal(/sk-abcdefgh12345678|abc\.def\.ghi|abcdef123456|hunter2hunter2/.test(text), false);
  // A niladri-ish word that only looks like a prefix is left alone.
  const innocent = createActivityHub().emit(tool("r-1", "search_web", "task-sk-1 list"));
  assert.equal(innocent.detail, "task-sk-1 list");
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test("begin().done() fills endedAt and durationMs on the same id", () => {
  let clock = 5000;
  const hub = createActivityHub({ now: () => clock });
  const step = hub.begin("r-1", "search_web", "oslo weather");
  clock = 6200;
  const finished = step.done();
  assert.equal(finished.id, step.id);
  assert.equal(finished.seq, 2);
  assert.equal(finished.status, "done");
  assert.equal(finished.endedAt, 6200);
  assert.equal(finished.durationMs, 1200);
  assert.equal(finished.startedAt, 5000);
  // A step can only finish once.
  assert.equal(step.fail("late"), null);
  const thought = createActivityHub({ now: () => clock }).begin("r-1", "think");
  clock += 10;
  assert.equal(thought.stop().status, "stopped");
  const bad = createActivityHub({ now: () => clock }).begin("r-1", "read_file", "a.md").fail("missing");
  assert.equal(bad.status, "error");
  assert.equal(bad.detail, "missing");
});

test("bad events are rejected without breaking the sequence", () => {
  const hub = createActivityHub({ now: () => 1000 });
  assert.equal(hub.emit({ runId: "r-1", tool: "search_web", status: "fine" }), null);
  assert.equal(hub.emit({ runId: "r-1", kind: "nonsense", tool: "search_web" }), null);
  const good = hub.emit(tool());
  assert.equal(good.seq, 1);
});

test("a detail is clipped to 120 characters", () => {
  const hub = createActivityHub({ now: () => 1000 });
  const event = hub.emit(tool("r-1", "search_web", "word ".repeat(100)));
  assert.equal(event.detail.length, 120);
  assert.equal(event.detail.endsWith("…"), true);
});

test("no dataDir works in memory only and does not throw", () => {
  const hub = createActivityHub();
  assert.doesNotThrow(() => hub.emit(tool()));
  assert.equal(hub.since(0).events.length, 1);
});

test("a missing drive still serves the feed from memory", () => {
  const hub = createActivityHub({ dataDir: path.join(os.tmpdir(), "no-such-drive-xyz", "sub"), now: () => 1000 });
  const event = hub.emit(tool());
  assert.equal(event.seq, 1);
  assert.equal(hub.since(0).events.length, 1);
});

test("redactSecrets keeps ordinary words", () => {
  assert.equal(redactSecrets("searched notes about the dentist"), "searched notes about the dentist");
  assert.equal(redactSecrets("sk-0123456789abcdef"), "[redacted]");
});
