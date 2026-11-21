/**
 * Free-cloud provider tests. Every network call is a fake fetch: no key, no
 * real request and no real secret appears anywhere in this file.
 */
/// <reference types="node" />
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { chooseRoute } from "./chatTurn.ts";
import {
  GROQ_DEFAULT_BASE_URL,
  GROQ_DEFAULT_MODEL,
  GROQ_PROVIDER_ID,
  GROQ_REASON,
  GroqResponseError,
  boundedCloudMessages,
  createConfiguredProviders,
  createGroqProvider,
  groqRoutes,
  parseGroqChatBody,
  parseGroqConfig,
  parseGroqModelsBody,
  freeCloudTurn,
  type GroqConfig,
  type GroqProvider,
} from "./freeCloud.ts";
import {
  DEFAULT_FALLBACK_TIMEOUT_MS,
  DEFAULT_LOCAL_TIMEOUT_MS,
  FALLBACK_PROVIDER_ID,
  FREE_CLOUD_PROVIDER_ID,
  MIN_PROVIDER_TIMEOUT_MS,
  RouterCancelledError,
  createDefaultProviders,
  createFallbackSlot,
  decideRoute,
  parseRouterConfig,
  probeProviders,
  routeChat,
  routerBrainNode,
  routerStatus,
  type BrainProvider,
  type ProviderAvailability,
  type RouterEnv,
} from "./router.ts";

// Nothing here is a real credential: every key is a made-up test string.
const TEST_KEY = "gsk_" + "test_" + "0".repeat(32);
const FAKE_KEY = TEST_KEY;
const BASE = "https://api.groq.com/openai/v1";
const LOCAL = "http://127.0.0.1:8788";
const NOW = Date.parse("2026-11-21T14:00:00.000Z");

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

type Call = { url: string; init?: RequestInit };

function recordingFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>): {
  fetchImpl: typeof fetch;
  calls: Call[];
} {
  const calls: Call[] = [];
  const fetchImpl = ((input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return Promise.resolve(handler(String(input), init));
  }) as typeof fetch;
  return { fetchImpl, calls };
}

function enabledConfig(over: Partial<GroqConfig> = {}): GroqConfig {
  return {
    enabled: true,
    apiKey: FAKE_KEY,
    baseUrl: BASE,
    model: GROQ_DEFAULT_MODEL,
    timeoutMs: DEFAULT_FALLBACK_TIMEOUT_MS,
    probeTimeoutMs: 500,
    ...over,
  };
}

function localHealth(ok: boolean): (url: string) => Response {
  return (url: string) =>
    url.endsWith("/v1/health") ? json({ ok, service: "bakugan-brain" }) : json({ error: "unexpected" }, 404);
}

function modelsBody(ids: string[]): unknown {
  return { object: "list", data: ids.map((id) => ({ id, object: "model", active: true })) };
}

function chatBody(text: string, extra: Record<string, unknown> = {}): unknown {
  return {
    id: "chatcmpl-test",
    object: "chat.completion",
    model: GROQ_DEFAULT_MODEL,
    choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
    usage: { prompt_tokens: 12, completion_tokens: 7 },
    ...extra,
  };
}

/**
 * A request that never settles on its own: it rejects only when its signal
 * aborts, which is exactly what a timeout or a cancellation must trigger.
 */
function neverAnswers(_url: string, init?: RequestInit): Promise<Response> {
  return new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal;
    if (signal?.aborted) {
      reject(new DOMException("aborted", "AbortError"));
      return;
    }
    signal?.addEventListener?.("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
  });
}

const fullOptIn: RouterEnv = {
  PREYAS_ROUTER: "1",
  PREYAS_ROUTER_MODE: "fallback",
  PREYAS_ROUTER_ALLOW_CLOUD: "1",
  PREYAS_FREE_CLOUD: "1",
  GROQ_API_KEY: FAKE_KEY,
};

// --- configuration -------------------------------------------------

test("an empty environment configures no cloud provider at all", () => {
  const config = parseGroqConfig({});
  assert.equal(config.enabled, false);
  assert.equal(config.error, undefined);
  assert.equal(config.apiKey, "");
  assert.equal(config.model, GROQ_DEFAULT_MODEL);
  assert.equal(config.baseUrl, GROQ_DEFAULT_BASE_URL);

  const { config: router, providers } = createConfiguredProviders({ localBaseUrl: LOCAL, env: {} });
  assert.equal(router.enabled, false);
  assert.equal(providers.length, 3);
  assert.equal(providers[1]!.demo, true);
  assert.equal(providers[2]!.demo, true);
  assert.equal(providers[2]!.id, FALLBACK_PROVIDER_ID);
});

test("missing, blank and placeholder keys leave the provider disabled, never throwing", () => {
  for (const env of [
    {},
    { GROQ_API_KEY: "" },
    { GROQ_API_KEY: "   " },
    { GROQ_API_KEY: "changeme" },
    { GROQ_API_KEY: "\"\"" },
    { GROQ_API_KEY: "your-key-here" },
  ] as RouterEnv[]) {
    const config = parseGroqConfig(env);
    assert.equal(config.enabled, false, JSON.stringify(env));
    assert.equal(config.apiKey, "", "a refused key is never carried forward");
  }

  const { config, providers } = createConfiguredProviders({
    localBaseUrl: LOCAL,
    env: { ...fullOptIn, GROQ_API_KEY: "" },
  });
  assert.equal(config.mode, "fallback-on-local-unavailable");
  assert.equal(providers[2]!.demo, true, "no key means the slot stays a placeholder");
});

test("a malformed key is an invalid configuration, not a live provider", () => {
  for (const key of ["sk-not-a-groq-key", "gsk_short", "gsk_" + "a".repeat(32) + "!", "gsk_" + "a".repeat(300)]) {
    const config = parseGroqConfig({ GROQ_API_KEY: key });
    assert.equal(config.enabled, false);
    assert.equal(config.error, GROQ_REASON.badKey);
    assert.equal(config.apiKey, "", "a refused key is dropped, not kept for a later request");
  }
});

test("invalid provider configuration is refused with a plain reason", () => {
  const cases: [RouterEnv, string][] = [
    [{ GROQ_API_KEY: FAKE_KEY, GROQ_BASE_URL: "http://api.groq.com/openai/v1" }, GROQ_REASON.badBaseUrl],
    [{ GROQ_API_KEY: FAKE_KEY, GROQ_BASE_URL: "not a url" }, GROQ_REASON.badBaseUrl],
    [{ GROQ_API_KEY: FAKE_KEY, GROQ_BASE_URL: "ftp://api.groq.com" }, GROQ_REASON.badBaseUrl],
    [{ GROQ_API_KEY: FAKE_KEY, GROQ_MODEL: "bad model!" }, GROQ_REASON.badModel],
    [{ GROQ_API_KEY: FAKE_KEY, GROQ_MODEL: "x".repeat(120) }, GROQ_REASON.badModel],
    [{ GROQ_API_KEY: FAKE_KEY, PREYAS_FREE_CLOUD_TIMEOUT_MS: "10" }, GROQ_REASON.badTimeout],
    [{ GROQ_API_KEY: FAKE_KEY, PREYAS_FREE_CLOUD_TIMEOUT_MS: "soon" }, GROQ_REASON.badTimeout],
    [{ GROQ_API_KEY: FAKE_KEY, PREYAS_FREE_CLOUD_PROBE_TIMEOUT_MS: "999999" }, GROQ_REASON.badTimeout],
  ];
  for (const [env, reason] of cases) {
    const config = parseGroqConfig(env);
    assert.equal(config.enabled, false, JSON.stringify(env));
    assert.equal(config.error, reason);
  }

  // Loopback over http is allowed for a local test server; https always is.
  assert.equal(parseGroqConfig({ GROQ_API_KEY: FAKE_KEY, GROQ_BASE_URL: "http://127.0.0.1:9999/openai/v1" }).error, undefined);
  assert.equal(parseGroqConfig({ GROQ_API_KEY: FAKE_KEY, GROQ_BASE_URL: "https://example.test/openai/v1" }).enabled, true);
});

test("the routes follow the configured base and drop a trailing slash", () => {
  assert.deepEqual(groqRoutes(BASE + "/"), {
    chat: BASE + "/chat/completions",
    models: BASE + "/models",
  });
});

// --- routing: off by default ---------------------------------------

test("router flag off keeps legacy behavior and never calls the provider", async () => {
  const { fetchImpl, calls } = recordingFetch(localHealth(true));
  // Even with every cloud flag set, the router being off wins.
  const { config, providers } = createConfiguredProviders({
    localBaseUrl: LOCAL,
    fetchImpl,
    env: {
      PREYAS_ROUTER_ALLOW_CLOUD: "1",
      PREYAS_FREE_CLOUD: "1",
      GROQ_API_KEY: FAKE_KEY,
    },
  });
  assert.equal(config.enabled, false);
  const decision = await routeChat({ config, providers });
  assert.equal(decision.kind, "legacy");
  assert.equal(decision.providerId, null);
  assert.equal(decision.cloud, false);
  assert.equal(calls.length, 0, "a flag-off router probes nothing");

  // The legacy chooser is still the only rule with every new flag unset.
  assert.deepEqual(chooseRoute({ askPaid: false, localFailed: false, paidAvailable: true, allowPaidOnFailure: false }), {
    route: "local",
    reason: "local first",
  });
  assert.deepEqual(chooseRoute({ askPaid: true, localFailed: false, paidAvailable: true, allowPaidOnFailure: false }), {
    route: "paid",
    reason: "you asked",
  });
  assert.deepEqual(chooseRoute({ askPaid: false, localFailed: true, paidAvailable: false, allowPaidOnFailure: true }), {
    route: "local",
    reason: "local first",
  });
});

test("an empty environment reproduces the legacy chat path exactly", async () => {
  const { fetchImpl, calls } = recordingFetch(localHealth(true));
  const { config, providers } = createConfiguredProviders({ localBaseUrl: LOCAL, fetchImpl, env: {} });
  const decision = await routeChat({ config, providers });
  assert.equal(decision.kind, "legacy");
  assert.equal(decision.timeoutMs, 0);
  assert.equal(calls.length, 0);
  assert.equal(providers[2]!.demo, true);
});

// --- opt-in rules ---------------------------------------------------

test("cloud use needs the router, a cloud mode, the opt-in and a key", async () => {
  const goodFetch = recordingFetch((url) =>
    url.includes("/models") ? json(modelsBody([GROQ_DEFAULT_MODEL])) : localHealth(false)(url),
  );

  // 1. Router on, cloud allowed, but no PREYAS_FREE_CLOUD: still no provider.
  const noFreeCloudFlag = createConfiguredProviders({
    localBaseUrl: LOCAL,
    fetchImpl: goodFetch.fetchImpl,
    env: { ...fullOptIn, PREYAS_FREE_CLOUD: undefined },
  });
  assert.equal(noFreeCloudFlag.providers[2]!.demo, true);
  const noFlagDecision = await routeChat({ config: noFreeCloudFlag.config, providers: noFreeCloudFlag.providers });
  assert.equal(noFlagDecision.kind, "unavailable");
  assert.equal(goodFetch.calls.filter((call) => call.url.includes("api.groq.com")).length, 0);

  // 2. Opt-in set but cloud routing not allowed: no provider is built.
  const noOptIn = createConfiguredProviders({
    localBaseUrl: LOCAL,
    fetchImpl: goodFetch.fetchImpl,
    env: { ...fullOptIn, PREYAS_ROUTER_ALLOW_CLOUD: undefined },
  });
  assert.equal(noOptIn.providers[2]!.demo, true);
  const noOptInDecision = await routeChat({ config: noOptIn.config, providers: noOptIn.providers });
  assert.equal(noOptInDecision.kind, "unavailable");
  assert.match(noOptInDecision.reason, /not opted in/);
  assert.equal(goodFetch.calls.filter((call) => call.url.includes("api.groq.com")).length, 0);

  // 3. Everything on: the fallback slot is the live provider.
  const complete = createConfiguredProviders({
    localBaseUrl: LOCAL,
    fetchImpl: goodFetch.fetchImpl,
    env: fullOptIn,
  });
  assert.equal(complete.providers[2]!.demo, false);
  assert.equal(complete.providers[2]!.id, FALLBACK_PROVIDER_ID);
  assert.equal(complete.providers[2]!.kind, "fallback");
  assert.equal(complete.providers[1]!.demo, true, "the free-cloud slot stays disabled");
  const decision = await routeChat({ config: complete.config, providers: complete.providers });
  assert.equal(decision.kind, "fallback");
  assert.equal(decision.cloud, true);
  assert.ok(goodFetch.calls.some((call) => call.url.includes("/models")));
  assert.ok(!goodFetch.calls.some((call) => call.url.includes("/chat/completions")), "routing never sends chat text");
});

test("prefer-local keeps the local model first and never leaves the Mac", async () => {
  const { fetchImpl, calls } = recordingFetch((url) =>
    url.includes("/models") ? json(modelsBody([GROQ_DEFAULT_MODEL])) : localHealth(true)(url),
  );
  const { config, providers } = createConfiguredProviders({
    localBaseUrl: LOCAL,
    fetchImpl,
    env: { ...fullOptIn, PREYAS_ROUTER_MODE: "prefer-local" },
  });
  const decision = await routeChat({ config, providers });
  assert.equal(decision.kind, "local");
  assert.equal(decision.providerId, "local");
  assert.equal(decision.cloud, false);
  assert.equal(decision.timeoutMs, DEFAULT_LOCAL_TIMEOUT_MS);
  // A healthy local model wins outright; nothing ever goes to the provider.
  const providerCalls = calls.filter((call) => call.url.includes("api.groq.com"));
  assert.equal(providerCalls.length, 1, "the fallback was health-checked, not chatted with");
  assert.ok(providerCalls[0]!.url.endsWith("/models"));
  assert.ok(!providerCalls.some((call) => call.url.includes("/chat/completions")));

  // Local down in prefer-local: unavailable, never the cloud provider.
  const down = recordingFetch((url) =>
    url.includes("/models") ? json(modelsBody([GROQ_DEFAULT_MODEL])) : localHealth(false)(url),
  );
  const downProviders = createConfiguredProviders({
    localBaseUrl: LOCAL,
    fetchImpl: down.fetchImpl,
    env: { ...fullOptIn, PREYAS_ROUTER_MODE: "prefer-local" },
  });
  const downDecision = await routeChat(downProviders);
  assert.equal(downDecision.kind, "unavailable");
  assert.equal(downDecision.cloud, false);
  assert.match(downDecision.reason, /local model is unavailable/);
  // A health check may have run, but no chat text was ever sent.
  assert.equal(down.calls.filter((call) => call.url.includes("/chat/completions")).length, 0);
});

test("fallback mode uses the cloud provider only when local is down and opt-in is complete", async () => {
  const { fetchImpl } = recordingFetch((url) =>
    url.includes("/models") ? json(modelsBody([GROQ_DEFAULT_MODEL])) : localHealth(false)(url),
  );
  const { config, providers } = createConfiguredProviders({ localBaseUrl: LOCAL, fetchImpl, env: fullOptIn });
  const decision = await routeChat({ config, providers });
  assert.equal(decision.kind, "fallback");
  assert.equal(decision.providerId, FALLBACK_PROVIDER_ID);
  assert.equal(decision.cloud, true);
  assert.equal(decision.timeoutMs, DEFAULT_FALLBACK_TIMEOUT_MS);
  assert.match(decision.reason, /opted-in/);
});

test("manual mode reaches the provider only with the cloud opt-in", async () => {
  const { fetchImpl } = recordingFetch((url) =>
    url.includes("/models") ? json(modelsBody([GROQ_DEFAULT_MODEL])) : localHealth(false)(url),
  );
  const manual = { ...fullOptIn, PREYAS_ROUTER_MODE: "manual", PREYAS_ROUTER_PROVIDER: FALLBACK_PROVIDER_ID };
  const ok = createConfiguredProviders({ localBaseUrl: LOCAL, fetchImpl, env: manual });
  const decision = await routeChat(ok);
  assert.equal(decision.kind, "fallback");
  assert.equal(decision.cloud, true);
  assert.equal(decision.providerId, FALLBACK_PROVIDER_ID);

  // Without the cloud opt-in no provider is built at all, so manual mode
  // finds only the placeholder and refuses it.
  const noOptIn = createConfiguredProviders({
    localBaseUrl: LOCAL,
    fetchImpl,
    env: { ...manual, PREYAS_ROUTER_ALLOW_CLOUD: undefined },
  });
  assert.equal(noOptIn.providers[2]!.demo, true);
  const refused = await routeChat(noOptIn);
  assert.equal(refused.kind, "unavailable");
  assert.equal(refused.cloud, false);
  assert.match(refused.reason, /not active|not opted in/);

  // With a live provider in the slot but the opt-in missing, decideRoute
  // still refuses the cloud route on its own.
  const liveButNotOptedIn = decideRoute(
    parseRouterConfig({ ...manual, PREYAS_ROUTER_ALLOW_CLOUD: undefined }),
    [
      {
        id: FALLBACK_PROVIDER_ID,
        kind: "fallback",
        label: "Free cloud (fallback)",
        enabled: true,
        demo: false,
        timeoutMs: DEFAULT_FALLBACK_TIMEOUT_MS,
        available: true,
        reason: "free cloud provider is ready",
      },
    ],
  );
  assert.equal(liveButNotOptedIn.kind, "unavailable");
  assert.match(liveButNotOptedIn.reason, /not opted in/);

  // Naming the free-cloud placeholder in manual mode is still a placeholder.
  const placeholder = createConfiguredProviders({
    localBaseUrl: LOCAL,
    fetchImpl,
    env: { ...manual, PREYAS_ROUTER_PROVIDER: FREE_CLOUD_PROVIDER_ID },
  });
  const placeholderDecision = await routeChat(placeholder);
  assert.equal(placeholderDecision.kind, "unavailable");
  assert.equal(placeholderDecision.demo, true);
  assert.match(placeholderDecision.reason, /placeholder/);
});

test("a provider that is not healthy is never presented as available", async () => {
  const { fetchImpl } = recordingFetch((url) =>
    url.includes("/models") ? json(modelsBody(["some-other-model"])) : localHealth(false)(url),
  );
  const { config, providers } = createConfiguredProviders({ localBaseUrl: LOCAL, fetchImpl, env: fullOptIn });
  const rows = await probeProviders(providers, { probeTimeoutMs: 200 });
  const fallback = rows.find((row) => row.id === FALLBACK_PROVIDER_ID)!;
  assert.equal(fallback.available, false);
  assert.equal(fallback.reason, GROQ_REASON.unknownModel);
  const decision = decideRoute(config, rows);
  assert.equal(decision.kind, "unavailable");
  assert.equal(decision.cloud, false);
});

// --- bounded requests, timeouts and cancellation --------------------

test("a provider timeout is a timeout, and maps to unavailable", async () => {
  // The probe deadline is the router's own, so it can be short.
  const probeProvider = createGroqProvider({ config: enabledConfig(), fetchImpl: recordingFetch(neverAnswers).fetchImpl });
  const probeStarted = Date.now();
  await assert.rejects(probeProvider.probe({ signal: new AbortController().signal }), (error: unknown) => {
    assert.ok(error instanceof GroqResponseError);
    assert.equal(error.code, GROQ_REASON.timedOut);
    return true;
  });
  assert.ok(Date.now() - probeStarted < 2_000, "the probe deadline really bounds the wait");

  const rows = await probeProviders([probeProvider], { probeTimeoutMs: 40 });
  assert.equal(rows[0]!.available, false);
  assert.match(rows[0]!.reason, /timed out/);
  assert.equal(decideRoute(parseRouterConfig(fullOptIn), rows).kind, "unavailable");

  // A chat timeout needs a valid provider budget (at least one second).
  const chatProvider = createGroqProvider({ config: enabledConfig({ timeoutMs: MIN_PROVIDER_TIMEOUT_MS }), fetchImpl: recordingFetch(neverAnswers).fetchImpl });
  const chatStarted = Date.now();
  const turn = await freeCloudTurn({
    provider: chatProvider,
    decision: { kind: "free-cloud", providerId: GROQ_PROVIDER_ID },
    messages: [{ role: "user", content: "hi" }],
  });
  assert.equal(turn.ok, false);
  if (!turn.ok) {
    assert.equal(turn.kind, "timeout");
    assert.equal(turn.error, GROQ_REASON.timedOut);
  }
  assert.ok(Date.now() - chatStarted < 5_000, "the chat deadline really bounds the wait");

  // A timeout below the router's floor is an invalid configuration instead.
  const tooShort = createGroqProvider({ config: enabledConfig({ timeoutMs: 40 }), fetchImpl: recordingFetch(neverAnswers).fetchImpl });
  assert.equal(tooShort.enabled, false);
  assert.equal(tooShort.timeoutMs, 0);
});

test("caller cancellation is distinct from a provider timeout", async () => {
  const { fetchImpl } = recordingFetch(neverAnswers);
  const provider = createGroqProvider({ config: enabledConfig(), fetchImpl });

  const controller = new AbortController();
  const probing = provider.probe({ signal: controller.signal });
  setTimeout(() => controller.abort(), 10);
  await assert.rejects(probing, (error: unknown) => error instanceof RouterCancelledError);

  const chatController = new AbortController();
  const chatting = provider.chat([{ role: "user", content: "hi" }], {
    signal: chatController.signal,
    timeoutMs: 5_000,
  });
  setTimeout(() => chatController.abort(), 10);
  await assert.rejects(chatting, (error: unknown) => error instanceof RouterCancelledError);

  // An already-aborted signal never starts a request.
  const already = new AbortController();
  already.abort();
  await assert.rejects(
    provider.chat([{ role: "user", content: "hi" }], { signal: already.signal, timeoutMs: 5_000 }),
    (error: unknown) => error instanceof RouterCancelledError,
  );

  // A router probe cancelled by its caller rejects instead of falling back.
  const hangingProvider = createGroqProvider({
    config: enabledConfig({ probeTimeoutMs: 5_000 }),
    fetchImpl: recordingFetch(neverAnswers).fetchImpl,
  });
  const routerController = new AbortController();
  const routed = routeChat({
    config: parseRouterConfig(fullOptIn),
    providers: [hangingProvider],
    signal: routerController.signal,
  });
  setTimeout(() => routerController.abort(), 10);
  await assert.rejects(routed, (error: unknown) => error instanceof RouterCancelledError);
});

// --- response validation -------------------------------------------

test("invalid provider responses are refused before use", async () => {
  const cases: [unknown, string][] = [
    [{ nope: true }, GROQ_REASON.badAnswer],
    [{ choices: [] }, GROQ_REASON.badAnswer],
    [{ choices: [{}] }, GROQ_REASON.badAnswer],
    [{ choices: [{ message: { content: 42 } }] }, GROQ_REASON.badAnswer],
    [{ choices: [{ message: { content: "   " } }] }, GROQ_REASON.emptyAnswer],
  ];
  for (const [body, reason] of cases) {
    assert.throws(() => parseGroqChatBody(body), (error: unknown) => {
      assert.ok(error instanceof GroqResponseError);
      return error.code === reason;
    });
  }

  const ok = parseGroqChatBody(chatBody("  Hello there  "));
  assert.equal(ok.text, "Hello there");
  assert.deepEqual(ok.usage, { prompt_tokens: 12, completion_tokens: 7 });
  assert.equal(ok.model, GROQ_DEFAULT_MODEL);

  // Usage that is not finite or negative is dropped, not trusted.
  const odd = parseGroqChatBody(chatBody("hi", { usage: { prompt_tokens: -5, completion_tokens: "x" } }));
  assert.equal(odd.usage, null);

  // A very long answer is cut, not passed through.
  const long = parseGroqChatBody(chatBody("a".repeat(10_000)));
  assert.equal(long.text.length, 4_000);

  assert.throws(() => parseGroqModelsBody({ data: "nope" }), GroqResponseError);
  assert.deepEqual(parseGroqModelsBody(modelsBody(["a", "b"])), ["a", "b"]);
  assert.deepEqual(
    parseGroqModelsBody({ data: [{ id: "a" }, { id: "gone", active: false }, { nope: 1 }] }),
    ["a"],
  );
});

test("HTTP failures map to stable reasons without leaking provider text", async () => {
  const statuses: [number, string][] = [
    [401, GROQ_REASON.unauthorized],
    [403, GROQ_REASON.unauthorized],
    [429, GROQ_REASON.rateLimited],
    [500, GROQ_REASON.refused],
    [400, GROQ_REASON.refused],
  ];
  for (const [status, reason] of statuses) {
    const { fetchImpl } = recordingFetch(() =>
      json({ error: { message: "provider says: your key sk-live-abc is wrong" } }, status, { "retry-after": "0" }),
    );
    const provider = createGroqProvider({ config: enabledConfig({ probeTimeoutMs: 100 }), fetchImpl });
    const turn = await freeCloudTurn({
      provider,
      decision: { kind: "free-cloud", providerId: GROQ_PROVIDER_ID },
      messages: [{ role: "user", content: "hi" }],
    });
    assert.equal(turn.ok, false);
    if (turn.ok) return;
    assert.equal(turn.error, reason);
    assert.equal(turn.kind, "unavailable");
    assert.ok(!turn.error.includes("sk-live"), "no provider text is passed through");
  }

  const { fetchImpl } = recordingFetch(() => new Response("<html>gateway</html>", { status: 200 }));
  const provider = createGroqProvider({ config: enabledConfig(), fetchImpl });
  const turn = await freeCloudTurn({
    provider,
    decision: { kind: "free-cloud", providerId: GROQ_PROVIDER_ID },
    messages: [{ role: "user", content: "hi" }],
  });
  assert.equal(turn.ok, false);
  if (!turn.ok) assert.equal(turn.error, GROQ_REASON.badAnswer);
});

test("a network failure is unavailable, and a redirect is never followed", async () => {
  const exploding = createGroqProvider({
    config: enabledConfig(),
    fetchImpl: (() => Promise.reject(new Error("ECONNREFUSED with a secret punchline"))) as unknown as typeof fetch,
  });
  const turn = await freeCloudTurn({
    provider: exploding,
    decision: { kind: "free-cloud", providerId: GROQ_PROVIDER_ID },
    messages: [{ role: "user", content: "hi" }],
  });
  assert.equal(turn.ok, false);
  if (!turn.ok) assert.equal(turn.error, GROQ_REASON.unreachable);

  const { fetchImpl, calls } = recordingFetch(() => json(chatBody("hi")));
  const provider = createGroqProvider({ config: enabledConfig(), fetchImpl });
  await provider.chat([{ role: "user", content: "hi" }], { timeoutMs: 500 });
  assert.equal(calls[0]!.init?.redirect, "error");
});

test("a successful chat turn carries the bounded history and the key header", async () => {
  const { fetchImpl, calls } = recordingFetch((url) =>
    url.includes("/models") ? json(modelsBody([GROQ_DEFAULT_MODEL])) : json(chatBody("  Hey, partner.  ")),
  );
  const provider: GroqProvider = createGroqProvider({ config: enabledConfig(), fetchImpl });
  const turn = await freeCloudTurn({
    provider,
    decision: { kind: "fallback", providerId: FALLBACK_PROVIDER_ID },
    messages: [{ role: "user", content: "hi" }],
  });
  // The fallback route names the slot, not the adapter: no call is made.
  assert.equal(turn.ok, false);
  assert.equal(calls.length, 0);

  const direct = await freeCloudTurn({
    provider,
    decision: { kind: "free-cloud", providerId: GROQ_PROVIDER_ID },
    messages: [
      { role: "system", content: "ignored on purpose" },
      { role: "user", content: "hi" },
    ],
  });
  assert.equal(direct.ok, true);
  if (direct.ok) assert.equal(direct.text, "Hey, partner.");
  const call = calls[0]!;
  const headers = call.init?.headers as Record<string, string>;
  assert.equal(headers.authorization, "Bearer " + FAKE_KEY);
  const sent = JSON.parse(String(call.init?.body)) as {
    model: string;
    stream: boolean;
    max_completion_tokens: number;
    messages: { role: string; content: string }[];
  };
  assert.equal(sent.model, GROQ_DEFAULT_MODEL);
  assert.equal(sent.stream, false);
  assert.equal(sent.max_completion_tokens, 512);
  assert.deepEqual(sent.messages.map((row) => row.role), ["system", "user"]);
  assert.notEqual(sent.messages[0]!.content, "ignored on purpose", "the persona, not caller text, is the system line");

  // No credential ever appears in a status the UI could draw.
  const [row] = await probeProviders([provider], { probeTimeoutMs: 200 });
  assert.equal(row!.available, true);
  assert.ok(!row!.reason.includes(FAKE_KEY));
});

test("the cloud route sees only the persona and recent turns", () => {
  const messages = [
    { role: "user" as const, content: "first" },
    { role: "assistant" as const, content: "reply one" },
    { role: "user" as const, content: "second" },
  ];
  const bounded = boundedCloudMessages(messages);
  assert.equal(bounded.filter((row) => row.role === "system").length, 1);
  assert.deepEqual(
    bounded.filter((row) => row.role !== "system").map((row) => row.content),
    ["first", "reply one", "second"],
  );
});

// --- isolation ------------------------------------------------------

test("the free cloud source holds no secret and no second provider", () => {
  const source = readFileSync(fileURLToPath(new URL("./freeCloud.ts", import.meta.url)), "utf8");
  assert.ok(!/gsk_[A-Za-z0-9]{20,}/.test(source), "no key-shaped literal is committed");
  assert.ok(!/openrouter|anthropic|generativelanguage|huggingface/i.test(source), "exactly one provider is named");
  assert.ok(source.includes("api.groq.com"), "the provider endpoint is explicit");
  assert.ok(source.includes("redirect: \"error\""), "credentials are never sent through a redirect");

  const routerSource = readFileSync(fileURLToPath(new URL("./router.ts", import.meta.url)), "utf8");
  assert.ok(!/groq|api\.groq/i.test(routerSource), "the router stays provider-agnostic");
});
