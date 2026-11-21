/**
 * One llama-server at a time on :8790, with three local model tiers.
 *
 * - switching stops the old server first, then starts the new one
 *   (flash attention, one slot, thinking handled per-request by the caller);
 * - big/huge can demand a Yes/No heads-up based on free memory;
 * - after 20 idle minutes on big or huge, Preyas comes back to the 8B;
 * - no route here ever touches the paid gateway — local stays local.
 *
 * Everything slow or side-effectful is injectable, so the lifecycle and the
 * idle timer are testable with fakes (node:test mock timers included).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { MODEL_LABELS, switchNeedsConfirm } from "../../packages/alive/src/modelSwitch.ts";
import { sharedBrain } from "./os/neurons.mjs";

export const LLAMA_PORT = 8790;
export const IDLE_RETURN_MS = 20 * 60_000;
export const DEFAULT_IDLE_MODEL = "small";
export const LOAD_TIMEOUT_MS = { small: 180_000, big: 300_000, huge: 600_000 };

/** Resident memory of one pid in MB (ps reports rss in KB); null when unreadable. */
export function ramOfPid(pid, execImpl = execFile) {
  return new Promise((resolve) => {
    execImpl("ps", ["-p", String(pid), "-o", "rss="], { timeout: 4000 }, (error, stdout) => {
      if (error) return resolve(null);
      const kb = Number(String(stdout).trim().split(/\s+/)[0]);
      resolve(Number.isFinite(kb) && kb > 0 ? Math.round(kb / 1024) : null);
    });
  });
}

/**
 * Resident memory of whatever llama-server holds :8790 — ours or the drive
 * launcher's — or null when nothing listens. Used by the brain feed.
 */
export async function llamaServerRamMb(execImpl = execFile, port = LLAMA_PORT) {
  const pid = await new Promise((resolve) => {
    execImpl("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], { timeout: 4000 }, (error, stdout) => {
      if (error) return resolve(null);
      const found = Number(String(stdout).trim().split("\n")[0]);
      resolve(Number.isInteger(found) && found > 0 ? found : null);
    });
  });
  if (pid === null) return null;
  return ramOfPid(pid, execImpl);
}

/**
 * The three tiers. Files live on the Agent drive, never in git.
 * `ngl` is the number of layers on the Metal GPU: the 30B weights alone are
 * 14.7 GB, so a full offload exhausts the 16 GB Mac and decode dies with a
 * "Compute error". 24 layers fits and still answers (slowly, see the card).
 */
export const TIERS = {
  small: { id: "small", file: "Huihui-Qwen3-8B-abliterated-v2.Q4_K_M.gguf", context: 16384, weightsGb: 5.0, ngl: 99 },
  big: { id: "big", file: "Huihui-Qwen3-14B-abliterated-v2.Q4_K_M.gguf", context: 16384, weightsGb: 9.0, ngl: 99 },
  huge: { id: "huge", file: "Qwen3-30B-A3B.Q3_K_M.gguf", context: 8192, weightsGb: 14.7, ngl: 24 },
};

/**
 * Free memory as macOS keeps it reclaimable without swapping:
 * free + speculative + purgeable + inactive pages, straight from vm_stat
 * (the equivalent sysctl oids do not all exist on modern macOS).
 */
export function freeMemoryGb(execImpl = execFile) {
  return new Promise((resolve) => {
    execImpl("vm_stat", [], { timeout: 4000 }, (error, stdout) => {
      if (error) return resolve(null);
      const text = String(stdout);
      const sizeMatch = text.match(/page size of (\d+) bytes/);
      const pagesOf = (name) => {
        const match = text.match(new RegExp(`Pages ${name}:\\s+(\\d+)\\.`));
        return match ? Number(match[1]) : null;
      };
      const pageSize = sizeMatch ? Number(sizeMatch[1]) : null;
      const free = pagesOf("free");
      const speculative = pagesOf("speculative");
      const purgeable = pagesOf("purgeable");
      const inactive = pagesOf("inactive");
      if (!pageSize || [free, speculative, purgeable, inactive].some((n) => n === null)) return resolve(null);
      resolve(Math.round((((free + speculative + purgeable + inactive) * pageSize) / 1e9) * 10) / 10);
    });
  });
}

export function createModelSwitch(options = {}) {
  const {
    modelsDir = process.env.PREYAS_MODELS_DIR || "/Volumes/Agent/BakuganBuddy/models",
    port = LLAMA_PORT,
    llamaBin = process.env.LLAMA_BIN || path.join(os.homedir(), ".local", "bin", "llama-server"),
    template = null,
    dataDir = process.env.BAKUGAN_DATA_DIR || "",
    logFile = dataDir ? path.join(dataDir, "logs", "llama-switch.log") : null,
    fetchImpl = fetch,
    spawnImpl = spawn,
    execImpl = execFile,
    killImpl = (pid, signal) => {
      process.kill(pid, signal);
    },
    probeFree = () => freeMemoryGb(execImpl),
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now = () => Date.now(),
    log = (line) => console.warn(`model: ${line}`),
    idleReturnMs = IDLE_RETURN_MS,
    brain = null,
  } = options;

  const feed = brain ?? sharedBrain();
  /** The brain feed is a nicety: a switch never fails because of it. */
  function emitBrain(event) {
    try {
      feed.emit(event);
    } catch {
      /* the feed is a nicety */
    }
  }

  let current = DEFAULT_IDLE_MODEL;
  let status = "down"; // down | loading | ready | error
  let error = null;
  let lastFreeGb = null;
  let lastActivity = now();
  let child = null;
  let childExited = false;
  let switching = false;
  let idleTimer = null;

  function clearIdleTimer() {
    if (idleTimer !== null) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  }

  /** On big or huge, come back to the 8B after the idle window. */
  function scheduleIdle() {
    clearIdleTimer();
    if (current === DEFAULT_IDLE_MODEL || status !== "ready") return;
    const remaining = Math.max(1_000, idleReturnMs - (now() - lastActivity));
    idleTimer = setTimeout(() => {
      idleTimer = null;
      if (status === "ready" && current !== DEFAULT_IDLE_MODEL && now() - lastActivity >= idleReturnMs - 500) {
        log(`idle for ${Math.round(idleReturnMs / 60_000)} min — back to the ${DEFAULT_IDLE_MODEL} model`);
        void request(DEFAULT_IDLE_MODEL, { confirmed: true });
      } else {
        scheduleIdle();
      }
    }, remaining);
    if (typeof idleTimer.unref === "function") idleTimer.unref();
  }

  function healthOk() {
    return fetchImpl(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1_500) })
      .then((res) => res.ok)
      .catch(() => false);
  }

  function portPid() {
    return new Promise((resolve) => {
      execImpl("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], { timeout: 4000 }, (error, stdout) => {
        if (error) return resolve(null);
        const pid = Number(String(stdout).trim().split("\n")[0]);
        resolve(Number.isInteger(pid) && pid > 0 ? pid : null);
      });
    });
  }

  function processName(pid) {
    return new Promise((resolve) => {
      execImpl("ps", ["-p", String(pid), "-o", "comm="], { timeout: 4000 }, (error, stdout) => {
        if (error) return resolve("");
        resolve(String(stdout).trim().split("/").pop());
      });
    });
  }

  /** Resident memory of the llama-server on our port, for the brain feed. */
  async function probeRamMb() {
    const pid = await portPid();
    if (pid === null) return null;
    return ramOfPid(pid, execImpl);
  }

  /** Stop whatever llama-server holds the port — ours or the drive launcher's. */
  async function stopServer() {
    if (child && typeof child.kill === "function") {
      try {
        child.kill("SIGTERM");
      } catch {
        /* already gone */
      }
    }
    child = null;
    childExited = false;
    for (let attempt = 0; attempt < 10; attempt++) {
      const pid = await portPid();
      if (pid === null) return;
      const name = await processName(pid);
      if (name && !/llama/i.test(name)) {
        throw new Error(`port ${port} is held by "${name}" (pid ${pid}) — refusing to stop it`);
      }
      killImpl(pid, "SIGTERM");
      await sleep(500);
    }
    const pid = await portPid();
    if (pid !== null) {
      const name = await processName(pid);
      if (!name || /llama/i.test(name)) killImpl(pid, "SIGKILL");
    }
  }

  function serverArgs(tier, gguf) {
    const args = [
      "-m",
      gguf,
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "-c",
      String(tier.context),
      "-ngl",
      String(tier.ngl ?? 99),
      "-t",
      "8",
      "--jinja",
      "--cache-type-k",
      "q8_0",
      "--cache-type-v",
      "q8_0",
      "--no-context-shift",
      "--cache-reuse",
      "256",
      "--parallel",
      "1",
      "--slots",
      "--flash-attn",
      "on",
    ];
    if (template && fs.existsSync(template)) args.push("--chat-template-file", template);
    if (dataDir) {
      const slots = path.join(dataDir, "cache", "llama-slots");
      try {
        fs.mkdirSync(slots, { recursive: true });
        args.push("--slot-save-path", slots);
      } catch {
        /* slot caching is a nicety */
      }
    }
    if (logFile) {
      try {
        fs.mkdirSync(path.dirname(logFile), { recursive: true });
      } catch {
        /* the drive may be gone */
      }
      args.push("--log-file", logFile);
    }
    return args;
  }

  function runSwitch(target) {
    if (switching) return false;
    switching = true;
    void (async () => {
      clearIdleTimer();
      status = "loading";
      error = null;
      const tier = TIERS[target];
      emitBrain({ neuron: `chat-${target}`, state: "loading", detail: tier.file });
      if (current !== target) {
        emitBrain({ neuron: `chat-${current}`, state: "off", detail: `switching to ${target}` });
      }
      try {
        const gguf = path.join(modelsDir, tier.file);
        if (!fs.existsSync(gguf)) throw new Error(`model file is not on the drive: ${gguf}`);
        await stopServer();
        log(`starting ${target} (${tier.file}, ctx ${tier.context})`);
        childExited = false;
        const spawned = spawnImpl(llamaBin, serverArgs(tier, gguf), { stdio: "ignore" });
        child = spawned;
        if (spawned && typeof spawned.unref === "function") spawned.unref();
        if (spawned && typeof spawned.on === "function") {
          spawned.on("exit", (code, signal) => {
            // A server we already replaced must not mark the new one dead.
            if (child !== spawned) return;
            childExited = true;
            if (status === "ready") {
              status = "down";
              error = `llama-server exited (${signal || code})`;
              emitBrain({ neuron: `chat-${current}`, state: "off", detail: error });
            }
          });
        }
        const timeout = LOAD_TIMEOUT_MS[target] ?? 180_000;
        const deadline = now() + timeout;
        let healthy = false;
        while (now() < deadline) {
          if (await healthOk()) {
            healthy = true;
            break;
          }
          if (childExited) throw new Error("llama-server exited while loading");
          await sleep(500);
        }
        if (!healthy) throw new Error(`llama-server did not become healthy within ${Math.round(timeout / 1000)}s`);
        current = target;
        status = "ready";
        error = null;
        lastActivity = now();
        // Loaded and idle reads as "off" in the brain view; thinking only
        // lights up while a reply is being generated.
        emitBrain({ neuron: `chat-${target}`, state: "off", ramMb: await probeRamMb() });
        scheduleIdle();
      } catch (err) {
        status = "error";
        error = err instanceof Error ? err.message : String(err);
        emitBrain({ neuron: `chat-${target}`, state: "error", detail: error });
        log(`switch to ${target} failed: ${error}`);
      } finally {
        switching = false;
      }
    })();
    return true;
  }

  /** Ask for a model. Returns the decision; the switch itself runs in the background. */
  async function request(target, opts = {}) {
    const confirmed = opts.confirmed === true;
    if (!TIERS[target]) return { ok: false, error: `unknown model: ${target}`, current, status };
    if (target === current && status === "ready") {
      lastActivity = now();
      scheduleIdle();
      return { ok: true, unchanged: true, current, status };
    }
    lastFreeGb = await probeFree().catch(() => null);
    if (!confirmed && switchNeedsConfirm(target, lastFreeGb)) {
      return { ok: false, needsConfirm: true, target, freeGb: lastFreeGb, current, status };
    }
    if (!runSwitch(target)) return { ok: false, error: "another switch is already running", current, status };
    return { ok: true, current: target, status: "loading" };
  }

  /** Learn which model is live from /props — called once at proxy startup. */
  async function detect() {
    try {
      const res = await fetchImpl(`http://127.0.0.1:${port}/props`, { signal: AbortSignal.timeout(2_000) });
      if (!res.ok) return false;
      const props = await res.json();
      const modelPath = String(props.model || props.model_path || "");
      for (const tier of Object.values(TIERS)) {
        if (modelPath.endsWith(tier.file)) {
          current = tier.id;
          status = "ready";
          error = null;
          lastActivity = now();
          scheduleIdle();
          emitBrain({ neuron: `chat-${tier.id}`, state: "off", ramMb: await probeRamMb(), detail: "already running" });
          return true;
        }
      }
      return false;
    } catch {
      return false;
    }
  }

  /** Re-check the health of :8790 so Status does not go stale. */
  async function refresh() {
    if (switching) return state();
    const ok = await healthOk();
    if (ok && status !== "ready") {
      status = "ready";
      error = null;
      lastActivity = now();
      scheduleIdle();
      emitBrain({ neuron: `chat-${current}`, state: "off", ramMb: await probeRamMb() });
    } else if (!ok && status === "ready") {
      status = "down";
      error = "llama-server is down";
      clearIdleTimer();
      emitBrain({ neuron: `chat-${current}`, state: "off", detail: error });
    }
    return state();
  }

  /** The app and the phone see this object; no file paths leak. */
  function state() {
    const idleLeft = Math.max(0, idleReturnMs - (now() - lastActivity));
    return {
      current,
      status,
      error,
      label: MODEL_LABELS[current],
      freeGb: lastFreeGb,
      idleMinutesLeft: Math.round(idleLeft / 60_000),
      port,
      tiers: Object.fromEntries(
        Object.values(TIERS).map((tier) => [
          tier.id,
          { label: MODEL_LABELS[tier.id], context: tier.context, weightsGb: tier.weightsGb },
        ]),
      ),
    };
  }

  /** Chat activity. Keeps the big models around and resets the idle window. */
  function touch() {
    lastActivity = now();
    scheduleIdle();
  }

  /** How long one reply may take through the proxy for the current tier. */
  function chatTimeoutMs() {
    if (status !== "ready") return 90_000;
    if (current === "huge") return 300_000;
    if (current === "big") return 150_000;
    return 90_000;
  }

  function stop() {
    clearIdleTimer();
    if (child && typeof child.kill === "function") {
      try {
        child.kill("SIGTERM");
      } catch {
        /* already gone */
      }
    }
    child = null;
  }

  return { request, detect, refresh, state, touch, chatTimeoutMs, stop };
}
