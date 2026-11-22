/**
 * Optional backup brain on the LAN.
 *
 * LLAMA_URL stays the Mac's llama-server. LLAMA_FALLBACK_URL, when set, is a
 * second llama.cpp (the Windows laptop). Chat tries the Mac first. If its
 * /health is down, or the request fails before any bytes reach the client,
 * the same request is tried once on the fallback and the reply source is the
 * backup brain.
 *
 * With LLAMA_FALLBACK_URL unset this is a pass-through: no health probe, one
 * attempt, the local URL. A health result is cached so a busy chat does not
 * probe /health on every turn.
 */
import { CONNECT_TIMEOUT_MS, connectWithTimeout } from "./netTimeout.mjs";

export { CONNECT_TIMEOUT_MS };

export const LOCAL_SOURCE = "local";
export const BACKUP_SOURCE = "backup";
/** Shown in the brain log and the chat label when the laptop answered. */
export const BACKUP_BRAIN = "backup brain";
/** How long a /health answer is reused. */
export const HEALTH_TTL_MS = 10_000;
/** A hung local llama must not stall the decision to use the backup. */
export const HEALTH_TIMEOUT_MS = 1_500;

export function llamaEndpoints(env = process.env) {
  const local = String(env.LLAMA_URL || "http://127.0.0.1:8790").replace(/\/$/, "");
  const fallback = String(env.LLAMA_FALLBACK_URL || "").trim().replace(/\/$/, "");
  return { local, fallback };
}

export function isLoopbackUrl(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "127.0.0.1" || host === "localhost" || host === "::1" || host === "[::1]";
  } catch {
    return false;
  }
}

function asResult(value) {
  const row = value && typeof value === "object" ? value : {};
  return {
    ok: row.ok === true,
    wrote: row.wrote === true,
    timedOut: row.timedOut === true,
    clientClosed: row.clientClosed === true,
  };
}

export function createLlamaRouter(options = {}) {
  const {
    env = process.env,
    fetchImpl = fetch,
    now = () => Date.now(),
    ttlMs = HEALTH_TTL_MS,
    healthTimeoutMs = HEALTH_TIMEOUT_MS,
    connectTimeoutMs = CONNECT_TIMEOUT_MS,
    connect = (url, timeoutMs) => connectWithTimeout(url, timeoutMs),
  } = options;

  /** @type {{ ok: boolean, at: number } | null} */
  let entry = null;

  function cacheGet() {
    if (!entry) return null;
    if (now() - entry.at >= ttlMs) return null;
    return entry.ok;
  }

  function cacheSet(ok) {
    entry = { ok: ok === true, at: now() };
  }

  async function localHealthy() {
    const cached = cacheGet();
    if (cached !== null) return cached;
    const { local } = llamaEndpoints(env);
    let ok = false;
    try {
      const res = await fetchImpl(`${local}/health`, { signal: AbortSignal.timeout(healthTimeoutMs) });
      ok = Boolean(res && res.ok);
    } catch {
      ok = false;
    }
    cacheSet(ok);
    return ok;
  }

  async function callAttempt(attempt, url, source) {
    try {
      return asResult(await attempt(url, source));
    } catch {
      return asResult({ ok: false, wrote: false });
    }
  }

  /**
   * The backup host is across the LAN. A connect probe fails fast when the
   * laptop is asleep; loopback (tests, a local spare) skips the probe.
   */
  async function callBackup(attempt, fallback) {
    if (!isLoopbackUrl(fallback)) {
      let open = false;
      try {
        open = await connect(fallback, connectTimeoutMs);
      } catch {
        open = false;
      }
      if (!open) return asResult({ ok: false, wrote: false });
    }
    return callAttempt(attempt, fallback, BACKUP_SOURCE);
  }

  /**
   * `attempt(url, source)` performs one chat call and reports whether it
   * wrote to the client. A failure that wrote nothing is retried once.
   */
  async function run(attempt) {
    const { local, fallback } = llamaEndpoints(env);
    if (!fallback) {
      const only = await callAttempt(attempt, local, LOCAL_SOURCE);
      return { source: LOCAL_SOURCE, ...only };
    }
    const healthy = await localHealthy();
    if (!healthy) {
      const backup = await callBackup(attempt, fallback);
      return { source: BACKUP_SOURCE, ...backup };
    }
    const first = await callAttempt(attempt, local, LOCAL_SOURCE);
    if (first.ok || first.wrote || first.clientClosed) return { source: LOCAL_SOURCE, ...first };
    // The live request failed. Remember that for the cache window so the
    // next turn does not probe /health again before using the backup.
    cacheSet(false);
    const backup = await callBackup(attempt, fallback);
    return { source: BACKUP_SOURCE, ...backup };
  }

  return { run, localHealthy, endpoints: () => llamaEndpoints(env) };
}
