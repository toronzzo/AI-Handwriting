/**
 * The brain's side of the Power panel.
 *
 * scripts/preyas.sh is the one controller for all five services. This module
 * calls its JSON status, and starts a detached restart/stop so the HTTP answer
 * can return before the brain itself is stopped. Every service name is checked
 * against a small allowlist before it reaches a shell.
 */
import fs from "node:fs";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

export const RESTART_TARGETS = ["brain", "model", "llama", "litellm", "kiwix", "web"];
export const CONTROL_LOG = "control.log";

const execFileAsync = promisify(execFile);

function shellQuote(value) {
  return "'" + String(value ?? "").replace(/'/g, "'\\''") + "'";
}

function nowIso(now) {
  const value = typeof now === "function" ? now() : now;
  const date = value instanceof Date ? value : new Date(value ?? Date.now());
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function safeError(error) {
  const code = error && typeof error.code === "number" ? "the controller exited with code " + error.code : "the controller did not answer";
  return code;
}

export function createPowerController(options = {}) {
  const {
    scriptPath = "",
    logDir = "/Volumes/Agent/agent/logs/preyas",
    run = (file, args, opts) => execFileAsync(file, args, opts),
    spawnDetached = (file, args) => {
      const child = spawn(file, args, { detached: true, stdio: "ignore" });
      if (typeof child.unref === "function") child.unref();
      return child;
    },
    now = () => new Date(),
    fsImpl = fs,
  } = options;

  function scriptPresent() {
    try {
      return Boolean(scriptPath) && fsImpl.existsSync(scriptPath);
    } catch {
      return false;
    }
  }

  function unavailable() {
    return {
      ok: false,
      error: "The Preyas controller was not found. Open the Desktop launchers, or run scripts/install-desktop-launchers.sh.",
      services: [],
    };
  }

  async function runJson(args, timeoutMs = 12_000) {
    if (!scriptPresent()) throw new Error("control script not found");
    const result = await run("bash", [scriptPath, ...args], { timeout: timeoutMs, maxBuffer: 256 * 1024 });
    const text = String(result?.stdout ?? "").trim();
    return JSON.parse(text || "{}");
  }

  async function status() {
    if (!scriptPresent()) return unavailable();
    try {
      const body = await runJson(["status", "--json"]);
      if (!Array.isArray(body.services)) throw new Error("no services");
      return { ...body, ok: body.ok !== false, checkedAt: body.checkedAt || nowIso(now) };
    } catch (error) {
      return {
        ok: false,
        error: safeError(error),
        services: [],
        checkedAt: nowIso(now),
      };
    }
  }

  async function restart(service) {
    const target = String(service || "").trim();
    if (!RESTART_TARGETS.includes(target)) {
      return { ok: false, code: "bad_service", error: "Unknown service." };
    }
    if (!scriptPresent()) return unavailable();
    try {
      fsImpl.mkdirSync(logDir, { recursive: true });
    } catch {
      /* the controller will try again; a missing log dir is not fatal */
    }
    const logFile = path.join(logDir, CONTROL_LOG);
    const command = "sleep 1; " + shellQuote(scriptPath) + " restart " + shellQuote(target) + " >> " + shellQuote(logFile) + " 2>&1";
    try {
      spawnDetached("/bin/bash", ["-c", command]);
    } catch (error) {
      return { ok: false, error: safeError(error) };
    }
    return { ok: true, restarting: target };
  }

  async function off() {
    if (!scriptPresent()) return unavailable();
    try {
      fsImpl.mkdirSync(logDir, { recursive: true });
    } catch {
      /* the controller will try again; a missing log dir is not fatal */
    }
    const logFile = path.join(logDir, CONTROL_LOG);
    const command = "sleep 1; " + shellQuote(scriptPath) + " stop >> " + shellQuote(logFile) + " 2>&1";
    try {
      spawnDetached("/bin/bash", ["-c", command]);
    } catch (error) {
      return { ok: false, error: safeError(error) };
    }
    return { ok: true, stopping: true };
  }

  async function autostartStatus() {
    if (!scriptPresent()) {
      return { installed: false, supported: false, path: "", error: unavailable().error };
    }
    try {
      const body = await runJson(["autostart", "status", "--json"], 8_000);
      return {
        installed: body.installed === true,
        supported: body.supported === true,
        path: typeof body.path === "string" ? body.path : "",
      };
    } catch (error) {
      return { installed: false, supported: process.platform === "darwin", path: "", error: safeError(error) };
    }
  }

  async function setAutostart(on) {
    if (!scriptPresent()) return { ...unavailable(), ...(await autostartStatus()) };
    try {
      await run("bash", [scriptPath, "autostart", on ? "on" : "off"], { timeout: 12_000, maxBuffer: 256 * 1024 });
    } catch (error) {
      return { installed: !on, supported: process.platform === "darwin", path: "", error: safeError(error) };
    }
    return autostartStatus();
  }

  return { status, restart, off, autostartStatus, setAutostart };
}
