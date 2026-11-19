/**
 * Harness adapters: the small surface between the runner and the outside world.
 *
 * Interface (documented here once):
 *
 *   HarnessAdapter {
 *     estimate(prompt: string): Promise<
 *       { inTokens, outTokensMax, usdLow, usdHigh, basis } | null
 *     >
 *     run(prompt: string, onEvent: (partial: ActivityEvent partial & { usd?: number }) => void):
 *       Promise<{ ok: boolean, report: string, prUrl?: string, usd?: number, usdBasis?: string }>
 *     stop(): Promise<void>
 *   }
 *
 * `onEvent` receives partials of Live Activity events (slice 12): the runner
 * adds the runId, redacts text and hands them to the shared hub. `partial.usd`
 * is an optional running cost the adapter observed; the runner stops the run
 * when it passes the daily cap.
 *
 * Adapters here:
 * - `FakeAdapter` — scripted steps with small timers and a canned report. It is
 *   what every test uses; it never touches the network.
 * - `NotImplementedAdapter` — the honest default when no documented CLI is
 *   found; `estimate` works, `run` refuses.
 * - `CliAdapter` — the real one: `dsh headless --json` with the prompt on
 *   stdin. See docs/HARNESS_CLI.md for how it was found and verified.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { estimatePrompt, priceConfigured, usdForTokens } from "./estimate.mjs";

/** Raised when a run is attempted without a working Harness install. */
export class HarnessNotConfigured extends Error {
  constructor(message) {
    super(message);
    this.name = "HarnessNotConfigured";
  }
}

/** Hard stop for one run when HARNESS_MAX_MINUTES is unset. */
export const DEFAULT_MAX_MINUTES = 30;

/** How long a stopped process may take to die before SIGKILL. */
export const KILL_GRACE_MS = 3000;

/** The installed DeepSeek Harness desktop on this Mac (docs/HARNESS_CLI.md). */
export const DEFAULT_APP_ROOT = "/Applications/DeepSeek Harness.app";
export const DEFAULT_CLI_BIN = path.join(
  DEFAULT_APP_ROOT,
  "Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js",
);
export const DEFAULT_CLI_RUNTIME = path.join(DEFAULT_APP_ROOT, "Contents/MacOS/DeepSeek Harness");

/** The repository root: the folder that contains bakugan-buddy/. */
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

/** The documented `dsh headless` flags this project uses; prompt goes on stdin. */
export const CLI_TASK_ARGS = [
  "headless",
  "--json",
  "--permission-mode",
  "workspace-write",
  "--approval-policy",
  "never",
  "-",
];

/**
 * cliPaths(env) -> { bin, runtime } | null. A documented non-interactive CLI was
 * found on this Mac (docs/HARNESS_CLI.md), so the real adapter is available.
 */
export function cliPaths(env = {}) {
  const bin = String(env.HARNESS_CLI_BIN || DEFAULT_CLI_BIN);
  const runtime = String(env.HARNESS_CLI_RUNTIME || DEFAULT_CLI_RUNTIME);
  try {
    if (!fs.statSync(bin).isFile()) return null;
    if (!fs.statSync(runtime).isFile()) return null;
  } catch {
    return null;
  }
  return { bin, runtime };
}

/** The full argv used to spawn the CLI (runtime flags, bin, task flags). */
export function cliSpawnArgs(binPath) {
  return ["--expose-internals", String(binPath), ...CLI_TASK_ARGS];
}

function maxMinutesOf(env = {}) {
  const value = Number(env.HARNESS_MAX_MINUTES);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_MAX_MINUTES;
}

/* ------------------------------------------------------------------ */
/* Fake                                                                */
/* ------------------------------------------------------------------ */

const DEFAULT_FAKE_STEPS = [
  { tool: "read_file", detail: "docs/HARNESS_CLI.md", delayMs: 4 },
  { tool: "run_tests", detail: "npm test", delayMs: 4 },
];

/**
 * A scripted adapter for tests and for HARNESS_ADAPTER=fake. Its timers are
 * small and cancellable, it honours stop(), and it never touches the network.
 */
export class FakeAdapter {
  constructor({
    env = process.env,
    steps = DEFAULT_FAKE_STEPS,
    report = "Fake run finished. Nothing was changed.",
    prUrl = "https://example.test/pull/1",
    usd,
    delayMs = 5,
  } = {}) {
    this.name = "fake";
    this.env = env;
    this.steps = Array.isArray(steps) ? steps : [];
    this.report = String(report ?? "");
    this.prUrl = prUrl;
    this.usd = usd;
    this.delayMs = delayMs;
    this.runCalls = 0;
    this.generation = 0;
    this.pending = new Set();
  }

  async estimate(prompt) {
    return estimatePrompt(prompt, this.env);
  }

  /** A cancellable pause; stop() resolves every waiter at once. */
  wait(ms) {
    return new Promise((resolve) => {
      const finish = () => {
        this.pending.delete(finish);
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(finish, Math.max(0, Number(ms) || 0));
      this.pending.add(finish);
    });
  }

  async run(prompt, onEvent = () => {}) {
    this.runCalls += 1;
    const generation = this.generation;
    const stopped = () => this.generation !== generation;
    for (let index = 0; index < this.steps.length; index += 1) {
      const step = this.steps[index];
      if (stopped()) break;
      const id = `fake-${this.runCalls}-${index + 1}`;
      const startedAt = Date.now();
      const base = {
        id,
        kind: step.kind || "tool",
        tool: String(step.tool || "harness"),
        label: String(step.label ?? ""),
        detail: step.detail === undefined ? undefined : String(step.detail),
        runId: "",
      };
      onEvent({
        ...base,
        status: "running",
        startedAt,
        ts: startedAt,
        ...(step.usd === undefined ? {} : { usd: Number(step.usd) }),
      });
      await this.wait(step.delayMs === undefined ? this.delayMs : step.delayMs);
      if (stopped()) break;
      const endedAt = Date.now();
      onEvent({
        ...base,
        status: step.status || "done",
        startedAt,
        endedAt,
        durationMs: Math.max(0, endedAt - startedAt),
        ts: endedAt,
      });
    }
    if (stopped()) {
      return { ok: false, report: "Stopped by the user.", usdBasis: "estimate" };
    }
    return {
      ok: true,
      report: this.report,
      prUrl: this.prUrl,
      ...(this.usd === undefined ? {} : { usd: Number(this.usd) }),
      usdBasis: "fake",
    };
  }

  async stop() {
    this.generation += 1;
    for (const finish of [...this.pending]) finish();
    this.pending.clear();
  }
}

/* ------------------------------------------------------------------ */
/* Not implemented                                                     */
/* ------------------------------------------------------------------ */

/**
 * The fail-closed adapter: the estimate still works (the app can show a price),
 * but a run throws HarnessNotConfigured with the TODO. This is the active
 * adapter whenever the documented CLI cannot be found.
 */
export class NotImplementedAdapter {
  constructor({ env = process.env } = {}) {
    this.name = "not-configured";
    this.env = env;
  }

  async estimate(prompt) {
    return estimatePrompt(prompt, this.env);
  }

  async run() {
    // TODO(harness-cli): real invocation is implemented in CliAdapter once the
    // installed CLI exposes the documented headless mode (see docs/HARNESS_CLI.md).
    throw new HarnessNotConfigured(
      "Harness is not connected yet. The documented non-interactive CLI was not found on this Mac.",
    );
  }

  async stop() {
    /* nothing to stop */
  }
}

/* ------------------------------------------------------------------ */
/* Real CLI                                                            */
/* ------------------------------------------------------------------ */

function clip(text, max) {
  const value = String(text ?? "");
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function toolDetail(input) {
  if (input === undefined || input === null) return "";
  if (typeof input === "string") return clip(input, 120);
  try {
    return clip(JSON.stringify(input), 120);
  } catch {
    return "";
  }
}

/**
 * CliAdapter spawns the installed DeepSeek Harness CLI in its documented
 * headless mode. The prompt goes on stdin; stdout is parsed as newline-delimited
 * JSON; secret values reach the child only through its environment.
 *
 * Never prints or logs the prompt, output or environment.
 */
export class CliAdapter {
  constructor({
    env = process.env,
    cwd,
    spawnImpl = spawn,
    killProcess = (pid, signal) => process.kill(pid, signal),
    maxMinutes,
    paths,
  } = {}) {
    this.name = "cli";
    this.env = env;
    this.secretEnv = {};
    this.cwd = cwd || env.HARNESS_CWD || REPO_ROOT;
    this.spawnImpl = spawnImpl;
    this.killProcess = killProcess;
    this.maxMinutes = maxMinutes || maxMinutesOf(env);
    this.paths = paths || cliPaths(env);
    this.child = null;
    this.generation = 0;
  }

  /** The runner hands the values it read from secrets/.env to the child env. */
  setSecrets(envMap) {
    this.secretEnv = envMap && typeof envMap === "object" ? { ...envMap } : {};
  }

  async estimate(prompt) {
    return estimatePrompt(prompt, this.env);
  }

  /** Send the signal to the whole process group of one child. */
  signalGroup(pid, signal) {
    try {
      this.killProcess(-Math.abs(pid), signal);
    } catch {
      try {
        this.killProcess(Math.abs(pid), signal);
      } catch {
        /* it may already be gone */
      }
    }
  }

  async stop() {
    this.generation += 1;
    const child = this.child;
    if (!child || child.exitCode !== null) return;
    const pid = Number(child.pid);
    if (pid) this.signalGroup(pid, "SIGTERM");
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (child.exitCode === null && pid) this.signalGroup(pid, "SIGKILL");
        resolve();
      }, KILL_GRACE_MS);
      const finish = () => {
        clearTimeout(timer);
        resolve();
      };
      if (typeof child.once === "function") child.once("exit", finish);
      else finish();
    });
    this.child = null;
  }

  /**
   * run(prompt, onEvent): spawn the CLI, stream its NDJSON into activity steps
   * and resolve with the final report. ok means exit code 0 AND
   * `final.reason.kind === "completed"`.
   */
  run(prompt, onEvent = () => {}) {
    if (!this.paths) {
      return Promise.reject(
        new HarnessNotConfigured(
          "Harness is not connected yet. The documented non-interactive CLI was not found on this Mac.",
        ),
      );
    }
    return new Promise((resolve) => {
      const generation = this.generation;
      let finalEvent = null;
      let usage = null;
      let stderrTail = "";
      let buffer = "";
      let settled = false;
      let timeoutHit = false;
      const env = { ...this.env, ...this.secretEnv, ELECTRON_RUN_AS_NODE: "1" };

      let child;
      try {
        child = this.spawnImpl(this.paths.runtime, cliSpawnArgs(this.paths.bin), {
          cwd: this.cwd,
          env,
          detached: true,
          stdio: ["pipe", "pipe", "pipe"],
        });
      } catch (error) {
        resolve({ ok: false, report: `Harness could not start: ${error?.message || error}`, usdBasis: "estimate" });
        return;
      }
      this.child = child;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.child = null;
        resolve(result);
      };

      const emit = (partial) => {
        try {
          onEvent(partial);
        } catch {
          /* a broken listener never changes the run */
        }
      };

      const failAndKill = (report) => {
        if (settled) return;
        const pid = Number(child.pid);
        if (pid) this.signalGroup(pid, "SIGTERM");
        finish({ ok: false, report, usdBasis: "estimate" });
      };

      const timer = setTimeout(() => {
        timeoutHit = true;
        failAndKill(`Timed out after ${this.maxMinutes} minutes.`);
      }, Math.max(1, this.maxMinutes) * 60_000);
      if (typeof timer.unref === "function") timer.unref();

      if (child.stdin && typeof child.stdin.write === "function") {
        try {
          child.stdin.write(String(prompt ?? ""));
          child.stdin.end();
        } catch {
          /* the exit handler reports the failure */
        }
      }

      const callTools = new Map();
      const onLine = (line) => {
        const text = line.trim();
        if (!text) return;
        let event;
        try {
          event = JSON.parse(text);
        } catch {
          return; // a diagnostic line is not an event
        }
        if (!event || typeof event !== "object") return;
        switch (event.type) {
          case "tool_call": {
            callTools.set(String(event.callId || "call"), String(event.tool || "harness"));
            emit({
              id: `harness-${event.callId || "call"}`,
              kind: "tool",
              tool: String(event.tool || "harness"),
              label: "Harness",
              detail: toolDetail(event.input),
              status: "running",
            });
            return;
          }
          case "tool_result": {
            const status = String(event.status || "");
            const callId = String(event.callId || "call");
            emit({
              id: `harness-${callId}`,
              kind: "tool",
              tool: callTools.get(callId) || "harness",
              label: "Harness",
              detail: toolDetail(event.result || event.error?.reason || event.error?.name || ""),
              status: status === "error" ? "error" : "done",
            });
            return;
          }
          case "status": {
            if (event.usage && typeof event.usage === "object") usage = event.usage;
            return;
          }
          case "session":
          case "text":
          case "thinking":
            return;
          case "final":
            finalEvent = event;
            return;
          case "error":
            stderrTail = clip(`${stderrTail}\n${event.message || "harness error"}`, 4000);
            return;
          default:
            return;
        }
      };

      const readStdout = (chunk) => {
        buffer += chunk.toString("utf8");
        let index = buffer.indexOf("\n");
        while (index >= 0) {
          const line = buffer.slice(0, index);
          buffer = buffer.slice(index + 1);
          if (line.length <= 256 * 1024) onLine(line);
          index = buffer.indexOf("\n");
        }
        // Never grow forever on one unterminated line.
        if (buffer.length > 512 * 1024) buffer = buffer.slice(-4096);
      };

      if (child.stdout && typeof child.stdout.on === "function") child.stdout.on("data", readStdout);
      if (child.stderr && typeof child.stderr.on === "function") {
        child.stderr.on("data", (chunk) => {
          stderrTail = clip(`${stderrTail}${chunk.toString("utf8")}`, 4000);
        });
      }
      if (typeof child.on === "function") {
        child.on("error", (error) => {
          finish({ ok: false, report: `Harness could not start: ${error?.message || error}`, usdBasis: "estimate" });
        });
      }
      child.on("close", () => {
        if (buffer.trim()) onLine(buffer);
        const reasonKind = String(finalEvent?.reason?.kind || "");
        const completed = Number(child.exitCode) === 0 && reasonKind === "completed" && !timeoutHit && this.generation === generation;
        const report = String(finalEvent?.text || "").trim() ||
          (stderrTail.trim() ? `Harness ended without a final report. ${stderrTail.trim()}` : "Harness ended without a final report.");
        const usd = usage && priceConfigured(this.env) ? usdForTokens(usage.inputTokens, usage.outputTokens, this.env) : null;
        const prUrl = eventUrlOf(finalEvent);
        finish({
          ok: completed,
          report,
          ...(prUrl ? { prUrl } : {}),
          ...(usd === null ? {} : { usd, usdBasis: "tokens x brain.env price" }),
          ...(completed ? {} : { usdBasis: "estimate" }),
        });
      });
    });
  }
}

/** Pull a PR link out of the final text when Harness printed one. */
function eventUrlOf(finalEvent) {
  const text = String(finalEvent?.text || "");
  const match = text.match(/https?:\/\/github\.com\/[^\s)]+\/pull\/\d+/);
  return match ? match[0] : "";
}

/**
 * pickAdapter(env) -> FakeAdapter when HARNESS_ADAPTER=fake (tests and demos),
 * CliAdapter when the documented CLI is found, NotImplementedAdapter otherwise.
 * A real run still needs prices in brain.env and the user's Да: this choice does
 * not weaken the guard.
 */
export function pickAdapter(env = process.env) {
  if (String(env.HARNESS_ADAPTER || "").toLowerCase() === "fake") return new FakeAdapter({ env });
  if (cliPaths(env)) return new CliAdapter({ env });
  return new NotImplementedAdapter({ env });
}
