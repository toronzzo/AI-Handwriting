/**
 * Preyas routing foundation (flag-gated, read-only).
 *
 * One pure decision layer for chat: local first, a dedicated fallback only
 * when the operator opted in, and manual provider selection. Nothing here is
 * wired into chat yet; the existing `chooseRoute` path stays in charge until
 * a later PR flips the flag.
 *
 * This module makes no chat calls and holds no credentials. Its only network
 * access is the optional local health probe (`GET /v1/health` on the brain
 * proxy); cloud providers are typed placeholders with no endpoint and no key.
 *
 * Operator flags (all default off):
 *   PREYAS_ROUTER=1                 or EXPO_PUBLIC_PREYAS_ROUTER=1
 *   PREYAS_ROUTER_MODE=prefer-local | fallback-on-local-unavailable | manual
 *   PREYAS_ROUTER_PROVIDER=<id>     required in manual mode
 *   PREYAS_ROUTER_ALLOW_CLOUD=1     required for any cloud route
 *
 * Provider ids today: local, free-cloud, fallback. Only local is active; the
 * other two are typed placeholders until a later PR configures them.
 *
 * Rules, in order:
 *   1. Flag off -> legacy decision; the existing chat path runs unchanged.
 *   2. Invalid router config -> unavailable; nothing is sent anywhere.
 *   3. A healthy local provider wins in prefer-local and fallback modes.
 *   4. prefer-local never falls back to a cloud provider.
 *   5. fallback-on-local-unavailable may use only a dedicated fallback
 *      provider, only with allowCloudRoutes.
 *   6. manual mode uses exactly the named provider; a cloud provider also
 *      needs allowCloudRoutes.
 *   7. Free-cloud slots are never chosen automatically.
 *   8. Missing, invalid, disabled, demo, offline or timed-out providers are
 *      unavailable.
 *
 * Pure logic, no React and no react-native imports, so it runs under
 * `node --experimental-strip-types`.
 */
import { LOCAL_TIMEOUT_MS } from "./chatTurn.ts";
import { HUGE_TIMEOUT_MS } from "./modelSwitch.ts";

export type ProviderKind = "local" | "free-cloud" | "fallback";
export type RouterMode = "prefer-local" | "fallback-on-local-unavailable" | "manual";
export type RouteKind = "legacy" | "local" | "free-cloud" | "fallback" | "unavailable";
export type RouterBrainStatus = "online" | "fallback" | "planned" | "unavailable";

/** The local chat budget, shared with the existing chat client. */
export const DEFAULT_LOCAL_TIMEOUT_MS = LOCAL_TIMEOUT_MS;
/** The proxy's own paid upstream budget; a fallback route uses the same size. */
export const DEFAULT_FALLBACK_TIMEOUT_MS = 90_000;
export const MIN_PROVIDER_TIMEOUT_MS = 1_000;
/** The huge tier's shared budget; no single provider route may exceed it. */
export const MAX_PROVIDER_TIMEOUT_MS = HUGE_TIMEOUT_MS;
/** A health/config probe is not a chat; stay well under the chat budget. */
export const DEFAULT_PROBE_TIMEOUT_MS = 2_500;
export const MIN_PROBE_TIMEOUT_MS = 50;
export const MAX_PROBE_TIMEOUT_MS = 10_000;
/** A health answer is tiny; anything larger is not a health answer. */
export const MAX_HEALTH_BYTES = 16_384;

export const FREE_CLOUD_PROVIDER_ID = "free-cloud";
export const FALLBACK_PROVIDER_ID = "fallback";

export type ProviderProbeContext = {
  signal: AbortSignal;
};

export type ProviderProbe = {
  available: boolean;
  reason: string;
};

/**
 * The one provider seam. A provider can answer a no-user-content health
 * probe; chat calls are deliberately not part of this foundation.
 */
export interface BrainProvider {
  readonly id: string;
  readonly kind: ProviderKind;
  readonly label: string;
  /** True only for a provider this build may actually call. */
  readonly enabled: boolean;
  /** True for a labelled placeholder, never a live route. */
  readonly demo: boolean;
  /** Chat generation budget this provider would receive. */
  readonly timeoutMs: number;
  /** Budget for the health/config probe itself. */
  readonly probeTimeoutMs: number;
  probe(context: ProviderProbeContext): Promise<ProviderProbe>;
}

export type ProviderAvailability = {
  id: string;
  kind: ProviderKind;
  label: string;
  enabled: boolean;
  demo: boolean;
  timeoutMs: number;
  available: boolean;
  reason: string;
};

export type RouterConfig = {
  enabled: boolean;
  mode: RouterMode;
  /** The one provider to use in manual mode; null otherwise. */
  manualProviderId: string | null;
  /** Explicit opt-in for any route that leaves the Mac. */
  allowCloudRoutes: boolean;
  /** Non-empty when operator config was unreadable or inconsistent. */
  error?: string;
};

export const DEFAULT_ROUTER_CONFIG: RouterConfig = {
  enabled: false,
  mode: "prefer-local",
  manualProviderId: null,
  allowCloudRoutes: false,
};

export type RouterDecision = {
  kind: RouteKind;
  providerId: string | null;
  providerLabel: string;
  reason: string;
  /** Chat budget for the chosen route; 0 when there is no route. */
  timeoutMs: number;
  /** True only when the chosen route leaves the Mac. */
  cloud: boolean;
  /** True only when the decision concerns a placeholder, never a live route. */
  demo: boolean;
};

export type RouterStatus = {
  enabled: boolean;
  mode: RouterMode;
  route: RouteKind;
  providerId: string | null;
  reason: string;
  /** ISO time of the probe, or null when the router did no work. */
  checkedAt: string | null;
  demo: boolean;
  cloud: boolean;
  timeoutMs: number;
};

/** The router node shape the Brain live map already understands. */
export type RouterBrainNode = {
  id: "router";
  name: "Router";
  hint: string;
  description: string;
  status: RouterBrainStatus;
  statusNote: string;
  live: boolean;
};

/** A routing probe was cancelled by the caller, not a provider failure. */
export class RouterCancelledError extends Error {
  constructor(message = "routing was cancelled") {
    super(message);
    this.name = "RouterCancelledError";
  }
}

export type RouterEnv = Record<string, string | undefined>;

const MODES: readonly RouterMode[] = ["prefer-local", "fallback-on-local-unavailable", "manual"];
const FREE_CLOUD_KIND: ProviderKind = "free-cloud";
const FALLBACK_KIND: ProviderKind = "fallback";

export function isRouterMode(value: unknown): value is RouterMode {
  return typeof value === "string" && (MODES as readonly string[]).includes(value);
}

function isProviderKind(value: unknown): value is ProviderKind {
  return value === "local" || value === FREE_CLOUD_KIND || value === FALLBACK_KIND;
}

export function isValidProviderTimeout(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= MIN_PROVIDER_TIMEOUT_MS &&
    value <= MAX_PROVIDER_TIMEOUT_MS
  );
}

function envValue(env: RouterEnv, names: readonly string[]): string {
  for (let i = 0; i < names.length; i++) {
    const value = env[names[i]!];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function envFlag(env: RouterEnv, names: readonly string[]): boolean {
  const value = envValue(env, names).toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

function parseMode(raw: string): RouterMode | null {
  if (!raw) return "prefer-local";
  if (raw === "fallback") return "fallback-on-local-unavailable";
  return isRouterMode(raw) ? raw : null;
}

/**
 * Read the operator flags without touching `process`. The future chat
 * integration passes `process.env`; leaving that read out keeps this module
 * pure and testable everywhere.
 */
export function parseRouterConfig(env: RouterEnv = {}): RouterConfig {
  const enabled = envFlag(env, ["PREYAS_ROUTER", "EXPO_PUBLIC_PREYAS_ROUTER"]);
  const rawMode = envValue(env, ["PREYAS_ROUTER_MODE", "EXPO_PUBLIC_PREYAS_ROUTER_MODE"]).toLowerCase();
  const mode = parseMode(rawMode);
  const manualProviderId =
    envValue(env, ["PREYAS_ROUTER_PROVIDER", "EXPO_PUBLIC_PREYAS_ROUTER_PROVIDER"]) || null;
  const allowCloudRoutes = envFlag(env, [
    "PREYAS_ROUTER_ALLOW_CLOUD",
    "EXPO_PUBLIC_PREYAS_ROUTER_ALLOW_CLOUD",
  ]);
  let error: string | undefined;
  if (!mode) error = `unknown router mode "${rawMode}"`;
  else if (enabled && mode === "manual" && !manualProviderId) error = "manual router mode needs a provider id";
  return {
    enabled,
    mode: mode ?? "prefer-local",
    manualProviderId,
    allowCloudRoutes,
    ...(error ? { error } : {}),
  };
}

function legacyDecision(): RouterDecision {
  return {
    kind: "legacy",
    providerId: null,
    providerLabel: "Existing chat path",
    reason: "router is off; the existing chat path runs unchanged",
    timeoutMs: 0,
    cloud: false,
    demo: false,
  };
}

function unavailableDecision(
  reason: string,
  options: { providerId?: string | null; demo?: boolean } = {},
): RouterDecision {
  return {
    kind: "unavailable",
    providerId: options.providerId ?? null,
    providerLabel: "Unavailable",
    reason,
    timeoutMs: 0,
    cloud: false,
    demo: options.demo === true,
  };
}

function normalizeAvailability(rows: readonly ProviderAvailability[]): ProviderAvailability[] {
  const out: ProviderAvailability[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row || typeof row !== "object") continue;
    if (typeof row.id !== "string" || !row.id.trim() || !isProviderKind(row.kind)) continue;
    const timeoutValid = isValidProviderTimeout(row.timeoutMs);
    out.push({
      id: row.id.trim(),
      kind: row.kind,
      label: typeof row.label === "string" && row.label.trim() ? row.label.trim() : row.id.trim(),
      enabled: row.enabled === true,
      demo: row.demo === true,
      timeoutMs: timeoutValid ? row.timeoutMs : 0,
      available: row.available === true && timeoutValid,
      reason: timeoutValid
        ? typeof row.reason === "string" && row.reason.trim()
          ? row.reason.trim()
          : row.available === true
            ? "available"
            : "not available"
        : "provider timeout setting is invalid",
    });
  }
  return out;
}

function isUsable(provider: ProviderAvailability | undefined): boolean {
  return Boolean(
    provider &&
      provider.enabled &&
      provider.available &&
      !provider.demo &&
      isValidProviderTimeout(provider.timeoutMs),
  );
}

function routeFor(provider: ProviderAvailability): RouterDecision {
  const kind: RouteKind =
    provider.kind === "local" ? "local" : provider.kind === FREE_CLOUD_KIND ? "free-cloud" : "fallback";
  return {
    kind,
    providerId: provider.id,
    providerLabel: provider.label,
    reason:
      provider.kind === "local"
        ? "local model is available"
        : `opted-in ${provider.kind} route is available`,
    timeoutMs: provider.timeoutMs,
    cloud: provider.kind !== "local",
    demo: false,
  };
}

function manualDecision(config: RouterConfig, providers: readonly ProviderAvailability[]): RouterDecision {
  const id = String(config.manualProviderId || "").trim();
  if (!id) return unavailableDecision("manual router mode needs a provider id");
  const provider = providers.find((row) => row.id === id);
  if (!provider) return unavailableDecision(`manual provider "${id}" is not configured`);
  if (provider.demo || !provider.enabled) {
    return unavailableDecision(
      provider.demo
        ? `manual provider "${id}" is a placeholder and is not active`
        : `manual provider "${id}" is disabled`,
      { providerId: id, demo: provider.demo },
    );
  }
  if (!provider.available) {
    return unavailableDecision(`manual provider "${id}" is unavailable: ${provider.reason}`);
  }
  if (provider.kind !== "local" && !config.allowCloudRoutes) {
    return unavailableDecision(
      `manual provider "${id}" is a cloud route; cloud routing is not opted in`,
      { providerId: id },
    );
  }
  return routeFor(provider);
}

/**
 * Deterministic priority. Availability is passed in, so this stays pure.
 * The first usable provider of a kind wins; duplicate ids are not special.
 */
export function decideRoute(
  config: RouterConfig,
  availability: readonly ProviderAvailability[],
): RouterDecision {
  if (!config.enabled) return legacyDecision();
  if (config.error) return unavailableDecision(config.error);
  if (!isRouterMode(config.mode)) return unavailableDecision(`unknown router mode "${String(config.mode)}"`);

  const providers = normalizeAvailability(availability);
  if (config.mode === "manual") return manualDecision(config, providers);

  const local = providers.find((row) => row.kind === "local");
  if (local && isUsable(local)) return routeFor(local);
  const localReason = local ? local.reason || "not available" : "not configured";

  if (config.mode === "prefer-local") {
    return unavailableDecision(`local model is unavailable: ${localReason}`);
  }

  if (!config.allowCloudRoutes) {
    return unavailableDecision(`local model is unavailable: ${localReason}; cloud fallback is not opted in`);
  }
  const fallback = providers.find((row) => row.kind === FALLBACK_KIND && isUsable(row));
  if (!fallback) {
    return unavailableDecision("local model is unavailable and no fallback provider is available");
  }
  return routeFor(fallback);
}

function isProviderLike(value: unknown): value is BrainProvider {
  if (!value || typeof value !== "object") return false;
  const provider = value as Partial<BrainProvider>;
  return (
    typeof provider.id === "string" &&
    provider.id.trim().length > 0 &&
    isProviderKind(provider.kind) &&
    typeof provider.label === "string" &&
    provider.label.trim().length > 0 &&
    typeof provider.enabled === "boolean" &&
    typeof provider.demo === "boolean" &&
    typeof provider.timeoutMs === "number" &&
    typeof provider.probeTimeoutMs === "number" &&
    typeof provider.probe === "function"
  );
}

function validProbeTimeout(value: unknown): number {
  const ms = Number(value);
  if (!Number.isFinite(ms)) return DEFAULT_PROBE_TIMEOUT_MS;
  return Math.min(MAX_PROBE_TIMEOUT_MS, Math.max(MIN_PROBE_TIMEOUT_MS, Math.round(ms)));
}

function validProbe(value: unknown): ProviderProbe {
  if (!value || typeof value !== "object") {
    return { available: false, reason: "provider probe answer was invalid" };
  }
  const record = value as { available?: unknown; reason?: unknown };
  if (typeof record.available !== "boolean") {
    return { available: false, reason: "provider probe answer was invalid" };
  }
  const reason =
    typeof record.reason === "string" && record.reason.trim()
      ? record.reason.trim()
      : record.available
        ? "available"
        : "not available";
  return { available: record.available, reason };
}

function runProbe(
  provider: BrainProvider,
  external: AbortSignal | undefined,
  timeoutMs: number,
): Promise<ProviderProbe> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const controller = new AbortController();

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      external?.removeEventListener("abort", onExternal);
    };
    const finish = (run: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      run();
    };
    function onExternal() {
      controller.abort();
      finish(() => reject(new RouterCancelledError("routing probe was cancelled")));
    }

    if (external?.aborted) {
      finish(() => reject(new RouterCancelledError("routing probe was cancelled")));
      return;
    }
    external?.addEventListener("abort", onExternal, { once: true });

    timer = setTimeout(() => {
      controller.abort();
      finish(() => resolve({ available: false, reason: "provider probe timed out" }));
    }, timeoutMs);

    let probe: Promise<ProviderProbe>;
    try {
      probe = provider.probe({ signal: controller.signal });
    } catch {
      finish(() => resolve({ available: false, reason: "provider probe failed" }));
      return;
    }
    Promise.resolve(probe).then(
      (result) => finish(() => resolve(validProbe(result))),
      () => finish(() => resolve({ available: false, reason: "provider probe failed" })),
    );
  });
}

async function probeOne(
  provider: BrainProvider,
  options: { signal?: AbortSignal; probeTimeoutMs?: number },
): Promise<ProviderAvailability | null> {
  if (!isProviderLike(provider)) return null;
  const timeoutValid = isValidProviderTimeout(provider.timeoutMs);
  const row: ProviderAvailability = {
    id: provider.id.trim(),
    kind: provider.kind,
    label: provider.label.trim(),
    enabled: provider.enabled === true,
    demo: provider.demo === true,
    timeoutMs: timeoutValid ? provider.timeoutMs : 0,
    available: false,
    reason: timeoutValid ? "" : "provider timeout setting is invalid",
  };
  if (!timeoutValid) return row;
  if (!row.enabled) {
    row.reason = row.demo ? "placeholder provider; not active" : "provider is disabled";
    return row;
  }
  const probe = await runProbe(
    provider,
    options.signal,
    validProbeTimeout(options.probeTimeoutMs ?? provider.probeTimeoutMs),
  );
  row.available = probe.available && !row.demo;
  row.reason = probe.reason;
  return row;
}

/**
 * Probe providers in parallel. Disabled and placeholder providers are not
 * contacted. A timeout becomes an unavailable row; only caller cancellation
 * rejects.
 */
export async function probeProviders(
  providers: readonly BrainProvider[],
  options: { signal?: AbortSignal; probeTimeoutMs?: number } = {},
): Promise<ProviderAvailability[]> {
  const rows = await Promise.all(providers.map((provider) => probeOne(provider, options)));
  return rows.filter((row): row is ProviderAvailability => row !== null);
}

/**
 * The whole foundation in one call: flag off means legacy and zero probes;
 * otherwise probe, then decide. It never sends user content anywhere.
 */
export async function routeChat(options: {
  config: RouterConfig;
  providers: readonly BrainProvider[];
  signal?: AbortSignal;
  probeTimeoutMs?: number;
}): Promise<RouterDecision> {
  if (!options.config.enabled) return legacyDecision();
  if (options.config.error) return unavailableDecision(options.config.error);
  if (options.signal?.aborted) throw new RouterCancelledError("routing was cancelled");
  const availability = await probeProviders(options.providers, {
    signal: options.signal,
    probeTimeoutMs: options.probeTimeoutMs,
  });
  return decideRoute(options.config, availability);
}

export type LocalProviderOptions = {
  /** The brain proxy base (`:8788`), not the LiteLLM gateway. */
  baseUrl: string;
  timeoutMs?: number;
  probeTimeoutMs?: number;
  fetchImpl?: typeof fetch;
};

function normalizedBase(raw: string): string {
  const value = String(raw || "").trim().replace(/\/+$/, "");
  return /^https?:\/\//i.test(value) ? value : "";
}

/**
 * The local adapter. Its probe only reads `GET /v1/health`; it never sends
 * a chat message. The proxy's `ok` is the llama-server health on `:8790`.
 */
export function createLocalProvider(options: LocalProviderOptions): BrainProvider {
  const base = normalizedBase(options.baseUrl);
  const fetchImpl = options.fetchImpl ?? (typeof fetch === "function" ? fetch : null);
  return {
    id: "local",
    kind: "local",
    label: "Local model",
    enabled: true,
    demo: false,
    timeoutMs: options.timeoutMs ?? DEFAULT_LOCAL_TIMEOUT_MS,
    probeTimeoutMs: options.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS,
    async probe({ signal }): Promise<ProviderProbe> {
      if (!base || !fetchImpl) return { available: false, reason: "the local brain address is missing" };
      let response: Response;
      try {
        response = await fetchImpl(`${base}/v1/health`, {
          method: "GET",
          headers: { accept: "application/json" },
          signal,
        });
      } catch (error) {
        if (signal.aborted) throw error;
        return { available: false, reason: "the local brain did not answer" };
      }
      if (response.status === 401 || response.status === 403 || response.status === 429) {
        return { available: false, reason: "the local brain needs pairing" };
      }
      if (!response.ok) {
        return { available: false, reason: `the local health route answered ${response.status}` };
      }
      const declared = Number(response.headers.get("content-length"));
      if (Number.isFinite(declared) && declared > MAX_HEALTH_BYTES) {
        return { available: false, reason: "the local health answer was too large" };
      }
      const text = await response.text();
      if (text.length > MAX_HEALTH_BYTES) {
        return { available: false, reason: "the local health answer was too large" };
      }
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        return { available: false, reason: "the local health answer was not JSON" };
      }
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return { available: false, reason: "the local health answer was not an object" };
      }
      const health = body as { ok?: unknown; service?: unknown };
      if (health.service !== undefined && health.service !== "bakugan-brain") {
        return { available: false, reason: "the local health answer came from another service" };
      }
      if (typeof health.ok !== "boolean") {
        return { available: false, reason: "the local health answer had no ok flag" };
      }
      return health.ok
        ? { available: true, reason: "local model is ready" }
        : { available: false, reason: "local model is not ready" };
    },
  };
}

export type PlaceholderProviderOptions = {
  id: string;
  label: string;
  kind: "free-cloud" | "fallback";
  timeoutMs?: number;
};

/**
 * A typed, disabled slot. It is never available, never called, and must
 * never be presented as a live provider.
 */
export function createPlaceholderProvider(options: PlaceholderProviderOptions): BrainProvider {
  return {
    id: options.id,
    kind: options.kind,
    label: options.label,
    enabled: false,
    demo: true,
    timeoutMs: options.timeoutMs ?? DEFAULT_FALLBACK_TIMEOUT_MS,
    probeTimeoutMs: DEFAULT_PROBE_TIMEOUT_MS,
    async probe(): Promise<ProviderProbe> {
      return { available: false, reason: "placeholder provider; not configured in this build" };
    },
  };
}

/** The one free-cloud slot reserved for a later, explicitly configured PR. */
export function createFreeCloudSlot(): BrainProvider {
  return createPlaceholderProvider({
    id: FREE_CLOUD_PROVIDER_ID,
    label: "Free cloud slot (placeholder)",
    kind: "free-cloud",
  });
}

/** The dedicated fallback slot, off until an operator configures one. */
export function createFallbackSlot(): BrainProvider {
  return createPlaceholderProvider({
    id: FALLBACK_PROVIDER_ID,
    label: "Fallback route (placeholder)",
    kind: "fallback",
  });
}

/** Local plus the two disabled slots, ready for the future chat integration. */
export function createDefaultProviders(options: {
  localBaseUrl: string;
  fetchImpl?: typeof fetch;
  localTimeoutMs?: number;
}): BrainProvider[] {
  return [
    createLocalProvider({
      baseUrl: options.localBaseUrl,
      fetchImpl: options.fetchImpl,
      timeoutMs: options.localTimeoutMs,
    }),
    createFreeCloudSlot(),
    createFallbackSlot(),
  ];
}

/** Snapshot for the Brain live status; checkedAt is only set when work happened. */
export function routerStatus(
  decision: RouterDecision,
  config: RouterConfig,
  options: { now?: () => number } = {},
): RouterStatus {
  const now = options.now ?? (() => Date.now());
  return {
    enabled: config.enabled,
    mode: config.mode,
    route: decision.kind,
    providerId: decision.providerId,
    reason: decision.reason,
    checkedAt: config.enabled && decision.kind !== "legacy" ? new Date(now()).toISOString() : null,
    demo: decision.demo,
    cloud: decision.cloud,
    timeoutMs: decision.timeoutMs,
  };
}

/**
 * Map a routing status onto the router node the Brain live map already has.
 * A demo or disabled router is "planned", never "online".
 */
export function routerBrainNode(status: RouterStatus): RouterBrainNode {
  const active = status.enabled && !status.demo;
  const brainStatus: RouterBrainStatus =
    !active || status.route === "legacy"
      ? "planned"
      : status.route === "local"
        ? "online"
        : status.route === "fallback" || status.route === "free-cloud"
          ? "fallback"
          : "unavailable";
  const hint = status.demo
    ? "Placeholder"
    : !status.enabled
      ? "Routing off"
      : status.route === "local"
        ? "Local first"
        : status.route === "fallback"
          ? "Fallback"
          : status.route === "free-cloud"
            ? "Free cloud"
            : "Unavailable";
  const statusNote = !status.enabled
    ? "Routing is off; chat uses the existing local-first path."
    : status.demo
      ? "Placeholder route — not active."
      : status.route === "local"
        ? `Routing to ${status.providerId || "the local model"}.`
        : status.route === "fallback"
          ? "Routing to an explicitly opted-in fallback."
          : status.route === "free-cloud"
            ? "Routing to the selected free-cloud provider."
            : status.reason;
  return {
    id: "router",
    name: "Router",
    hint,
    description:
      "The decision layer that picks which brain handles a request, based on what is online and what you asked for.",
    status: brainStatus,
    statusNote,
    live: active && (status.route === "local" || status.route === "fallback" || status.route === "free-cloud"),
  };
}
