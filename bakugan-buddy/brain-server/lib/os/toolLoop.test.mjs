import { test } from "node:test";
import assert from "node:assert/strict";
import {
  gatewayChat,
  labelForTool,
  localChat,
  parseLocalReply,
  runToolLoop,
  toGatewayMessages,
  toLocalMessages,
  TOOL_LOOP_MAX_STEPS,
  toolListPrompt,
  trimLocalLog,
} from "./toolLoop.mjs";

function makeTask(overrides = {}) {
  return {
    id: "task-1",
    title: "list the files in my Data Warehouses folder",
    chatId: "chat-1",
    status: "planned",
    steps: [],
    created: 1,
    updated: 1,
    ...overrides,
  };
}

const READ = { name: "files_read_text_file", args: { path: "/Volumes/Agent/agent/notes/a.md" } };
const WRITE = { name: "files_write_file", args: { path: "/Volumes/Agent/agent/tmp/test.txt", content: "hi" } };
const SHELL = { name: "shell_run", args: { command: "printf hi" } };

/** A model that always asks for one tool, then answers when tools are off. */
function toolThenAnswer(tool = READ, answer = "final answer") {
  const calls = [];
  return {
    calls,
    model: async (log, { allowTools }) => {
      calls.push({ allowTools, log });
      if (!allowTools) return { answer, model: "deepseek-flash" };
      return { toolCalls: [tool], model: "deepseek-flash" };
    },
  };
}

function baseDeps(overrides = {}) {
  const seen = [];
  return {
    callModel: async () => ({ answer: "done" }),
    review: async () => ({ verdict: "allow", why: "" }),
    execute: async (name, args) => {
      seen.push({ name, args });
      return "ok";
    },
    confirm: async () => "yes",
    save: () => {},
    seen,
    ...overrides,
  };
}

test("the loop answers immediately when the model needs no tool", async () => {
  const task = makeTask();
  const calls = [];
  const deps = baseDeps();
  deps.callModel = async () => {
    calls.push(1);
    return { answer: "Example Domain", model: "deepseek-flash" };
  };
  const finished = await runToolLoop(task, deps);
  assert.equal(finished.status, "done");
  assert.equal(finished.answer, "Example Domain");
  assert.deepEqual(finished.steps, []);
  assert.equal(calls.length, 1);
});

test("the loop stops at 15 tool steps and then gives one final answer", async () => {
  const task = makeTask();
  const model = toolThenAnswer(READ, "the listing is done");
  const deps = baseDeps({ callModel: model.model });
  const finished = await runToolLoop(task, deps);
  assert.equal(finished.steps.length, TOOL_LOOP_MAX_STEPS);
  assert.equal(finished.status, "done");
  assert.equal(finished.answer, "the listing is done");
  // 15 tool rounds + exactly one final no-tools round, never a 16th tool.
  assert.equal(model.calls.length, 16);
  assert.equal(model.calls.filter((call) => call.allowTools).length, 15);
  assert.equal(model.calls.filter((call) => !call.allowTools).length, 1);
  assert.equal(deps.seen.length, 15);
});

test("only ONE tool call runs per step even if the model returns several", async () => {
  const task = makeTask();
  let round = 0;
  const model = async (log, { allowTools }) => {
    round += 1;
    if (!allowTools || round > 1) return { answer: "done", model: "deepseek-flash" };
    return { toolCalls: [READ, WRITE, SHELL], model: "deepseek-flash" };
  };
  const deps = baseDeps({ callModel: model });
  const finished = await runToolLoop(task, deps);
  assert.equal(finished.steps.length, 1);
  assert.deepEqual(deps.seen, [{ name: READ.name, args: READ.args }]);
  assert.equal(finished.steps[0].text, labelForTool(READ.name, READ.args));
});

test("a blocked tool step is reported and the loop goes on", async () => {
  const task = makeTask();
  let round = 0;
  const model = async (log, { allowTools }) => {
    round += 1;
    if (!allowTools) return { answer: "I could not read it.", model: "deepseek-flash" };
    return round === 1
      ? { toolCalls: [READ], model: "deepseek-flash" }
      : { answer: "I could not read it.", model: "deepseek-flash" };
  };
  const deps = baseDeps({ callModel: model, review: async () => ({ verdict: "block", why: "secrets are off limits" }) });
  const finished = await runToolLoop(task, deps);
  assert.equal(finished.steps.length, 1);
  assert.match(finished.steps[0].result, /Blocked by the guard: secrets are off limits/);
  assert.equal(finished.status, "done");
  assert.equal(finished.answer, "I could not read it.");
  assert.equal(deps.seen.length, 0);
});

test("writes and shell commands wait for a Yes/No card, reads do not", async () => {
  // Read first: no confirm, executed at once.
  const readTask = makeTask();
  const readDeps = baseDeps({
    callModel: (() => {
      let round = 0;
      return async (log, { allowTools }) => {
        round += 1;
        if (!allowTools || round > 1) return { answer: "read", model: "deepseek-flash" };
        return { toolCalls: [READ], model: "deepseek-flash" };
      };
    })(),
    review: async () => ({ verdict: "allow", why: "reading is safe" }),
  });
  const readConfirm = [];
  readDeps.confirm = async () => {
    readConfirm.push(1);
    return "yes";
  };
  const readDone = await runToolLoop(readTask, readDeps);
  assert.equal(readDone.steps[0].status, "done");
  assert.equal(readConfirm.length, 0);

  // Write: the guard asks, the card answers yes, the write runs.
  const writeTask = makeTask();
  const writeDeps = baseDeps({
    callModel: (() => {
      let round = 0;
      return async (log, { allowTools }) => {
        round += 1;
        if (!allowTools || round > 1) return { answer: "written", model: "deepseek-flash" };
        return { toolCalls: [WRITE], model: "deepseek-flash" };
      };
    })(),
    review: async () => ({ verdict: "ask", why: "writing or changing files needs your confirmation" }),
  });
  const writeConfirm = [];
  writeDeps.confirm = async (current, step, pending) => {
    writeConfirm.push({ stepId: step.id, why: pending.why, token: pending.token });
    return "yes";
  };
  const writeDone = await runToolLoop(writeTask, writeDeps);
  assert.equal(writeDone.steps[0].status, "done");
  assert.equal(writeConfirm.length, 1);
  assert.match(writeConfirm[0].why, /confirmation/);
  assert.equal(writeDeps.seen.length, 1);

  // Shell: the card says no, the command never runs, the task explains it.
  const shellTask = makeTask();
  const shellDeps = baseDeps({
    callModel: (() => {
      let round = 0;
      return async (log, { allowTools }) => {
        round += 1;
        if (!allowTools || round > 1) return { answer: "skipped", model: "deepseek-flash" };
        return { toolCalls: [SHELL], model: "deepseek-flash" };
      };
    })(),
    review: async () => ({ verdict: "ask", why: "running a shell command needs your confirmation" }),
    confirm: async () => "no",
  });
  const shellDone = await runToolLoop(shellTask, shellDeps);
  assert.equal(shellDone.steps[0].status, "done");
  assert.match(shellDone.steps[0].result, /You said no/);
  assert.equal(shellDeps.seen.length, 0);
});

test("a stale paused confirm from before a restart is closed silently", async () => {
  const task = makeTask({
    steps: [
      {
        id: 1,
        text: "Run x",
        status: "paused",
        tool: SHELL,
        pendingConfirm: { token: "t", why: "w", expiresAt: 1, answered: null },
      },
    ],
  });
  const confirm = [];
  const finished = await runToolLoop(task, {
    ...baseDeps({ callModel: async () => ({ answer: "done after restart" }) }),
    confirm: async () => {
      confirm.push(1);
      return "yes";
    },
  });
  assert.equal(finished.steps[0].status, "done");
  assert.match(finished.steps[0].result, /No answer in time/);
  assert.equal(confirm.length, 0);
  assert.equal(finished.answer, "done after restart");
});

test("gatewayChat parses tool calls and answers", async () => {
  const json = (body) =>
    Promise.resolve({
      ok: true,
      json: async () => JSON.parse(body),
    });
  let body;
  const fetchImpl = async (url, init) => {
    body = JSON.parse(init.body);
    if (body.tools && body.tools.length) {
      return json('{"choices":[{"message":{"tool_calls":[{"id":"c1","type":"function","function":{"name":"files_list_directory","arguments":"{\\"path\\":\\"/Volumes/Agent\\"}"}}]},"usage":{"prompt_tokens":10,"completion_tokens":5}}]}');
    }
    return json('{"choices":[{"message":{"content":"Example Domain"},"usage":{"prompt_tokens":10,"completion_tokens":5}}]}');
  };
  const withTools = await gatewayChat({ gatewayUrl: "http://gw", messages: [], tools: [{ type: "function", function: { name: "x", parameters: {} } }], fetchImpl });
  assert.deepEqual(withTools.toolCalls, [{ id: "c1", name: "files_list_directory", args: { path: "/Volumes/Agent" } }]);
  assert.equal(body.model, "deepseek-flash");
  const plain = await gatewayChat({ gatewayUrl: "http://gw", messages: [], fetchImpl });
  assert.equal(plain.answer, "Example Domain");

  const failing = async () => ({ ok: false, status: 500 });
  await assert.rejects(() => gatewayChat({ gatewayUrl: "http://gw", messages: [], fetchImpl: failing }), /gateway answered 500/);
});

test("localChat and parseLocalReply read the strict-JSON shape", async () => {
  assert.deepEqual(parseLocalReply('<think>x</think> {"tool":"files_list_directory","args":{"path":"/Volumes/Agent"}}'), {
    toolCalls: [{ id: "", name: "files_list_directory", args: { path: "/Volumes/Agent" } }],
  });
  assert.deepEqual(parseLocalReply('{"answer":"Example Domain"}'), { answer: "Example Domain" });
  assert.deepEqual(parseLocalReply("no json here"), {});

  const specs = [{ name: "files_list_directory", description: "List a folder", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } }];
  const messages = toLocalMessages(
    [
      { kind: "system", text: "s" },
      { kind: "user", text: "hi" },
    ],
    specs,
  );
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    assert.match(body.messages[0].content, /files_list_directory/); // tools in the prompt
    return { ok: true, json: async () => ({ choices: [{ message: { content: '{"answer":"local ok"}' } }] }) };
  };
  const result = await localChat({ llamaUrl: "http://llama", messages, fetchImpl });
  assert.equal(result.answer, "local ok");
});

test("toGatewayMessages and toLocalMessages keep the transcript coherent", () => {
  const log = [
    { kind: "system", text: "sys" },
    { kind: "user", text: "list files" },
    { kind: "toolcall", index: 1, name: "files_list_directory", args: { path: "/Volumes/Agent" } },
    { kind: "toolresult", index: 1, name: "files_list_directory", text: "a.txt" },
  ];
  const gateway = toGatewayMessages(log);
  assert.deepEqual(gateway.map((m) => m.role), ["system", "user", "assistant", "tool"]);
  assert.equal(gateway[2].tool_calls[0].function.name, "files_list_directory");
  assert.equal(gateway[3].tool_call_id, gateway[2].tool_calls[0].id);

  const local = toLocalMessages(log, [{ name: "files_list_directory", description: "d", parameters: { type: "object", properties: {} } }]);
  assert.match(local[0].content, /Available tools:/);
  assert.match(local[3].content, /Result of files_list_directory/);
});

test("toolListPrompt and trimLocalLog stay inside the local context budget", () => {
  const specs = [
    { name: "a", description: "first", parameters: { type: "object", properties: { x: { type: "string" } }, required: ["x"] } },
    { name: "b", description: "second", parameters: { type: "object", properties: {} } },
  ];
  const prompt = toolListPrompt(specs);
  assert.match(prompt, /- a\(x\): first/);

  const big = [
    { kind: "system", text: "sys" },
    { kind: "user", text: "hi" },
    ...Array.from({ length: 200 }, (_, index) => [
      { kind: "toolcall", index, name: "files_read_text_file", args: {} },
      { kind: "toolresult", index, name: "files_read_text_file", text: "x".repeat(500) },
    ]).flat(),
  ];
  const trimmed = trimLocalLog(big, 14_000);
  const total = trimmed.reduce((sum, entry) => sum + String(entry.text || "").length, 0);
  assert.ok(total <= 14_000);
  assert.equal(trimmed[0].kind, "system");
  assert.equal(trimmed[1].kind, "user");
});

test("labelForTool names the common tools for the task panel", () => {
  assert.equal(labelForTool("files_list_directory", { path: "/Volumes/Agent/agent" }), "List /Volumes/Agent/agent");
  assert.equal(labelForTool("search_notes", { query: "dentist" }), 'Search my notes for "dentist"');
  assert.equal(labelForTool("shell_run", { command: "printf hi" }), "Run printf hi");
  assert.equal(labelForTool("browser_navigate", { url: "https://example.com" }), "Open https://example.com");
  assert.equal(labelForTool("browser_click", { element: "Login" }), 'Click "Login"');
});

test("every model call and tool run lights the hands neuron up", async () => {
  const task = makeTask();
  const events = [];
  const brain = { emit: (event) => events.push(event) };
  let ms = 1_000;
  let calls = 0;
  const deps = baseDeps({
    brain,
    now: () => (ms += 10),
    callModel: async (log, { allowTools }) => {
      if (!allowTools) return { answer: "all done", model: "deepseek-flash", usage: { prompt_tokens: 12, completion_tokens: 8 } };
      calls += 1;
      if (calls > 1) return { answer: "all done", model: "deepseek-flash", usage: { prompt_tokens: 12, completion_tokens: 8 } };
      return { toolCalls: [READ], model: "deepseek-flash", usage: { prompt_tokens: 10, completion_tokens: 4 } };
    },
  });
  const finished = await runToolLoop(task, deps);
  assert.equal(finished.status, "done");

  const hands = events.filter((event) => event.neuron === "hands");
  assert.deepEqual(
    hands.map((event) => (event.detail ? `${event.state}:${event.detail}` : event.state)),
    [
      "thinking",
      "done:deepseek-flash",
      "thinking:Read /Volumes/Agent/agent/notes/a.md",
      "done:Read /Volumes/Agent/agent/notes/a.md",
      "thinking",
      "done:deepseek-flash",
    ],
  );
  for (const event of hands.filter((row) => row.state === "done" && row.detail === "deepseek-flash")) {
    assert.equal(typeof event.tps, "number");
    assert.ok(event.tps > 0, `tps reported: ${event.tps}`);
    assert.equal(typeof event.costUsd, "number");
    assert.ok(event.costUsd > 0, `paid cost reported: ${event.costUsd}`);
  }
});

test("a broken tool reports hands error, and a broken model call too", async () => {
  const task = makeTask();
  const events = [];
  const brain = { emit: (event) => events.push(event) };
  const deps = baseDeps({
    brain,
    callModel: async () => {
      throw new Error("model down");
    },
  });
  await assert.rejects(() => runToolLoop(task, deps), /model down/);
  assert.equal(events.filter((event) => event.neuron === "hands" && event.state === "error").length, 1);

  const task2 = makeTask();
  const events2 = [];
  let calls2 = 0;
  const deps2 = baseDeps({
    brain: { emit: (event) => events2.push(event) },
    callModel: async (log, { allowTools }) => {
      calls2 += 1;
      if (!allowTools || calls2 > 1) return { answer: "ok", model: "preyas", usage: {} };
      return { toolCalls: [WRITE], model: "preyas", usage: {} };
    },
    execute: async () => {
      throw new Error("no disk");
    },
  });
  const finished2 = await runToolLoop(task2, deps2);
  assert.equal(finished2.status, "done");
  const toolError = events2.filter((event) => event.state === "error");
  assert.equal(toolError.length, 1);
  assert.match(toolError[0].detail, /Write/);
});

test("localChat keeps the llama usage so the loop can report tokens/sec", async () => {
  const fake = async () => ({
    ok: true,
    json: async () => ({
      choices: [{ message: { content: '{"answer":"yes"}' } }],
      usage: { prompt_tokens: 11, completion_tokens: 3 },
    }),
  });
  const result = await localChat({ llamaUrl: "http://fake", fetchImpl: fake });
  assert.equal(result.answer, "yes");
  assert.deepEqual(result.usage, { prompt_tokens: 11, completion_tokens: 3 });
});
