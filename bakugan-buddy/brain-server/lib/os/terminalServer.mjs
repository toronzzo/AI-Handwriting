/**
 * Preyas's terminal: a tiny MCP server with ONE tool, `run`, which executes a
 * single shell command with a hard timeout and a small output cap. The working
 * folder may only be one of the allowed roots (by default /Volumes/Agent and
 * the repo folder), and the real path is checked — `..`, symlinks and `~`
 * cannot escape, and secret folders (secrets, .env, keys, tokens, .ssh) are
 * off limits as a starting point. On macOS the command itself runs inside a
 * sandbox-exec profile built from the same roots: no reads or writes outside
 * them, no network, so `cat /etc/hosts` is refused by the OS, not just by the
 * checks. Commands that mention secret paths are refused here AND by the
 * guard (defence in depth).
 *
 * Run over stdio: `node terminalServer.mjs --allowed-root <dir> ...`
 * Options: --allowed-root <dir> (repeatable), --timeout-ms <ms> (default 60000),
 * --max-output <chars> (default 4000).
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveSafePath } from "../safeFs.mjs";
import { confineCommand } from "./sandbox.mjs";

export const DEFAULT_TIMEOUT_MS = 60_000;
export const DEFAULT_MAX_OUTPUT = 4_000;

/** Secret-looking PATH SEGMENTS inside a shell command line. The bare word
 * "token" in prose is allowed; file-like names (my-token.txt, .env, id_rsa,
 * ~/.ssh) are refused. The guard (guardRules.mjs) imports the same regex. */
export const SHELL_SECRET =
  /(^|[\/\s"'`])(secrets|\.env(\..*)?|[a-z0-9_.-]*\.pem|[a-z0-9_.-]*\.key|id_rsa[a-z0-9_.-]*|[a-z0-9_.-]*token[a-z0-9_.-]*)(\/|$|\s|["'`])|(^|[\/\s"'`])~?\/\.ssh([\/\s"'`]|$)/i;

/** Secret-looking segments in a PATH (cwd or upload): the secrets folder,
 * .env files, keys, tokens and .ssh. guardRules.mjs re-exports this as
 * SECRET_SEGMENT so both checks are the one same list. */
export const SECRET_PATH_SEGMENT =
  /(^|\/)(secrets|\.env(\..*)?|.*\.pem|.*\.key|id_rsa.*|.*token.*|\.ssh)($|\/)/i;

export function checkShellCommand(command) {
  if (typeof command !== "string" || !command.trim()) throw new Error("empty command");
  if (command.length > 4000) throw new Error("command is too long (4000 chars max)");
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(command)) throw new Error("command contains control characters");
  if (SHELL_SECRET.test(command)) throw new Error("secrets are off limits");
  return String(command);
}

/** "~" and "~/x" mean the user's home folder, like the shell reads them. */
function expandHome(wanted) {
  if (wanted === "~") return os.homedir();
  if (wanted.startsWith("~/")) return path.join(os.homedir(), wanted.slice(2));
  return wanted;
}

/**
 * The cwd must resolve inside one of the allowed roots — `..` segments and
 * symlinks included (the real path is checked, so a link cannot escape), and
 * `~` expands to the home folder (which is outside every root and refused).
 * Secret folders (secrets, .env, keys, tokens, .ssh) are off limits even
 * inside a root, so a command cannot start there and read them with "cat *".
 */
export function checkCwd(cwd, allowedRoots) {
  const wanted = expandHome(String(cwd || allowedRoots[0] || process.cwd()));
  if (SECRET_PATH_SEGMENT.test(wanted)) throw new Error("secrets are off limits");
  for (const root of allowedRoots) {
    let resolved;
    try {
      resolved = resolveSafePath(wanted, root);
    } catch {
      continue;
    }
    if (SECRET_PATH_SEGMENT.test(resolved)) throw new Error("secrets are off limits");
    if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) return resolved;
  }
  throw new Error(`the working folder "${wanted}" is outside the allowed folders`);
}

/** Keys that could carry secrets must never reach a child command. */
export function cleanEnv(env = process.env) {
  const out = {};
  for (const [key, value] of Object.entries(env)) {
    if (/KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL/i.test(key)) continue;
    out[key] = value;
  }
  return out;
}

/**
 * Run one command: execFile with an argument array and a timeout, never a
 * shell string API. On macOS the command runs inside a sandbox-exec profile
 * built from the allowed roots (no reads or writes outside them, no
 * network), so a command cannot reach /etc or home even if it tries.
 * Returns {stdout, stderr, exitCode, timedOut, ms}.
 */
export function runCommand(command, options = {}) {
  const {
    allowedRoots = [],
    cwd = "",
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxOutput = DEFAULT_MAX_OUTPUT,
    env = cleanEnv(),
    extraRead = [],
  } = options;
  const safeCommand = checkShellCommand(command);
  const safeCwd = checkCwd(cwd, allowedRoots.length ? allowedRoots : [process.cwd()]);
  const runner = (options.confine ?? confineCommand)(safeCommand, { roots: allowedRoots, extraRead });
  return new Promise((resolve) => {
    const started = Date.now();
    execFile(
      runner.command,
      runner.args,
      {
        cwd: safeCwd,
        env,
        timeout: timeoutMs,
        maxBuffer: 1024 * 1024,
        killSignal: "SIGKILL",
      },
      (error, stdout, stderr) => {
        const ms = Date.now() - started;
        const timedOut = Boolean(error && error.killed);
        if (error && !timedOut) {
          resolve({
            ok: false,
            exitCode: typeof error.code === "number" ? error.code : null,
            timedOut: false,
            ms,
            stdout: clipOutput(String(stdout || ""), maxOutput),
            stderr: clipOutput(String(stderr || error.message || ""), maxOutput),
          });
          return;
        }
        resolve({
          ok: !timedOut,
          exitCode: timedOut ? null : 0,
          timedOut,
          ms,
          stdout: clipOutput(String(stdout || ""), maxOutput),
          stderr: clipOutput(String(stderr || ""), maxOutput),
        });
      },
    );
  });
}

export function clipOutput(text, maxOutput = DEFAULT_MAX_OUTPUT) {
  const capped = String(text ?? "");
  if (capped.length <= maxOutput) return capped;
  return `${capped.slice(0, maxOutput)}\n…(output capped at ${maxOutput} chars)`;
}

/** One line of human text for the model, safe to paste into a prompt. */
export function runResultLine(result) {
  const out = result.stdout ? `\n${result.stdout}` : "";
  const err = result.stderr ? `\nstderr: ${result.stderr}` : "";
  const state = result.timedOut
    ? "timed out"
    : result.ok
      ? "finished"
      : `failed (exit ${result.exitCode})`;
  return `The command ${state} in ${result.ms} ms.${out}${err}`;
}

export function createTerminalServer(options = {}) {
  const { allowedRoots = [], timeoutMs = DEFAULT_TIMEOUT_MS, maxOutput = DEFAULT_MAX_OUTPUT, env } = options;
  const server = new McpServer({ name: "preyas-terminal", version: "0.1.0" });
  server.registerTool(
    "run",
    {
      title: "Run a shell command",
      description:
        "Run ONE shell command in a terminal. There is a hard time limit (default 60 seconds) and the output is capped. Use absolute paths. The command runs in the allowed folders only.",
      inputSchema: {
        command: z.string().describe("The exact shell command to run, one line"),
        cwd: z.string().optional().describe("Working folder; must be one of the allowed folders"),
      },
    },
    async ({ command, cwd }) => {
      try {
        const result = await runCommand(command, { allowedRoots, cwd, timeoutMs, maxOutput, env });
        return { content: [{ type: "text", text: runResultLine(result) }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Refused: ${error instanceof Error ? error.message : String(error)}` }] };
      }
    },
  );
  return server;
}

function cliRoots(argv) {
  const roots = [];
  for (let index = 2; index < argv.length; index += 1) {
    if (argv[index] === "--allowed-root" && argv[index + 1]) roots.push(path.resolve(argv[index + 1]));
  }
  return roots;
}

function cliFlag(argv, name, fallback) {
  const index = argv.indexOf(name);
  if (index < 0 || !argv[index + 1]) return fallback;
  const value = Number(argv[index + 1]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  const args = process.argv.slice(2);
  const server = createTerminalServer({
    allowedRoots: cliRoots([process.argv[0], process.argv[1], ...args]),
    timeoutMs: cliFlag(args, "--timeout-ms", DEFAULT_TIMEOUT_MS),
    maxOutput: cliFlag(args, "--max-output", DEFAULT_MAX_OUTPUT),
  });
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
