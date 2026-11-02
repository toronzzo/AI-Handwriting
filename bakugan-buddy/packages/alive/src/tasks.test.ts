import assert from "node:assert/strict";
import test from "node:test";
import { looksLikeTask, parsePlan, parseTool, taskStatusLine, type TaskRecord } from "./tasks.ts";

function task(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: "t1",
    title: "plan my week",
    chatId: "c1",
    status: "running",
    created: 1,
    updated: 1,
    steps: [
      { id: 1, text: "one", status: "done", result: "r1" },
      { id: 2, text: "two", status: "running" },
      { id: 3, text: "three", status: "pending" },
    ],
    ...overrides,
  };
}

test("multi-step requests are recognised, questions are not", () => {
  assert.equal(looksLikeTask("plan my week from my notes"), true);
  assert.equal(looksLikeTask("summarize the files in /Volumes/Agent/agent"), true);
  assert.equal(looksLikeTask("Task: tidy the notes"), true);
  assert.equal(looksLikeTask("review my notes step by step"), true);
  assert.equal(looksLikeTask("what's the plan?"), false);
  assert.equal(looksLikeTask("plan"), false);
  assert.equal(looksLikeTask("summarize this paragraph for me"), false);
  assert.equal(looksLikeTask("explain recursion step by step"), false);
  assert.equal(looksLikeTask("tell me a story"), false);
  assert.equal(looksLikeTask("what did I say about the dentist?"), false);
});

test("the status line names the current step", () => {
  assert.equal(taskStatusLine(task()), "Working on it: step 2 of 3…");
  assert.equal(taskStatusLine(task({ status: "planned" })), "Planning 3 steps…");
  assert.equal(taskStatusLine(task({ status: "done" })), "Done: 3 steps.");
  assert.equal(taskStatusLine(task({ status: "paused" })), "Paused at step 2 of 3.");
  assert.equal(
    taskStatusLine(task({ status: "error", steps: [{ id: 1, text: "x", status: "error" }] })),
    "Stopped at step 1 of 1.",
  );
});

test("a plan is parsed from model text with thinking and fences", () => {
  const raw = '<think>hmm</think>```json\n[{"text":"Search the notes","tool":{"name":"search_notes","query":"week"}},{"text":"Write the plan","tool":null}]\n```';
  const steps = parsePlan(raw);
  assert.equal(steps.length, 2);
  assert.deepEqual(steps[0], { text: "Search the notes", tool: { name: "search_notes", query: "week" } });
  assert.deepEqual(steps[1], { text: "Write the plan", tool: null });
});

test("plans accept plain strings, cap at six steps, and drop bad tools", () => {
  const raw = JSON.stringify([
    "one", "two", "three", "four", "five", "six", "seven",
    { text: "with bad tool", tool: { name: "delete_everything" } },
  ]);
  const steps = parsePlan(raw);
  assert.equal(steps.length, 6);
  assert.deepEqual(steps[0], { text: "one", tool: null });
  assert.equal(steps[7], undefined);
  assert.deepEqual(parsePlan("no array here"), []);
  assert.deepEqual(parsePlan('[{"text":""}]'), []);
  assert.equal(parseTool({ name: "read_file", path: "notes/a.txt" })?.name, "read_file");
  assert.equal(parseTool({ name: "search_notes", query: "" }), null);
  // The 8B model tends to answer with bare tool calls; they become named steps.
  const bare = parsePlan('[{"name":"search_notes","query":"week"},{"name":"read_file","path":"notes.md"}]');
  assert.equal(bare.length, 2);
  assert.deepEqual(bare[0], {
    text: 'Search my notes for "week"',
    tool: { name: "search_notes", query: "week" },
  });
  assert.equal(bare[1].text, "Read notes.md");
  assert.equal(parseTool(null), null);
});
