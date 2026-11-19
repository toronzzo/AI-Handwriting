import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import {
  CliAdapter,
  FakeAdapter,
  HarnessNotConfigured,
  NotImplementedAdapter,
  cliSpawnArgs,
  cliPaths,
  pickAdapter,
} from "./adapter.mjs";

const PRICES = {
  HARNESS_USD_PER_MTOK_IN: "0.14",
  HARNESS_USD_PER_MTOK_OUT: "0.28",
  HARNESS_OUT_TOKENS_MAX: "2000",
};

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "preyas-harness-adapter-"));
}

/** A child process double: no OS process, just the streams the adapter uses. */
function fakeChild() {
  const child = new EventEmitter();
  child.pid = 4242;
  child.exitCode = null;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = {
    written: "",
    ended: false,
    write(chunk) {
      this.written += String(chunk);
    },
    end() {
      this.ended = true;
    },
  };
  child.kill = () => {};
  return child;
}

test("FakeAdapter: estimate needs prices, run reports steps and a canned report", async () => {
  const priced = new FakeAdapter({ env: PRICES, delayMs: 1, steps: [{ tool: "read_file", delayMs: 1 }] });
  assert.ok((await priced.estimate("hello")).usdHigh > 0);
  assert.equal(await new FakeAdapter({ env: {} }).estimate("hello"), null);

  const events = [];
  const result = await priced.run("the prompt", (event) => events.push(event));
  assert.equal(result.ok, true);
  assert.match(result.report, /Fake run finished/);
  assert.equal(result.usdBasis, "fake");
  assert.equal(priced.runCalls, 1);
  assert.equal(events.length, 2);
  assert.equal(events[0].status, "running");
  assert.equal(events[1].status, "done");
  assert.equal(events[0].id, events[1].id);
});

test("FakeAdapter: stop() ends the run quickly and a later run still works", async () => {
  const adapter = new FakeAdapter({ env: PRICES, delayMs: 50, steps: [{ tool: "read_file", delayMs: 500 }] });
  const running = adapter.run("prompt", () => {});
  await new Promise((resolve) => setTimeout(resolve, 5));
  await adapter.stop();
  const result = await running;
  assert.equal(result.ok, false);
  assert.match(result.report, /Stopped/);
  // The next run is a new generation and is not stopped.
  const next = await adapter.run("prompt again", () => {});
  assert.equal(next.ok, true);
  assert.equal(adapter.runCalls, 2);
});

test("NotImplementedAdapter: the estimate works, run throws HarnessNotConfigured", async () => {
  const adapter = new NotImplementedAdapter({ env: PRICES });
  assert.equal(adapter.name, "not-configured");
  assert.ok((await adapter.estimate("hello")).usdHigh > 0);
  await assert.rejects(() => adapter.run("x", () => {}), HarnessNotConfigured);
  await adapter.stop(); // safe with nothing running
});

test("pickAdapter: explicit fake wins, a real CLI is chosen when found, else not-configured", () => {
  assert.equal(pickAdapter({ HARNESS_ADAPTER: "fake" }).name, "fake");
  const missing = pickAdapter({
    HARNESS_CLI_BIN: "/this/does/not/exist/bin.js",
    HARNESS_CLI_RUNTIME: "/this/does/not/exist/node",
  });
  assert.equal(missing.name, "not-configured");
});

test("cliPaths + cliSpawnArgs: the documented headless flags are used", () => {
  const dir = tempDir();
  try {
    const bin = path.join(dir, "bin.js");
    const runtime = path.join(dir, "runtime");
    fs.writeFileSync(bin, "");
    fs.writeFileSync(runtime, "");
    assert.deepEqual(cliPaths({ HARNESS_CLI_BIN: bin, HARNESS_CLI_RUNTIME: runtime }), { bin, runtime });
    assert.equal(cliPaths({ HARNESS_CLI_BIN: bin, HARNESS_CLI_RUNTIME: path.join(dir, "nope") }), null);
    const args = cliSpawnArgs(bin);
    assert.equal(args[0], "--expose-internals");
    assert.equal(args[1], bin);
    assert.deepEqual(args.slice(2), [
      "headless",
      "--json",
      "--permission-mode",
      "workspace-write",
      "--approval-policy",
      "never",
      "-",
    ]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("CliAdapter parses the documented NDJSON stream without spawning anything real", async () => {
  const dir = tempDir();
  try {
    const bin = path.join(dir, "bin.js");
    const runtime = path.join(dir, "runtime");
    fs.writeFileSync(bin, "");
    fs.writeFileSync(runtime, "");
    const child = fakeChild();
    const calls = [];
    const adapter = new CliAdapter({
      env: {
        ...PRICES,
        HARNESS_CLI_BIN: bin,
        HARNESS_CLI_RUNTIME: runtime,
      },
      cwd: dir,
      spawnImpl: (command, args, options) => {
        calls.push({ command, args, options });
        return child;
      },
      killProcess: () => {},
    });
    adapter.setSecrets({ DEEPSEEK_API_KEY: "sk-test-value-abcdef" });

    const events = [];
    const running = adapter.run("the prompt", (event) => events.push(event));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].command, runtime);
    assert.equal(calls[0].options.cwd, dir);
    assert.equal(calls[0].options.detached, true);
    assert.equal(calls[0].options.env.DEEPSEEK_API_KEY, "sk-test-value-abcdef");
    assert.equal(calls[0].options.env.ELECTRON_RUN_AS_NODE, "1");
    assert.ok(calls[0].args.includes("headless"));
    assert.equal(child.stdin.written, "the prompt");
    assert.equal(child.stdin.ended, true);

    const lines = [
      { type: "session", sessionId: "session-1", cwd: dir },
      { type: "status", phase: "step_start", turn: 1, step: 1 },
      { type: "tool_call", callId: "c1", tool: "bash", input: { command: "npm test" } },
      { type: "tool_result", callId: "c1", status: "completed", result: "ok" },
      { type: "status", phase: "step_end", turn: 1, step: 1, usage: { inputTokens: 1000, outputTokens: 500 } },
      { type: "final", sessionId: "session-1", reason: { kind: "completed" }, text: "Done. https://github.com/owner/repo/pull/12" },
    ];
    child.stdout.emit("data", Buffer.from(`${lines.map((line) => JSON.stringify(line)).join("\n")}\n`));
    child.exitCode = 0;
    child.emit("close");

    const result = await running;
    assert.equal(result.ok, true);
    assert.match(result.report, /^Done\./);
    assert.equal(result.prUrl, "https://github.com/owner/repo/pull/12");
    assert.equal(result.usdBasis, "tokens x brain.env price");
    const toolEvents = events.filter((event) => event.kind === "tool");
    assert.equal(toolEvents.length, 2);
    assert.equal(toolEvents[0].status, "running");
    assert.equal(toolEvents[0].tool, "bash");
    assert.match(toolEvents[0].detail, /npm test/);
    assert.equal(toolEvents[1].status, "done");
    assert.equal(toolEvents[0].id, toolEvents[1].id);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("CliAdapter: a nonzero exit or a non-completed reason is not success", async () => {
  const dir = tempDir();
  try {
    const bin = path.join(dir, "bin.js");
    const runtime = path.join(dir, "runtime");
    fs.writeFileSync(bin, "");
    fs.writeFileSync(runtime, "");
    const child = fakeChild();
    const adapter = new CliAdapter({
      env: PRICES,
      paths: { bin, runtime },
      cwd: dir,
      spawnImpl: () => child,
      killProcess: () => {},
    });
    const running = adapter.run("the prompt", () => {});
    child.stdout.emit(
      "data",
      Buffer.from(`${JSON.stringify({ type: "final", reason: { kind: "aborted" }, text: "" })}\n`),
    );
    child.exitCode = 1;
    child.emit("close");
    const result = await running;
    assert.equal(result.ok, false);
    assert.match(result.report, /without a final report/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("CliAdapter refuses to run without the CLI", async () => {
  const adapter = new CliAdapter({
    env: { HARNESS_CLI_BIN: "/nope/bin.js", HARNESS_CLI_RUNTIME: "/nope/node" },
  });
  await assert.rejects(() => adapter.run("x", () => {}), HarnessNotConfigured);
});
