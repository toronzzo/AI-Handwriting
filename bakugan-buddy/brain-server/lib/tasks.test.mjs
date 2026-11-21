import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { addNote } from "./notes.mjs";
import { listTasks, loadTask, newTask, pauseInterrupted, saveTask } from "./tasks.mjs";
import { confirmTaskStep, launchTaskRun, planTask, runTask, runToolTask, stepContext, taskRunActive } from "./taskRunner.mjs";

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

test("a planned task that never started stays planned after a restart", () => {
  const { root, done } = drive();
  const task = newTask(root, { title: "t", steps: [{ text: "one" }] });
  assert.equal(pauseInterrupted(root), 0);
  const loaded = loadTask(root, task.id);
  assert.equal(loaded.status, "planned");
  assert.equal(loaded.steps[0].status, "pending");
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

test("a task cannot run twice at the same time", async () => {
  const { root, done } = drive();
  const task = newTask(root, { title: "t", steps: [{ text: "one" }] });
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const waiting = async () => {
    await gate;
    return { ok: true, json: async () => ({ choices: [{ message: { content: "done" } }] }) };
  };
  const first = launchTaskRun(root, task, { llamaUrl: "http://llama", fetchImpl: waiting });
  assert.ok(first);
  assert.equal(taskRunActive(task.id), true);
  assert.equal(launchTaskRun(root, task, { llamaUrl: "http://llama", fetchImpl: waiting }), null);
  release();
  await first;
  assert.equal(taskRunActive(task.id), false);
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

test("a tool step reports itself to the activity hub", () => {
  const { root, done } = drive();
  fs.mkdirSync(path.join(root, "projects"), { recursive: true });
  fs.writeFileSync(path.join(root, "projects", "plan.txt"), "rest");
  const task = newTask(root, { title: "t", steps: [{ text: "look" }] });
  const seen = [];
  const onActivity = {
    begin(runId, tool, detail) {
      seen.push({ runId, tool, detail, status: "running" });
      return {
        done: () => seen.push({ runId, tool, status: "done" }),
        fail: () => seen.push({ runId, tool, status: "error" }),
        stop: () => seen.push({ runId, tool, status: "stopped" }),
      };
    },
  };
  stepContext(
    root,
    task,
    { id: 1, text: "read it", status: "pending", tool: { name: "read_file", path: "projects/plan.txt" } },
    { fsRoot: root, onActivity },
  );
  stepContext(
    root,
    task,
    { id: 2, text: "read it", status: "pending", tool: { name: "read_file", path: "/etc/passwd" } },
    { fsRoot: root, onActivity },
  );
  stepContext(root, task, { id: 3, text: "plain", status: "pending", tool: null }, { fsRoot: root, onActivity });
  assert.deepEqual(seen, [
    { runId: task.id, tool: "read_file", detail: "projects/plan.txt", status: "running" },
    { runId: task.id, tool: "read_file", status: "done" },
    { runId: task.id, tool: "read_file", detail: "/etc/passwd", status: "running" },
    { runId: task.id, tool: "read_file", status: "error" },
  ]);
  // No hub at all is fine.
  assert.match(
    stepContext(root, task, { id: 4, text: "look", status: "pending", tool: { name: "search_notes", query: "x" } }, { fsRoot: root }),
    /Notes matching/,
  );
  done();
});

test("a tool-loop task records an error instead of hanging when both models are down", async () => {
  const { root, done } = drive();
  const task = newTask(root, { title: "open example.com", chatId: "c", steps: [], toolLoop: true });
  const down = async () => {
    throw new Error("network is down");
  };
  const finished = await runToolTask(root, task, {
    llamaUrl: "http://llama",
    gatewayUrl: "http://gw",
    fetchImpl: down,
    hub: null,
  });
  assert.equal(finished.status, "error");
  assert.equal(finished.steps[finished.steps.length - 1].status, "error");
  assert.match(finished.steps[finished.steps.length - 1].result, /network is down/);
  assert.equal(loadTask(root, task.id).status, "error");
  done();
});

test("a private browser request during a task opens a scoped confirmation card", async () => {
  const { root, done } = drive();
  const task = newTask(root, { title: "open a page", chatId: "c", steps: [], toolLoop: true });
  let onPrivateRequest;
  let callCount = 0;
  const hub = {
    listTools: async () => [{ name: "browser_navigate", parameters: { type: "object" } }],
    setBrowserTaskContext: (context) => {
      onPrivateRequest = context.onPrivateRequest;
      return () => { onPrivateRequest = null; };
    },
    approveBrowserDestination: () => true,
    callTool: async () => {
      const allowed = await onPrivateRequest({
        url: "http://router.local:8080/",
        host: "router.local",
        port: 8080,
        address: "192.168.1.1",
      });
      callCount += 1;
      return allowed ? "opened" : "blocked";
    },
  };
  let modelCalls = 0;
  const fetchImpl = async () => {
    modelCalls += 1;
    const message = modelCalls === 1
      ? {
          tool_calls: [{
            id: "call-1",
            function: { name: "browser_navigate", arguments: JSON.stringify({ url: "https://public.example/" }) },
          }],
        }
      : { content: "done" };
    return { ok: true, json: async () => ({ choices: [{ message }], usage: {} }) };
  };
  try {
    const running = runToolTask(root, task, {
      gatewayUrl: "http://gateway",
      fetchImpl,
      hub,
      guard: async () => ({ verdict: "allow", why: "public URL" }),
      confirmTtlMs: 30_000,
    });
    for (let tries = 0; tries < 20 && !task.steps.some((step) => step.pendingConfirm); tries += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    const approvalStep = task.steps.find((step) => step.pendingConfirm);
    assert.ok(approvalStep, "the intercepted private request creates a confirmation step");
    assert.match(approvalStep.pendingConfirm.why, /router\.local:8080 at 192\.168\.1\.1/);
    assert.match(approvalStep.pendingConfirm.detail, /only to this host, port, address, and task/);
    assert.equal(confirmTaskStep(task, approvalStep.id, { yes: true, token: approvalStep.pendingConfirm.token }).ok, true);
    const finished = await running;
    assert.equal(finished.status, "done");
    assert.equal(callCount, 1);
    assert.equal(onPrivateRequest, null, "the task-scoped private permission is cleared when the task ends");
  } finally {
    done();
  }
});
