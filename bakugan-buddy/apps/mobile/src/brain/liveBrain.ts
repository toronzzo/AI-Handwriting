/**
 * Live, read-only Brain status.
 *
 * The Mac already exposes one public health route for the app:
 *   GET http://<mac>:8788/v1/health
 * (the same route `probeBrain` uses). It answers with
 *   { ok, service: "bakugan-brain", model, warn, llama }
 * where `ok` is the llama-server health on :8790. So one small request tells
 * the map both things it needs: the router answered, and the local model is
 * (or is not) ready.
 *
 * Deliberately no provider calls, no keys and no cloud: this module only talks
 * to the brain on the page's own host. Every read is time-limited, bounded in
 * size and can be cancelled by the screen.
 *
 * Pure logic, no React and no react-native imports, so it runs under
 * `node --experimental-strip-types`.
 */
import { DEMO_BRAIN_MAP } from "./demoBrains.ts";
import type { BrainMap, BrainNode, LiveBrainSource } from "./types.ts";

/** The proxy's public health route; it also works before pairing. */
export const HEALTH_PATH = "/v1/health";
/** 30 s is slow on purpose: status is ambient, not a live scoreboard. */
export const BRAIN_POLL_MS = 30_000;
/** One read must finish (or abort) well before the next poll. */
export const BRAIN_TIMEOUT_MS = 4_000;
/** A health answer is tiny; anything larger is not a health answer. */
export const MAX_HEALTH_BYTES = 16_384;

export const LOCAL_MODEL_ID = "local-model";
export const ROUTER_ID = "router";

export type BrainLiveErrorCode =
  | "cancelled"
  | "timeout"
  | "unreachable"
  | "unauthorized"
  | "bad-response";

/** A typed reason the live read did not produce a map. */
export class BrainLiveError extends Error {
  code: BrainLiveErrorCode;

  constructor(code: BrainLiveErrorCode, message: string) {
    super(message);
    this.name = "BrainLiveError";
    this.code = code;
  }
}

/** `HH:MM` in the device's own time zone; empty for a missing/bad time. */
export function checkedTimeLabel(iso?: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

/** Update only the two probed nodes, keeping every demo description intact. */
function buildLiveMap(localOnline: boolean, checkedAt: string): BrainMap {
  const nodes = DEMO_BRAIN_MAP.nodes.map((node): BrainNode => {
    if (node.id === LOCAL_MODEL_ID) {
      return {
        ...node,
        status: localOnline ? "online" : "offline",
        live: true,
        statusNote: localOnline
          ? "llama-server answered on port 8790."
          : "llama-server did not answer on port 8790 — it may be down or still loading.",
      };
    }
    if (node.id === ROUTER_ID) {
      return {
        ...node,
        status: "online",
        live: true,
        statusNote: "The brain router answered on port 8788.",
      };
    }
    return { ...node };
  });

  return {
    isDemo: false,
    mode: "live",
    checkedAt,
    note: localOnline
      ? "Live from this Mac — local model and router were checked; the other nodes are still configuration."
      : "Live from this Mac — the router answered, but the local model is offline; the other nodes are still configuration.",
    core: { ...DEMO_BRAIN_MAP.core },
    nodes,
  };
}

/**
 * Turn the proxy's health body into a live map.
 * Only `ok` is load-bearing; `service`, when present, must be the brain proxy
 * so a different app on port 8788 is never mistaken for Preyas.
 */
export function mapHealth(body: unknown, checkedAt: string): BrainMap {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new BrainLiveError("bad-response", "the health answer was not an object");
  }
  const health = body as { ok?: unknown; service?: unknown };
  if (health.service !== undefined && health.service !== "bakugan-brain") {
    throw new BrainLiveError("bad-response", "the health answer came from another service");
  }
  if (typeof health.ok !== "boolean") {
    throw new BrainLiveError("bad-response", "the health answer had no ok flag");
  }
  return buildLiveMap(health.ok, checkedAt);
}

/** Static map used while the very first live check is running. */
export function loadingBrainMap(): BrainMap {
  return {
    isDemo: true,
    mode: "loading",
    checkedAt: null,
    note: "Checking this Mac for live status — the map shows demo data until it answers.",
    core: { ...DEMO_BRAIN_MAP.core },
    nodes: DEMO_BRAIN_MAP.nodes.map((node): BrainNode => {
      if (node.id === LOCAL_MODEL_ID || node.id === ROUTER_ID) {
        return { ...node, status: "checking", live: false, statusNote: "Checking this Mac now." };
      }
      return { ...node };
    }),
  };
}

const OFFLINE_NOTE: Record<BrainLiveErrorCode, string> = {
  cancelled: "The live check was cancelled.",
  timeout: "Live status is unavailable — the Mac took too long to answer.",
  unreachable: "Live status is unavailable — the Mac did not answer.",
  unauthorized: "Live status is unavailable — this device is not paired with the Mac.",
  "bad-response": "Live status is unavailable — the Mac answered with something this view did not expect.",
};

/**
 * Honest fallback: keep the static descriptions, but never leave the local
 * model or router claiming to be online when nothing answered.
 */
export function offlineBrainMap(code: BrainLiveErrorCode): BrainMap {
  const localNote =
    code === "unauthorized"
      ? "Pair this device with the Mac to read the local model."
      : code === "bad-response"
        ? "No live reading — the Mac's status could not be read."
        : "No live reading — the router on port 8788 did not answer.";
  const routerNote =
    code === "unauthorized"
      ? "This device is not paired with the Mac, so the router could not be checked."
      : code === "bad-response"
        ? "No live reading — the Mac answered with something unexpected."
        : "No live reading from the router on port 8788.";

  return {
    isDemo: true,
    mode: "offline",
    checkedAt: null,
    note: `${OFFLINE_NOTE[code]} The map below is demo data, not a live reading.`,
    core: { ...DEMO_BRAIN_MAP.core },
    nodes: DEMO_BRAIN_MAP.nodes.map((node): BrainNode => {
      if (node.id === LOCAL_MODEL_ID) {
        return { ...node, status: "unavailable", live: false, statusNote: localNote };
      }
      if (node.id === ROUTER_ID) {
        return { ...node, status: "unavailable", live: false, statusNote: routerNote };
      }
      return { ...node };
    }),
  };
}

/** Keep a live reading after a later poll failed, clearly marked as old. */
export function staleBrainMap(last: BrainMap): BrainMap {
  return {
    ...last,
    mode: "stale",
    note: "The Mac stopped answering — this is the last status it reported, not a current one.",
  };
}

/** One plain sentence telling the detail panel where this node's status came from. */
export function brainSourceLine(map: BrainMap, node: BrainNode): string {
  const checked = checkedTimeLabel(map.checkedAt);
  if (node.live) {
    if (map.mode === "stale") {
      return checked
        ? `Last live reading at ${checked} — this may be out of date.`
        : "Last live reading — this may be out of date.";
    }
    return checked ? `Live reading from this Mac, checked ${checked}.` : "Live reading from this Mac.";
  }
  if (map.mode === "live") return "Static configuration — this node is not probed.";
  if (map.mode === "stale") return "Static configuration — this node is not probed.";
  if (map.mode === "offline") return "Demo data — no live reading is available.";
  if (map.mode === "loading") return "Demo data while this Mac is checked.";
  return "Demo data — not a live reading.";
}

export type LiveBrainFetchOptions = {
  /** The proxy base, e.g. `http://127.0.0.1:8788`; no trailing slash needed. */
  baseUrl: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  signal?: AbortSignal;
  now?: () => number;
};

/**
 * Read `/v1/health` once. Resolves only with a real live map; every failure
 * is a typed `BrainLiveError`, so the caller decides between fallback and
 * stale instead of guessing from a string.
 */
export async function fetchLiveBrainMap(options: LiveBrainFetchOptions): Promise<BrainMap> {
  const { baseUrl, timeoutMs = BRAIN_TIMEOUT_MS, signal, now = () => Date.now() } = options;
  const fetchImpl = options.fetchImpl ?? (typeof fetch === "function" ? fetch : null);
  if (!fetchImpl) throw new BrainLiveError("unreachable", "no fetch is available");
  if (signal?.aborted) throw new BrainLiveError("cancelled", "the live check was cancelled");

  const base = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (!base) throw new BrainLiveError("unreachable", "no brain address");

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, Math.max(1, timeoutMs));
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });

  try {
    const response = await fetchImpl(`${base}${HEALTH_PATH}`, {
      method: "GET",
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (response.status === 401 || response.status === 403 || response.status === 429) {
      throw new BrainLiveError("unauthorized", "this device is not paired with the Mac");
    }
    if (!response.ok) {
      throw new BrainLiveError("unreachable", `the Mac answered ${response.status}`);
    }
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_HEALTH_BYTES) {
      throw new BrainLiveError("bad-response", "the health answer was too large");
    }
    const text = await response.text();
    if (text.length > MAX_HEALTH_BYTES) {
      throw new BrainLiveError("bad-response", "the health answer was too large");
    }
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new BrainLiveError("bad-response", "the health answer was not JSON");
    }
    return mapHealth(body, new Date(now()).toISOString());
  } catch (error) {
    if (error instanceof BrainLiveError) throw error;
    if (signal?.aborted) throw new BrainLiveError("cancelled", "the live check was cancelled");
    if (timedOut) throw new BrainLiveError("timeout", "the Mac took too long to answer");
    throw new BrainLiveError("unreachable", "the Mac did not answer");
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

export type LiveBrainSourceOptions = {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  now?: () => number;
};

/**
 * The live source behind the existing `BrainSource` seam. It remembers the
 * latest map for `get()`, turns ordinary failures into offline/stale maps,
 * and rejects only when the caller cancels.
 */
export function createLiveBrainSource(options: LiveBrainSourceOptions): LiveBrainSource {
  let current: BrainMap = loadingBrainMap();

  return {
    get(): BrainMap {
      return current;
    },

    async refresh(refreshOptions = {}): Promise<BrainMap> {
      try {
        const map = await fetchLiveBrainMap({
          baseUrl: options.baseUrl,
          fetchImpl: options.fetchImpl,
          timeoutMs: refreshOptions.timeoutMs ?? options.timeoutMs,
          signal: refreshOptions.signal,
          now: options.now,
        });
        current = map;
        return map;
      } catch (error) {
        if (error instanceof BrainLiveError && error.code === "cancelled") throw error;
        const code = error instanceof BrainLiveError ? error.code : "unreachable";
        current =
          current.mode === "live" || current.mode === "stale"
            ? staleBrainMap(current)
            : offlineBrainMap(code);
        return current;
      }
    },
  };
}
