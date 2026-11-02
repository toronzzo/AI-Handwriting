import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { addNote } from "./notes.mjs";
import { listTasks, loadTask, newTask, pauseInterrupted, saveTask } from "./tasks.mjs";
import { planTask, runTask, stepContext } from "./taskRunner.mjs";

function drive() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "preyas-tasks-"));
  return { root, done: () => fs.rmSync(root, { recursive: true, force: true }) };
}

function fakeFetch(replies) {
  let index = 0;
  const calls = [];
  const impl = async (url, init) => {
    calls.push(JSON.parse(init.body));
    const content = replies[Math.min(index, replies.length - 1)];
    index += 1;
    return { ok: true, json: async () => ({ choices: [{ message: { content } }] }) };
  };
  impl.calls = calls;
  return impl;
}

test("a task is saved to its own file and listed", () => {
  const { root, done } = drive();
  const task = newTask(root, {
    title: "plan my week",
    chatId: "chat-1",
    steps: [{ text: "read notes" }, { text: "write the plan" }],
  });
  assert.equal(task.steps.length, 2);
  assert.equal(task.steps[0].status, "pending");
  assert.equal(fs.existsSync(path.join(root, "memory", "tasks", `${task.id}.json`)), true);
  const loaded = loadTask(root, task.id);
  assert.equal(loaded.title, "plan my week");
  assert.equal(loaded.chatId, "chat-1");
  const second = newTask(root, { title: "other", steps: [{ text: "x" }] });
  assert.equal(listTasks(root).length, 2);
  assert.equal(listTasks(root)[0].id, second.id);
  done();
});

test("an interrupted run comes back as paused and resumable", () => {
  const { root, done } = drive();
  const task = newTask(root, { title: "t", steps: [{ text: "one" }, { text: "two" }] });
  task.status = "running";
  task.steps[0].status = "running";
  saveTask(root, task);
  assert.equal(pauseInterrupted(root), 1);
  const paused = loadTask(root, task.id);
  assert.equal(paused.status, "paused");
  assert.equal(paused.steps[0].status, "pending");
  done();
});

test("the planner turns model text into steps and falls back to one step", async () => {
  const { root, done } = drive();
  const plan = await planTask(
    "http://llama",
    "plan my week",
    "- note",
    { fetchImpl: fakeFetch(['[{"text":"Search notes","tool":{"name":"search_notes","query":"week"}},{"text":"Write it"}]']) },
  );
  assert.equal(plan.length, 2);
  assert.equal(plan[0].tool.name, "search_notes");
  const fallback = await planTask("http://llama", "plan my week", "", { fetchImpl: fakeFetch(["not json"]) });
  assert.deepEqual(fallback, [{ text: "plan my week", tool: null }]);
  done();
});

test("the runner completes steps in order and saves each result", async () => {
  const { root, done } = drive();
  const task = newTask(root, { title: "plan my week", steps: [{ text: "one" }, { text: "two" }] });
  const impl = fakeFetch(["first result", "second result"]);
  const finished = await runTask(root, task, { llamaUrl: "http://llama", fetchImpl: impl });
  assert.equal(finished.status, "done");
  assert.deepEqual(finished.steps.map((step) => step.status), ["done", "done"]);
  assert.deepEqual(finished.steps.map((step) => step.result), ["first result", "second result"]);
  assert.equal(loadTask(root, task.id).status, "done");
  assert.equal(impl.calls.length, 2);
  done();
});

test("a failed step stops the task and is saved as an error", async () => {
  const { root, done } = drive();
  const task = newTask(root, { title: "t", steps: [{ text: "one" }, { text: "two" }] });
  const failing = async () => {
    throw new Error("llama is down");
  };
  const finished = await runTask(root, task, { llamaUrl: "http://llama", fetchImpl: failing });
  assert.equal(finished.status, "error");
  assert.equal(finished.steps[0].status, "error");
  assert.match(finished.steps[0].result, /llama is down/);
  assert.equal(loadTask(root, task.id).status, "error");
  done();
});

test("step context uses notes and safe files, and refuses paths outside", () => {
  const { root, done } = drive();
  addNote(root, { text: "Dentist on Friday at 9", kind: "deadline" });
  fs.mkdirSync(path.join(root, "projects"), { recursive: true });
  fs.writeFileSync(path.join(root, "projects", "plan.txt"), "the plan is to rest");
  const task = newTask(root, { title: "t", steps: [{ text: "look" }] });
  const withFile = stepContext(
    root,
    task,
    { id: 1, text: "read it", status: "pending", tool: { name: "read_file", path: "projects/plan.txt" } },
    { fsRoot: root },
  );
  assert.match(withFile, /the plan is to rest/);
  const refused = stepContext(
    root,
    task,
    { id: 1, text: "read it", status: "pending", tool: { name: "read_file", path: "/etc/passwd" } },
    { fsRoot: root },
  );
  assert.match(refused, /Tool error/);
  const notes = stepContext(
    root,
    task,
    { id: 1, text: "look", status: "pending", tool: { name: "search_notes", query: "dentist" } },
    { fsRoot: root },
  );
  assert.match(notes, /Dentist on Friday/);
  done();
});
