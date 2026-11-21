import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createMcpHub,
  defaultMcpConfig,
  flattenToolResult,
  loadMcpConfig,
  MCP_IDLE_MS,
  MAX_TOOL_RESULT_CHARS,
  spawnArgs,
  splitToolName,
  toOpenAiTools,
} from "./mcp.mjs";
import { browserToolSpecs } from "./browserTools.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FAKE_SERVER = path.join(HERE, "fixtures", "fake-mcp-server.mjs");

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "preyas-mcp-"));
}

/** A connect() that spawns the fake stdio server for one module. */
function fakeConnect(recorder) {
  return async (moduleName) => {
    recorder.push({ module: moduleName });
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
    const client = new Client({ name: "test", version: "1.0.0" });
    const transport = new StdioClientTransport({ command: process.execPath, args: [FAKE_SERVER], stderr: "ignore" });
    await client.connect(transport);
    return {
      module: moduleName,
      listTools: async () => (await client.listTools()).tools,
      callTool: async (name, arguments_) => client.callTool({ name, arguments: arguments_ }),
      close: async () => client.close(),
    };
  };
}

test("loadMcpConfig writes a default file and only narrows roots", () => {
  const dataDir = tempDir();
  const repo = tempDir();
  const { config, file, warnings } = loadMcpConfig(dataDir, { repoRoot: repo });
  assert.ok(fs.existsSync(file));
  assert.equal(config.servers.files.roots.length, 2);
  assert.equal(config.servers.browser.idleMs, MCP_IDLE_MS);
  assert.deepEqual(warnings, []);

  // Roots outside the two safe roots are dropped with a warning.
  fs.writeFileSync(
    file,
    JSON.stringify({ servers: { files: { roots: ["/etc", "/Volumes/Agent"] } } }),
  );
  const narrowed = loadMcpConfig(dataDir, { repoRoot: repo });
  assert.deepEqual(narrowed.config.servers.files.roots, ["/Volumes/Agent"]);
  assert.equal(narrowed.warnings.length, 1);

  // Broken JSON falls back to defaults without throwing.
  fs.writeFileSync(file, "{ not json");
  const broken = loadMcpConfig(dataDir, { repoRoot: repo });
  assert.equal(broken.config.servers.shell.timeoutMs, 60_000);
  assert.equal(broken.warnings.length, 1);
});

test("the hub lists tools from a fake server in OpenAI format", async () => {
  const recorder = [];
  const config = defaultMcpConfig({ repoRoot: tempDir(), dataDir: tempDir() });
  config.servers.shell.enabled = false;
  config.servers.browser.enabled = true;
  const hub = createMcpHub({ config, connect: fakeConnect(recorder) });
  try {
    const specs = await hub.listTools();
    const names = specs.map((spec) => spec.name);
    assert.ok(names.includes("files_ping"));
    assert.ok(names.includes("files_echo"));
    assert.ok(names.includes("browser_navigate"));
    assert.ok(names.includes("browser_snapshot"));
    assert.ok(!names.some((name) => name.startsWith("shell_")));
    // Listing never starts the browser server (lazy start).
    assert.equal(recorder.filter((row) => row.module === "browser").length, 0);
    assert.equal(recorder.filter((row) => row.module === "files").length, 1);

    const openai = toOpenAiTools(specs);
    const ping = openai.find((entry) => entry.function.name === "files_ping");
    assert.equal(ping.type, "function");
    assert.equal(ping.function.parameters.type, "object");
    assert.equal(openai.every((entry) => entry.function.parameters.$schema === undefined), true);
  } finally {
    await hub.stop();
  }
});

test("browser tools start lazily, stay up across calls, and stop after idle", async () => {
  const recorder = [];
  const closed = [];
  const config = defaultMcpConfig({ repoRoot: tempDir(), dataDir: tempDir() });
  config.servers.browser.idleMs = 500;
  let scheduled = null;
  const hub = createMcpHub({
    config,
    connect: async (moduleName) => {
      recorder.push({ module: moduleName });
      return {
        listTools: async () => [],
        callTool: async (name, args) => ({ content: [{ type: "text", text: `ran ${name}` }] }),
        close: async () => closed.push(moduleName),
      };
    },
    schedule: (fn) => {
      scheduled = fn;
      return 1;
    },
    clearTimer: () => {},
  });
  try {
    await hub.listTools(); // no browser connection yet
    assert.equal(recorder.filter((row) => row.module === "browser").length, 0);

    const first = await hub.callTool("browser_navigate", { url: "https://example.com" });
    assert.equal(first, "ran browser_navigate");
    assert.equal(hub.browserRunning(), true);
    assert.equal(recorder.filter((row) => row.module === "browser").length, 1);

    const second = await hub.callTool("browser_snapshot", {});
    assert.equal(second, "ran browser_snapshot");
    assert.equal(recorder.filter((row) => row.module === "browser").length, 1); // reused

    // The idle clock fires: the server is stopped, the next call reconnects.
    assert.ok(scheduled);
    scheduled();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(hub.browserRunning(), false);
    assert.deepEqual(closed, ["browser"]);

    await hub.callTool("browser_navigate", { url: "https://example.com" });
    assert.equal(recorder.filter((row) => row.module === "browser").length, 2);
  } finally {
    await hub.stop();
  }
});

test("callTool routes by prefix, flattens content and caps long results", async () => {
  const config = defaultMcpConfig({ repoRoot: tempDir(), dataDir: tempDir() });
  config.servers.files.enabled = false;
  config.servers.browser.enabled = false;
  const hub = createMcpHub({
    config,
    connect: async () => ({
      listTools: async () => [],
      callTool: async (name, args) => ({
        content: [
          {
            type: "text",
            text: name === "run" && args.command === "yes" ? "x".repeat(MAX_TOOL_RESULT_CHARS + 500) : "ok",
          },
        ],
      }),
      close: async () => {},
    }),
  });
  try {
    assert.deepEqual(splitToolName("files_read_file"), { module: "files", tool: "read_file" });
    assert.equal(splitToolName("browser_navigate").module, "browser");
    assert.equal(splitToolName("read_file"), null);

    assert.equal(await hub.callTool("shell_run", { command: "echo hi" }), "ok");
    const capped = await hub.callTool("shell_run", { command: "yes" });
    assert.equal(capped.length, MAX_TOOL_RESULT_CHARS);

    await assert.rejects(() => hub.callTool("files_read_text_file", { path: "x" }), /disabled/);
    await assert.rejects(() => hub.callTool("nope", {}), /unknown tool/);
  } finally {
    await hub.stop();
  }
});

test("flattenToolResult keeps errors visible and marks non-text parts", () => {
  assert.equal(flattenToolResult({ content: [{ type: "text", text: "a\nb" }] }), "a\nb");
  assert.equal(flattenToolResult({ content: [{ type: "image", mimeType: "image/png" }] }), "[image: image/png]");
  assert.match(flattenToolResult({ content: [{ type: "text", text: "bad" }], isError: true }), /^Tool error: bad$/);
  assert.equal(flattenToolResult({ content: [] }), "(empty result)");
});

test("every curated browser tool is a known guard kind", async () => {
  const { KINDS } = await import("./guardRules.mjs");
  const names = browserToolSpecs().map((spec) => spec.name);
  for (const name of names) {
    const known = Object.values(KINDS).some((set) => set.has(name));
    assert.ok(known, `${name} is missing from guard KINDS`);
  }
});

test("the browser MCP server routes traffic through the private-network proxy", () => {
  const { args } = spawnArgs("browser", { outputDir: "/tmp/shots", proxyServer: "http://127.0.0.1:12345" });
  assert.deepEqual(args.slice(-4), ["--proxy-server", "http://127.0.0.1:12345", "--proxy-bypass", "<-loopback>"]);
});

test("the browser hub starts a loopback proxy before connecting the MCP server", async () => {
  const config = defaultMcpConfig({ repoRoot: tempDir(), dataDir: tempDir() });
  let browserConfig = null;
  const hub = createMcpHub({
    config,
    connect: async (moduleName, serverConfig) => {
      if (moduleName === "browser") browserConfig = serverConfig;
      return { listTools: async () => [], callTool: async () => ({ content: [] }), close: async () => {} };
    },
  });
  try {
    await hub.callTool("browser_snapshot", {});
    assert.match(browserConfig.proxyServer, /^http:\/\/127\.0\.0\.1:\d+$/);
  } finally {
    await hub.stop();
  }
});
