import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkCwd, checkShellCommand, cleanEnv, clipOutput, runCommand, runResultLine, SHELL_SECRET } from "./terminalServer.mjs";
import { createMcpHub, defaultMcpConfig, stdioConnect } from "./mcp.mjs";

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "preyas-shell-"));
}

function run(command, options = {}) {
  const { root, timeoutMs } = options;
  return runCommand(command, { allowedRoots: [root], cwd: root, timeoutMs, maxOutput: options.maxOutput ?? 4000 });
}

test("a command runs with a working folder limit and returns output", async () => {
  const root = tempDir();
  const result = await run("printf hello", { root });
  assert.equal(result.ok, true);
  assert.equal(result.timedOut, false);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /hello/);
});

test("the working folder cannot escape the allowed roots", () => {
  const root = tempDir();
  assert.throws(() => runCommand("echo hi", { allowedRoots: [root], cwd: "/etc" }), /outside the allowed folders/);
  assert.throws(() => runCommand("echo hi", { allowedRoots: [root], cwd: path.join(root, "..") }), /outside the allowed folders/);
});

test("a slow command is killed at the timeout", async () => {
  const root = tempDir();
  const started = Date.now();
  const result = await run("sleep 5", { root, timeoutMs: 300 });
  const elapsed = Date.now() - started;
  assert.equal(result.timedOut, true);
  assert.equal(result.ok, false);
  assert.ok(elapsed < 4000, `took ${elapsed} ms, the timeout did not kill it`);
});

test("output is capped at 4000 characters", async () => {
  const root = tempDir();
  // POSIX tools only: CI's /bin/sh has no brace expansion, and the sandbox
  // denies binaries outside the allowed roots.
  const result = await run("head -c 6000 /dev/zero | tr '\\0' x", { root });
  assert.ok(result.stdout.length <= 4000 + 40);
  assert.match(result.stdout, /capped at 4000 chars/);
});

test("commands that touch secret paths are refused", () => {
  assert.throws(() => checkShellCommand("cat /Volumes/Agent/agent/secrets/.env"), /secrets are off limits/);
  assert.throws(() => checkShellCommand("cat ~/.ssh/id_rsa"), /secrets are off limits/);
  assert.throws(() => checkShellCommand(""), /empty command/);
  assert.throws(() => checkShellCommand("x".repeat(4001)), /too long/);
  assert.throws(() => checkShellCommand("echo a\nrm -rf /"), /control characters/);
  // Any word containing "token" is refused on the safe side.
  assert.ok(SHELL_SECRET.test("ls my-token.txt"));
  assert.ok(SHELL_SECRET.test("grep token file"));
  assert.equal(SHELL_SECRET.test("echo hello"), false);
  assert.equal(SHELL_SECRET.test("grep -c data.txt"), false);
});

test("secret-looking environment variables never reach a child command", () => {
  const env = cleanEnv({ PATH: "/usr/bin", DEEPSEEK_API_KEY: "sk-123", HOME: "/tmp", NORMAL: "yes" });
  assert.equal(env.PATH, "/usr/bin");
  assert.equal(env.HOME, "/tmp");
  assert.equal(env.NORMAL, "yes");
  assert.equal(env.DEEPSEEK_API_KEY, undefined);
});

test("clipOutput and runResultLine stay under the caps", () => {
  assert.equal(clipOutput("abc"), "abc");
  assert.match(clipOutput("x".repeat(5000)), /capped/);
  assert.match(runResultLine({ ok: true, timedOut: false, ms: 3, stdout: "ok", stderr: "" }), /finished/);
  assert.match(runResultLine({ ok: false, timedOut: true, ms: 300, stdout: "", stderr: "" }), /timed out/);
});

test("the real terminal MCP server answers a tool call over stdio", async () => {
  const root = tempDir();
  const config = defaultMcpConfig({ repoRoot: root, dataDir: tempDir() });
  config.servers.shell.roots = [root];
  const hub = createMcpHub({
    config,
    connect: (moduleName, serverConfig, ctx) => stdioConnect(moduleName, serverConfig, { env: process.env, dataDir: ctx.dataDir }),
  });
  try {
    const specs = await hub.listTools();
    const names = specs.map((spec) => spec.name);
    assert.ok(names.includes("shell_run"), names.join(","));

    const text = await hub.callTool("shell_run", { command: "printf preyas-shell-ok" });
    assert.match(text, /preyas-shell-ok/);
    assert.match(text, /finished/);

    const refused = await hub.callTool("shell_run", { command: "cat /Volumes/Agent/agent/secrets/.env" });
    assert.match(refused, /secrets are off limits/);
  } finally {
    await hub.stop();
  }
});

test("the real filesystem MCP server lists, writes and reads inside its roots", async () => {
  const root = fs.realpathSync(tempDir()); // macOS: /var is a symlink to /private/var
  const config = defaultMcpConfig({ repoRoot: tempDir(), dataDir: tempDir() });
  config.servers.files.roots = [root];
  config.servers.shell.enabled = false;
  config.servers.browser.enabled = false;
  const hub = createMcpHub({
    config,
    connect: (moduleName, serverConfig, ctx) => stdioConnect(moduleName, serverConfig, { env: process.env, dataDir: ctx.dataDir }),
  });
  try {
    const specs = await hub.listTools();
    const names = specs.map((spec) => spec.name);
    for (const wanted of ["files_read_text_file", "files_write_file", "files_list_directory", "files_search_files"]) {
      assert.ok(names.includes(wanted), `${wanted} missing from ${names.join(",")}`);
    }

    await hub.callTool("files_write_file", { path: path.join(root, "hello.txt"), content: "hi from mcp" });
    const read = await hub.callTool("files_read_text_file", { path: path.join(root, "hello.txt") });
    assert.match(read, /hi from mcp/);

    // The filesystem server itself refuses escapes outside its allowed roots.
    const outside = await hub.callTool("files_read_text_file", { path: "/etc/passwd" });
    assert.match(outside, /outside|not allowed|denied|error/i);
  } finally {
    await hub.stop();
  }
});

test("checkCwd follows symlinks so a link cannot escape either", () => {
  const root = tempDir();
  const outside = tempDir();
  fs.symlinkSync(outside, path.join(root, "link"));
  assert.throws(() => checkCwd(path.join(root, "link"), [root]), /outside the allowed folders/);
  assert.equal(checkCwd(root, [root]), fs.realpathSync(root));
});

test("the working folder cannot be a secret folder, even under a root", () => {
  const root = tempDir();
  fs.mkdirSync(path.join(root, "secrets"), { recursive: true });
  fs.mkdirSync(path.join(root, "agent", "secrets"), { recursive: true });
  fs.mkdirSync(path.join(root, ".ssh"), { recursive: true });
  assert.throws(() => checkCwd(path.join(root, "secrets"), [root]), /secrets are off limits/);
  assert.throws(() => checkCwd(path.join(root, "agent", "secrets"), [root]), /secrets are off limits/);
  assert.throws(() => checkCwd(path.join(root, ".ssh"), [root]), /secrets are off limits/);
  // A symlink to a secret folder is refused too: the real path is checked.
  fs.symlinkSync(path.join(root, "secrets"), path.join(root, "innocent-link"));
  assert.throws(() => checkCwd(path.join(root, "innocent-link"), [root]), /secrets are off limits/);
  // A normal folder still works.
  assert.equal(checkCwd(root, [root]), fs.realpathSync(root));
});

test("~/ paths expand to the home folder, which is outside every root", () => {
  const root = tempDir();
  assert.throws(() => checkCwd("~", [root]), /outside the allowed folders/);
  assert.throws(() => checkCwd("~/Documents", [root]), /outside the allowed folders/);
});

test("the module entry points exist next to the brain server", () => {
  const brainDir = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
  for (const relative of [
    "node_modules/@modelcontextprotocol/server-filesystem/dist/index.js",
    "node_modules/@playwright/mcp/cli.js",
    "node_modules/@modelcontextprotocol/sdk/package.json",
  ]) {
    assert.ok(fs.existsSync(path.join(brainDir, relative)), `${relative} is missing; run npm install in brain-server`);
  }
});
