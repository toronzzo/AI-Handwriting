/**
 * The one opt-in free-cloud provider: Groq (GroqCloud, Free plan).
 *
 * Why this provider, checked against its own documentation rather than
 * assumed:
 *   - Chat:   POST https://api.groq.com/openai/v1/chat/completions
 *   - Models: GET  https://api.groq.com/openai/v1/models
 *   - Auth:   Authorization: Bearer <key>, a Groq API key from
 *             console.groq.com (no team or project header required).
 *   - Shape:  OpenAI-compatible chat completions, the same shape the local
 *             brain already speaks.
 *   - Free:   a standing Free plan. The Free sample limits published per
 *             model are 30 RPM, 1K RPD, 8K TPM and 200K TPD; the account's
 *             own Limits page is authoritative, so this module keeps chat
 *             requests small (CHAT_MAX_TOKENS) and treats 429 as busy.
 *   - Data:   console.groq.com/docs/your-data says inputs and outputs are
 *             not retained by default for inference; usage metadata always
 *             is, and short logs may be kept for reliability or abuse
 *             checks. A free cloud route therefore still leaves the Mac,
 *             which is why this adapter is only ever built after explicit
 *             opt-in.
 *
 * What this module does NOT hold: keys are read from the environment (or an
 * existing secrets file the caller passes in). A missing, blank, placeholder
 * or malformed key disables the provider entirely; it is never logged, never
 * echoed in an error, and never put in a status string.
 *
 * Every request is bounded: one AbortController, one timeout, size caps on
 * the answer, and the caller's own signal plumbed through. A caller
 * cancellation and a provider timeout stay distinct errors.
 *
 * Pure logic, no React and no react-native imports, so it runs under
 * node --experimental-strip-types.
 */
import { CHAT_MAX_TOKENS, getChatSystem, trimHistory, type ChatMessage, type TokenUsage } from "./chatTurn.ts";
import {
  DEFAULT_FALLBACK_TIMEOUT_MS,
  DEFAULT_PROBE_TIMEOUT_MS,
  MAX_PROBE_TIMEOUT_MS,
  MIN_PROBE_TIMEOUT_MS,
  RouterCancelledError,
  createDefaultProviders,
  isValidProviderTimeout,
  parseRouterConfig,
  type BrainProvider,
  type ProviderProbe,
  type RouterConfig,
  type RouterEnv,
} from "./router.ts";

// A large chat and models budget still bound what one call can read.
export const MAX_CHAT_BYTES = 65_536;
export const MAX_MODELS_BYTES = 256 * 1024;
export const MAX_REPLY_CHARS = 4_000;

/** Provider labels are fixed strings; no credential ever reaches them. */
export const GROQ_PROVIDER_ID = "groq";
export const GROQ_LABEL = "Groq (free plan)";
export const GROQ_DEFAULT_BASE_URL = "https://api.groq.com/openai/v1";
export const GROQ_CHAT_PATH = "/chat/completions";
export const GROQ_MODELS_PATH = "/models";
/**
 * Groq's cheapest production chat model: 30 RPM, 1K RPD, 8K TPM on the
 * Free plan, which leaves room for a 512-token answer inside the
 * per-minute token cap. An operator may name another Groq model with
 * GROQ_MODEL.
 */
export const GROQ_DEFAULT_MODEL = "llama-3.1-8b-instant";

/** Placeholder values are treated as unset, like paidAvailability does. */
const PLACEHOLDER_KEYS: readonly string[] = ["", "changeme", "\"\"", "''", "your-key-here", "xxx"];
const GROQ_KEY_PREFIX = "gsk_";
const MIN_KEY_LENGTH = GROQ_KEY_PREFIX.length + 8;
const MAX_KEY_LENGTH = 256;

/**
 * Stable reasons. Plain sentences that mention no credential, no provider
 * error body and no account detail, so a status note can show one safely.
 */
export const GROQ_REASON = {
  ready: "free cloud provider is ready",
  noKey: "no free cloud provider key on this Mac",
  placeholderKey: "the free cloud provider key is still a placeholder",
  badKey: "the free cloud provider key does not look like a valid key",
  badBaseUrl: "the free cloud provider address is invalid",
  badModel: "the free cloud provider model name is invalid",
  badTimeout: "the free cloud provider timeout setting is invalid",
  unauthorized: "the free cloud provider rejected the key",
  rateLimited: "the free cloud provider is rate limited right now",
  unreachable: "the free cloud provider did not answer",
  refused: "the free cloud provider answered with an error",
  tooLarge: "the free cloud provider answer was too large",
  badAnswer: "the free cloud provider answer was not what this build expected",
  emptyAnswer: "the free cloud provider returned an empty answer",
  timedOut: "the free cloud provider timed out",
  unknownModel: "the configured free cloud model is not offered right now",
} as const;

export type GroqReason = (typeof GROQ_REASON)[keyof typeof GROQ_REASON];

/** The provider's answer is unusable, for one of the reasons above. */
export class GroqResponseError extends Error {
  code: GroqReason;

  constructor(code: GroqReason) {
    super(code);
    this.name = "GroqResponseError";
    this.code = code;
  }
}

/** One Groq route pair, so the adapter can be pointed at a test server. */
export type GroqRoutes = {
  /** Absolute chat completions URL. */
  chat: string;
  /** Absolute model-list URL. */
  models: string;
};

export type GroqConfig = {
  /** True only when a real key was supplied; false keeps the slot disabled. */
  enabled: boolean;
  /** The key itself. Never logged, never returned in a status. */
  apiKey: string;
  baseUrl: string;
  model: string;
  /** Chat generation budget. */
  timeoutMs: number;
  /** Health/model-list probe budget. */
  probeTimeoutMs: number;
  /** Non-empty when configuration was invalid; the provider stays unavailable. */
  error?: string;
};

/**
 * The environment surface, following the router's existing flag naming so
 * one file can configure both the brain-server and the app build.
 */
export const GROQ_ENV = {
  key: ["GROQ_API_KEY", "PREYAS_FREE_CLOUD_KEY"],
  baseUrl: ["GROQ_BASE_URL", "PREYAS_FREE_CLOUD_BASE_URL"],
  model: ["GROQ_MODEL", "PREYAS_FREE_CLOUD_MODEL"],
  timeout: ["PREYAS_FREE_CLOUD_TIMEOUT_MS"],
  probeTimeout: ["PREYAS_FREE_CLOUD_PROBE_TIMEOUT_MS"],
} as const;

export function envFlag(env: RouterEnv, names: readonly string[]): boolean {
  const value = readEnvValue(env, names).toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

export function readEnvValue(env: RouterEnv, names: readonly string[]): string {
  for (let i = 0; i < names.length; i++) {
    const raw = env[names[i]!];
    if (typeof raw === "string" && raw.trim()) return raw.trim();
  }
  return "";
}

/** Why a key cannot be used; null when it can. Never includes the key. */
export function groqKeyProblem(key: string): GroqReason | null {
  if (!key) return GROQ_REASON.noKey;
  if (PLACEHOLDER_KEYS.includes(key.toLowerCase())) return GROQ_REASON.placeholderKey;
  if (key.length < MIN_KEY_LENGTH || key.length > MAX_KEY_LENGTH) return GROQ_REASON.badKey;
  if (!key.startsWith(GROQ_KEY_PREFIX)) return GROQ_REASON.badKey;
  if (!/^[A-Za-z0-9_-]+$/.test(key)) return GROQ_REASON.badKey;
  return null;
}

/**
 * The base must be https. Plain http is allowed only on loopback, for a
 * local test server, so a typo cannot quietly send a key in the clear.
 */
export function groqBaseUrlProblem(raw: string): GroqReason | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return GROQ_REASON.badBaseUrl;
  }
  if (url.protocol === "https:") return null;
  const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]";
  return url.protocol === "http:" && loopback ? null : GROQ_REASON.badBaseUrl;
}

export function groqModelProblem(raw: string): GroqReason | null {
  if (!raw) return null;
  if (raw.length > 96) return GROQ_REASON.badModel;
  // Groq ids look like "llama-3.1-8b-instant" or "openai/gpt-oss-20b".
  return /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(raw) ? null : GROQ_REASON.badModel;
}

/** NaN when the raw value is present but outside the range or not a number. */
function timeoutValue(raw: string, min: number, max: number): number {
  if (!raw) return NaN;
  const ms = Number(raw);
  return Number.isFinite(ms) && ms >= min && ms <= max ? Math.round(ms) : NaN;
}

/**
 * Read and validate the provider configuration. This never touches process
 * and never performs a request: a bad value yields a disabled provider with
 * a plain error, so the router can report unavailable without calling out.
 */
export function parseGroqConfig(env: RouterEnv = {}): GroqConfig {
  const apiKey = readEnvValue(env, GROQ_ENV.key);
  const rawBase = readEnvValue(env, GROQ_ENV.baseUrl);
  const rawModel = readEnvValue(env, GROQ_ENV.model);
  const rawTimeout = readEnvValue(env, GROQ_ENV.timeout);
  const rawProbeTimeout = readEnvValue(env, GROQ_ENV.probeTimeout);

  const timeoutMs = timeoutValue(rawTimeout, 1_000, 120_000);
  const probeTimeoutMs = timeoutValue(rawProbeTimeout, MIN_PROBE_TIMEOUT_MS, MAX_PROBE_TIMEOUT_MS);
  const badTimeout = (Boolean(rawTimeout) && Number.isNaN(timeoutMs)) || (Boolean(rawProbeTimeout) && Number.isNaN(probeTimeoutMs));

  const key = groqKeyProblem(apiKey);
  const base = groqBaseUrlProblem(rawBase);
  const model = groqModelProblem(rawModel);

  let error: string | undefined;
  if (badTimeout) error = GROQ_REASON.badTimeout;
  else if (base) error = base;
  else if (model) error = model;
  else if (key && key !== GROQ_REASON.noKey && key !== GROQ_REASON.placeholderKey) error = key;

  return {
    // A missing or placeholder key is not a configuration error: the slot
    // simply stays off, like an unconfigured paid fallback.
    enabled: !error && key === null,
    apiKey: key === null ? apiKey : "",
    baseUrl: rawBase || GROQ_DEFAULT_BASE_URL,
    model: rawModel || GROQ_DEFAULT_MODEL,
    timeoutMs: Number.isNaN(timeoutMs) ? DEFAULT_FALLBACK_TIMEOUT_MS : timeoutMs,
    probeTimeoutMs: Number.isNaN(probeTimeoutMs) ? DEFAULT_PROBE_TIMEOUT_MS : probeTimeoutMs,
    ...(error ? { error } : {}),
  };
}

/** The routes for one configuration; both share the validated base. */
export function groqRoutes(baseUrl: string): GroqRoutes {
  const base = baseUrl.replace(/\/+$/, "");
  return { chat: base + GROQ_CHAT_PATH, models: base + GROQ_MODELS_PATH };
}

/** How a provider failure maps onto routing. Same split the probes use. */
export type GroqFailureKind = "cancelled" | "timeout" | "unavailable";

export function groqFailureKind(error: unknown): GroqFailureKind {
  if (error instanceof RouterCancelledError) return "cancelled";
  if (error instanceof GroqResponseError) {
    return error.code === GROQ_REASON.timedOut ? "timeout" : "unavailable";
  }
  return "unavailable";
}

export type GroqCallOptions = {
  signal?: AbortSignal;
  /** Deadline for this one request; also bounds the response body read. */
  timeoutMs: number;
};

export type GroqChatResult = {
  text: string;
  usage: TokenUsage | null;
  model: string;
};

/** The router's provider plus the one chat call this PR adds. */
export type GroqProvider = BrainProvider & {
  readonly kind: "free-cloud";
  chat(messages: readonly ChatMessage[], options: GroqCallOptions): Promise<GroqChatResult>;
};

export type GroqAdapterOptions = {
  config: GroqConfig;
  fetchImpl?: typeof fetch;
};

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(new RouterCancelledError("the free cloud request was cancelled"));
    }
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** Read a body, refusing anything past max bytes; never buffers more. */
async function readCapped(response: Response, max: number): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) throw new GroqResponseError(GROQ_REASON.tooLarge);
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  for (;;) {
    const step = await reader.read();
    if (step.done) break;
    size += step.value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => undefined);
      throw new GroqResponseError(GROQ_REASON.tooLarge);
    }
    text += decoder.decode(step.value, { stream: true });
  }
  return text + decoder.decode();
}

/** Keep only finite, non-negative token counts; null when there are none. */
function usageFrom(raw: unknown): TokenUsage | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as { prompt_tokens?: unknown; completion_tokens?: unknown };
  const out: TokenUsage = {};
  if (Number.isFinite(row.prompt_tokens) && Number(row.prompt_tokens) >= 0) out.prompt_tokens = Number(row.prompt_tokens);
  if (Number.isFinite(row.completion_tokens) && Number(row.completion_tokens) >= 0) {
    out.completion_tokens = Number(row.completion_tokens);
  }
  return out.prompt_tokens !== undefined || out.completion_tokens !== undefined ? out : null;
}

/**
 * Validate a chat completion before anyone uses it: a JSON object, at least
 * one choice, and a non-empty string message. Anything else is refused.
 */
export function parseGroqChatBody(body: unknown): GroqChatResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new GroqResponseError(GROQ_REASON.badAnswer);
  }
  const record = body as { choices?: unknown; usage?: unknown; model?: unknown };
  if (!Array.isArray(record.choices) || record.choices.length === 0) {
    throw new GroqResponseError(GROQ_REASON.badAnswer);
  }
  const choice = record.choices[0] as { message?: { content?: unknown } } | null;
  const content = choice && typeof choice === "object" && choice.message ? choice.message.content : undefined;
  if (typeof content !== "string") throw new GroqResponseError(GROQ_REASON.badAnswer);
  const text = content.replace(/\r\n/g, "\n").trim().slice(0, MAX_REPLY_CHARS);
  if (!text) throw new GroqResponseError(GROQ_REASON.emptyAnswer);
  return {
    text,
    usage: usageFrom(record.usage),
    model: typeof record.model === "string" && record.model ? record.model : "",
  };
}

/** Validate the model catalogue the health probe reads. */
export function parseGroqModelsBody(body: unknown): string[] {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new GroqResponseError(GROQ_REASON.badAnswer);
  }
  const data = (body as { data?: unknown }).data;
  if (!Array.isArray(data)) throw new GroqResponseError(GROQ_REASON.badAnswer);
  const ids: string[] = [];
  for (let i = 0; i < data.length; i++) {
    const row = data[i] as { id?: unknown; active?: unknown } | null;
    if (!row || typeof row !== "object") continue;
    if (row.active === false) continue;
    if (typeof row.id === "string" && row.id.trim()) ids.push(row.id.trim());
  }
  return ids;
}

/**
 * The cloud route sees no more than the local one: the persona system
 * message, the newest turns that fit the local history budget, and the
 * user turn. It never receives notes, the Brain view or any other state.
 */
export function boundedCloudMessages(messages: readonly ChatMessage[]): ChatMessage[] {
  const rows = messages.filter((row) => row && typeof row.content === "string" && row.role !== "system");
  rows.unshift({ role: "system", content: getChatSystem() });
  return trimHistory(rows);
}

/** HTTP status -> the stable reason a status note can show. */
export function groqReasonForStatus(status: number): GroqReason {
  if (status === 401 || status === 403) return GROQ_REASON.unauthorized;
  if (status === 429) return GROQ_REASON.rateLimited;
  return GROQ_REASON.refused;
}

/**
 * The adapter. It presents itself as the router's one free-cloud provider,
 * and it is enabled only when the configuration parsed cleanly with a real
 * key. A missing key yields a typed, disabled slot that is never called.
 */
export function createGroqProvider(options: GroqAdapterOptions): GroqProvider {
  const { config } = options;
  const fetchImpl = options.fetchImpl ?? (typeof fetch === "function" ? fetch : null);
  const routes = groqRoutes(config.baseUrl);
  const timeoutOk = isValidProviderTimeout(config.timeoutMs);
  const enabled = config.enabled && !config.error && timeoutOk && fetchImpl !== null;

  /**
   * One bounded request. Caller cancellation rejects as cancelled, the
   * provider's own deadline rejects as timed out, and a network failure
   * rejects as unavailable. No raw error text leaves this function.
   */
  async function request(
    url: string,
    init: { method: "GET" | "POST"; body?: string; maxBytes: number },
    call: GroqCallOptions,
  ): Promise<unknown> {
    if (call.signal?.aborted) {
      throw new RouterCancelledError("the free cloud request was cancelled");
    }
    if (!fetchImpl) throw new GroqResponseError(GROQ_REASON.unreachable);
    const controller = new AbortController();
    let timedOut = false;
    const caller = call.signal;
    const onCallerAbort = () => controller.abort();
    caller?.addEventListener("abort", onCallerAbort, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, call.timeoutMs);
    const cancelled = () => new RouterCancelledError("the free cloud request was cancelled");
    try {
      let response: Response;
      try {
        response = await fetchImpl(url, {
          method: init.method,
          headers: {
            accept: "application/json",
            authorization: "Bearer " + config.apiKey,
            ...(init.body ? { "content-type": "application/json" } : {}),
          },
          ...(init.body ? { body: init.body } : {}),
          signal: controller.signal,
          // Never follow a redirect with a credential attached.
          redirect: "error",
        });
      } catch {
        if (caller?.aborted) throw cancelled();
        if (timedOut) throw new GroqResponseError(GROQ_REASON.timedOut);
        throw new GroqResponseError(GROQ_REASON.unreachable);
      }
      if (!response.ok) {
        // The error body is provider text and is never shown or kept.
        await response.body?.cancel().catch(() => undefined);
        if (response.status === 429) {
          const retry = Number(response.headers.get("retry-after"));
          if (Number.isFinite(retry) && retry > 0) {
            await abortableSleep(Math.min(retry * 1000, call.timeoutMs), controller.signal);
          }
        }
        throw new GroqResponseError(groqReasonForStatus(response.status));
      }
      let text: string;
      try {
        text = await readCapped(response, init.maxBytes);
      } catch (error) {
        if (error instanceof GroqResponseError) throw error;
        if (caller?.aborted) throw cancelled();
        if (timedOut) throw new GroqResponseError(GROQ_REASON.timedOut);
        throw new GroqResponseError(GROQ_REASON.unreachable);
      }
      try {
        return JSON.parse(text) as unknown;
      } catch {
        throw new GroqResponseError(GROQ_REASON.badAnswer);
      }
    } finally {
      clearTimeout(timer);
      caller?.removeEventListener("abort", onCallerAbort);
    }
  }

  return {
    id: GROQ_PROVIDER_ID,
    kind: "free-cloud",
    label: GROQ_LABEL,
    enabled,
    demo: false,
    timeoutMs: timeoutOk ? config.timeoutMs : 0,
    probeTimeoutMs: config.probeTimeoutMs,
    async probe({ signal }): Promise<ProviderProbe> {
      if (!enabled) {
        return { available: false, reason: config.error || GROQ_REASON.noKey };
      }
      // The model list is a no-user-content health read: same key, no chat.
      const body = await request(
        routes.models,
        { method: "GET", maxBytes: MAX_MODELS_BYTES },
        { signal, timeoutMs: config.probeTimeoutMs },
      );
      let ids: string[];
      try {
        ids = parseGroqModelsBody(body);
      } catch {
        return { available: false, reason: GROQ_REASON.badAnswer };
      }
      if (!ids.includes(config.model)) {
        return { available: false, reason: GROQ_REASON.unknownModel };
      }
      return { available: true, reason: GROQ_REASON.ready };
    },
    /**
     * One chat turn over HTTPS. Never called automatically: the router only
     * reaches this in fallback or manual mode, after the cloud opt-in.
     */
    async chat(messages, call): Promise<GroqChatResult> {
      if (!enabled) throw new GroqResponseError(GROQ_REASON.noKey);
      const body = await request(
        routes.chat,
        {
          method: "POST",
          maxBytes: MAX_CHAT_BYTES,
          body: JSON.stringify({
            model: config.model,
            messages: boundedCloudMessages(messages).map((row) => ({ role: row.role, content: row.content })),
            max_completion_tokens: CHAT_MAX_TOKENS,
            temperature: 0.8,
            stream: false,
          }),
        },
        { signal: call.signal, timeoutMs: call.timeoutMs },
      );
      return parseGroqChatBody(body);
    },
  };
}

/** The config for a process environment, without ever touching process itself. */
export function freeCloudConfigFromEnv(env: RouterEnv = {}): GroqConfig {
  return parseGroqConfig(env);
}

/**
 * Build the whole provider list from operator configuration. Every input
 * defaults off: with an empty environment this returns the same local adapter
 * and two disabled slots the foundation shipped.
 *
 * The free-cloud provider is only built when `PREYAS_FREE_CLOUD=1` (or its
 * EXPO_PUBLIC_ twin) is set AND the router flags allow a cloud route at all.
 * A missing key still builds a typed, disabled slot rather than a live one, so
 * a half-configured install reports unavailable instead of half-working.
 */
export function createConfiguredProviders(options: {
  localBaseUrl: string;
  env?: RouterEnv;
  fetchImpl?: typeof fetch;
  localTimeoutMs?: number;
}): { config: RouterConfig; providers: BrainProvider[] } {
  const env = options.env ?? {};
  const config = parseRouterConfig(env);
  const optedIn = envFlag(env, ["PREYAS_FREE_CLOUD", "EXPO_PUBLIC_PREYAS_FREE_CLOUD"]);
  const cloudConfig = parseGroqConfig(env);
  const wantsCloud =
    optedIn && config.enabled && !config.error && (config.allowCloudRoutes || false);
  const cloud = wantsCloud
    ? createGroqProvider({ config: cloudConfig, fetchImpl: options.fetchImpl })
    : null;
  return {
    config,
    providers: createDefaultProviders({
      localBaseUrl: options.localBaseUrl,
      fetchImpl: options.fetchImpl,
      localTimeoutMs: options.localTimeoutMs,
      cloudProvider: cloud,
    }),
  };
}

/** A provider that can answer one chat turn (used by the wiring below). */
export function isGroqProvider(value: unknown): value is GroqProvider {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as GroqProvider).chat === "function" &&
      (value as BrainProvider).kind === "free-cloud",
  );
}
/**
 * The routed chat result. Shaped like the local stream result so a caller can
 * handle both the same way, and it never carries a raw provider error:
 * error is the stable reason sentence.
 */
export type GroqTurnResult =
  | { ok: true; text: string; usage: TokenUsage | null; model: string; error: ""; kind: "ok" }
  | { ok: false; text: ""; usage: null; model: ""; error: string; kind: Exclude<GroqFailureKind, "cancelled"> };

/**
 * Answer one chat turn on the free cloud provider. This is the only place
 * that calls it, and it refuses to run unless the router already decided on
 * this provider: a legacy, local or unavailable decision returns a no-op
 * result without a single request.
 */
export async function freeCloudTurn(options: {
  provider: GroqProvider;
  decision: { kind: string; providerId: string | null };
  messages: readonly ChatMessage[];
  signal?: AbortSignal;
}): Promise<GroqTurnResult> {
  const { provider, decision } = options;
  if (decision.kind !== "free-cloud" || decision.providerId !== provider.id) {
    return { ok: false, text: "", usage: null, model: "", error: "the router did not choose the free cloud provider", kind: "unavailable" };
  }
  if (!provider.enabled) {
    return { ok: false, text: "", usage: null, model: "", error: GROQ_REASON.noKey, kind: "unavailable" };
  }
  try {
    const result = await provider.chat(options.messages, {
      signal: options.signal,
      timeoutMs: provider.timeoutMs,
    });
    return { ok: true, text: result.text, usage: result.usage, model: result.model, error: "", kind: "ok" };
  } catch (error) {
    // A cancellation is not a provider failure: rethrow it so the caller can
    // tell the two apart. Everything else becomes a stable reason.
    if (error instanceof RouterCancelledError) throw error;
    const code = error instanceof GroqResponseError ? error.code : GROQ_REASON.unreachable;
    const kind = groqFailureKind(error);
    return { ok: false, text: "", usage: null, model: "", error: code, kind: kind === "cancelled" ? "unavailable" : kind };
  }
}
