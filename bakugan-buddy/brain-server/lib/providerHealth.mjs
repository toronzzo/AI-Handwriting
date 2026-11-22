/**
 * Typed, non-secret provider status for GET /v1/health.
 *
 * Reuses the router/free-cloud adapters and the existing paidAvailability
 * helper. The block is additive: older clients that only read `ok` keep
 * working. Nothing here ever returns a key, an account id, a raw provider
 * error body, or any other secret.
 *
 * Probes are bounded and cancellable. Chat / user-content requests are never
 * made. A provider that is not configured is reported and not contacted.
 */
import {
  GROQ_LABEL,
  GROQ_REASON,
  GroqResponseError,
  createGroqProvider,
  groqFailureKind,
  groqKeyProblem,
  parseGroqConfig,
  readEnvValue,
  GROQ_ENV,
} from "../../packages/alive/src/freeCloud.ts";
import { RouterCancelledError } from "../../packages/alive/src/router.ts";
import { paidAvailability } from "./history.mjs";

/** Brain map node ids the mobile liveBrain parser already understands. */
export const HEALTH_LOCAL_ID = "local-model";
export const HEALTH_FREE_ID = "free-provider";
export const HEALTH_PAID_ID = "paid-fallback";

export const LOCAL_LABEL = "Local model";
export const PAID_LABEL = "Paid fallback";

/** Stable paid reasons — no key material, no gateway error text. */
export const PAID_REASON = {
  ready: "paid fallback is ready",
  noKey: "no paid fallback key on this Mac",
  gatewayDown: "paid fallback key is set, but the gateway is not running",
  unreachable: "paid fallback gateway did not answer",
  timedOut: "paid fallback gateway timed out",
};

const SECRET_LIKE = /(?:gsk_|sk-)[A-Za-z0-9_-]{8,}/g;

/**
 * One public provider row. Shape matches the mobile liveBrain parser:
 *   { id, label, configured, available, reason, checkedAt }
 */
export function providerRow({ id, label, configured, available, reason, checkedAt }) {
  return {
    id: String(id),
    label: String(label || id),
    configured: configured === true,
    available: available === true && configured === true,
    reason: sanitizeReason(reason),
    checkedAt: typeof checkedAt === "string" && checkedAt ? checkedAt : null,
  };
}

/** Drop anything that looks like a credential from a status sentence. */
export function sanitizeReason(reason) {
  const text = String(reason || "")
    .replace(SECRET_LIKE, "[redacted]")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "not available";
  return text.slice(0, 160);
}

const PLACEHOLDER_VALUES = new Set(["", "changeme", "\"\"", "''", "your-key-here", "xxx"]);

/** Parse KEY=value lines without returning the secret to callers of health. */
export function parseEnvText(text) {
  const env = {};
  for (const line of String(text || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    let key = trimmed.slice(0, eq).trim();
    if (/^export\s+/i.test(key)) key = key.replace(/^export\s+/i, "").trim();
    let value = trimmed.slice(eq + 1).trim();
    const quoted =
      (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"));
    if (quoted) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, "").trim();
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) env[key] = value;
  }
  return env;
}

function isPlaceholder(value) {
  return PLACEHOLDER_VALUES.has(String(value ?? "").trim().toLowerCase());
}

/**
 * Merge brain.env and secrets files under the process environment.
 * A real key in a file is kept when the process only has a placeholder, so
 * `GROQ_API_KEY=changeme` in the environment cannot hide the key on disk.
 * Later files win over earlier files. A real process value wins over files.
 */
export function providerEnvFromSources({ processEnv = {}, texts = [] } = {}) {
  const files = (texts || []).map((text) => parseEnvText(text));
  const merged = {};
  for (const file of files) {
    for (const [key, value] of Object.entries(file)) merged[key] = value;
  }
  for (const [key, value] of Object.entries(processEnv || {})) {
    if (typeof value === "string") merged[key] = value;
  }
  for (const name of ["GROQ_API_KEY", "PREYAS_FREE_CLOUD_KEY"]) {
    if (!isPlaceholder(merged[name])) continue;
    let found = "";
    for (const file of files) {
      if (!isPlaceholder(file[name])) found = file[name];
    }
    if (found) merged[name] = found;
  }
  return merged;
}

/**
 * Merge secrets/.env files under process env. Process wins so a launched
 * brain-server can override the drive file without rewriting it.
 */
export function mergeProviderEnv(processEnv = {}, fileEnv = {}) {
  return { ...fileEnv, ...processEnv };
}

function localRow(localOnline, checkedAt) {
  return providerRow({
    id: HEALTH_LOCAL_ID,
    label: LOCAL_LABEL,
    configured: true,
    available: localOnline === true,
    reason: localOnline === true ? "local model is ready" : "local model is not ready",
    checkedAt,
  });
}

/**
 * Free-cloud (Groq) status. Missing / placeholder keys are not configured and
 * are never probed. A real key is configured; only then is the no-user-content
 * models probe run.
 */
export async function freeProviderStatus(options = {}) {
  const {
    env = {},
    fetchImpl = fetch,
    signal,
    checkedAt = new Date().toISOString(),
    probeTimeoutMs,
  } = options;

  const rawKey = readEnvValue(env, GROQ_ENV.key);
  const keyProblem = groqKeyProblem(rawKey);
  const config = parseGroqConfig(env);

  if (keyProblem === GROQ_REASON.noKey || keyProblem === GROQ_REASON.placeholderKey) {
    return providerRow({
      id: HEALTH_FREE_ID,
      label: GROQ_LABEL,
      configured: false,
      available: false,
      reason: keyProblem || GROQ_REASON.noKey,
      checkedAt,
    });
  }

  // A present key counts as configured even when the value is malformed; the
  // probe is skipped until parseGroqConfig marks the adapter enabled.
  if (!config.enabled) {
    return providerRow({
      id: HEALTH_FREE_ID,
      label: GROQ_LABEL,
      configured: true,
      available: false,
      reason: config.error || keyProblem || GROQ_REASON.badKey,
      checkedAt,
    });
  }

  const provider = createGroqProvider({
    config: {
      ...config,
      ...(Number.isFinite(probeTimeoutMs) ? { probeTimeoutMs } : {}),
    },
    fetchImpl,
  });

  try {
    const probe = await provider.probe({ signal: signal ?? new AbortController().signal });
    return providerRow({
      id: HEALTH_FREE_ID,
      label: GROQ_LABEL,
      configured: true,
      available: probe.available === true,
      reason: probe.reason || (probe.available ? GROQ_REASON.ready : GROQ_REASON.unreachable),
      checkedAt,
    });
  } catch (error) {
    if (error instanceof RouterCancelledError || signal?.aborted) throw error;
    if (error instanceof GroqResponseError) {
      return providerRow({
        id: HEALTH_FREE_ID,
        label: GROQ_LABEL,
        configured: true,
        available: false,
        reason: error.code,
        checkedAt,
      });
    }
    const kind = groqFailureKind(error);
    return providerRow({
      id: HEALTH_FREE_ID,
      label: GROQ_LABEL,
      configured: true,
      available: false,
      reason: kind === "timeout" ? GROQ_REASON.timedOut : GROQ_REASON.unreachable,
      checkedAt,
    });
  }
}

/**
 * Paid DeepSeek fallback. Configured when a real key is present; the gateway
 * on :4000 is only probed when configured.
 */
export async function paidProviderStatus(options = {}) {
  const {
    envText = "",
    fetchImpl = fetch,
    signal,
    checkedAt = new Date().toISOString(),
    gatewayUrl = "http://127.0.0.1:4000/v1/models",
    probeTimeoutMs = 2_000,
  } = options;

  const status = paidAvailability(envText);
  if (!status.available) {
    return providerRow({
      id: HEALTH_PAID_ID,
      label: PAID_LABEL,
      configured: false,
      available: false,
      reason: PAID_REASON.noKey,
      checkedAt,
    });
  }

  let gateway = false;
  let timedOut = false;
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, Math.max(50, probeTimeoutMs));
  try {
    if (signal?.aborted) throw new RouterCancelledError("paid provider probe was cancelled");
    const response = await fetchImpl(gatewayUrl, {
      method: "GET",
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    gateway = response.ok === true;
  } catch (error) {
    if (signal?.aborted && !timedOut) throw new RouterCancelledError("paid provider probe was cancelled");
    if (timedOut) {
      return providerRow({
        id: HEALTH_PAID_ID,
        label: PAID_LABEL,
        configured: true,
        available: false,
        reason: PAID_REASON.timedOut,
        checkedAt,
      });
    }
    return providerRow({
      id: HEALTH_PAID_ID,
      label: PAID_LABEL,
      configured: true,
      available: false,
      reason: PAID_REASON.unreachable,
      checkedAt,
    });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }

  return providerRow({
    id: HEALTH_PAID_ID,
    label: PAID_LABEL,
    configured: true,
    available: gateway,
    reason: gateway ? PAID_REASON.ready : PAID_REASON.gatewayDown,
    checkedAt,
  });
}

/**
 * Build the additive `providers` list for /v1/health.
 * Local uses the already-computed llama probe so the route never calls itself.
 */
export async function collectProviderHealth(options = {}) {
  const {
    localOnline = false,
    env = {},
    envText = "",
    fetchImpl = fetch,
    signal,
    now = () => new Date().toISOString(),
    probeTimeoutMs,
    gatewayUrl,
  } = options;

  const checkedAt = now();
  const local = localRow(localOnline, checkedAt);

  // Free and paid probes run in parallel; either may be skipped when not configured.
  const [free, paid] = await Promise.all([
    freeProviderStatus({ env, fetchImpl, signal, checkedAt, probeTimeoutMs }),
    paidProviderStatus({ envText, fetchImpl, signal, checkedAt, probeTimeoutMs, gatewayUrl }),
  ]);

  return [local, free, paid];
}

/** True when a JSON value looks secret-bearing; used by tests and a last-line check. */
export function healthPayloadHasSecrets(value, knownSecrets = []) {
  const text = JSON.stringify(value);
  if (/(?:gsk_|sk-)[A-Za-z0-9_-]{8,}/.test(text)) return true;
  for (const secret of knownSecrets) {
    if (secret && String(secret).length >= 8 && text.includes(String(secret))) return true;
  }
  return false;
}
