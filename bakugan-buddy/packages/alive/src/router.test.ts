/**
 * Routing foundation tests: priority, opt-in rules, placeholders, bounded
 * probes and the Brain-compatible status object. No provider calls and no
 * keys; fake providers/fetches stand in for the network.
 */
/// <reference types="node" />
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { chooseRoute } from "./chatTurn.ts";
import {
  DEFAULT_FALLBACK_TIMEOUT_MS,
  DEFAULT_LOCAL_TIMEOUT_MS,
  FALLBACK_PROVIDER_ID,
  FREE_CLOUD_PROVIDER_ID,
  RouterCancelledError,
  createDefaultProviders,
  createFallbackSlot,
  createFreeCloudSlot,
  createLocalProvider,
  decideRoute,
  parseRouterConfig,
  probeProviders,
  routeChat,
  routerBrainNode,
  routerStatus,
  type BrainProvider,
  type ProviderAvailability,
  type ProviderKind,
  type ProviderProbe,
  type RouterConfig,
} from "./router.ts";

const BASE = "http://127.0.0.1:8788";
const NOW = Date.parse("2026-11-21T07:30:00.000Z");

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

type Handler = (url: string, init?: RequestInit) => Promise<Response> | Response;

function fakeFetch(handler: Handler): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) => Promise.resolve(handler(String(input), init))) as typeof fetch;
}

function config(over: Partial<RouterConfig> = {}): RouterConfig {
  return {
    enabled: true,
    mode: "prefer-local",
    manualProviderId: null,
    allowCloudRoutes: false,
    ...over,
  };
}

function availability(
  over: Partial<ProviderAvailability> & { id: string; kind: ProviderKind },
): ProviderAvailability {
  return {
    label: over.id,
    enabled: true,
    demo: false,
    timeoutMs: DEFAULT_LOCAL_TIMEOUT_MS,
    available: true,
    reason: "ready",
    ...over,
  };
}

function fakeProvider(over: Partial<BrainProvider> & { id: string; kind: ProviderKind }): BrainProvider {
  return {
    label: over.id,
    enabled: true,
    demo: false,
    timeoutMs: DEFAULT_LOCAL_TIMEOUT_MS,
    probeTimeoutMs: 500,
    async probe(): Promise<ProviderProbe> {
      return { available: true, reason: "ready" };
    },
    ...over,
  };
}

function hangingProvider(): BrainProvider {
  return fakeProvider({
    id: "local",
    kind: "local",
    probe: ({ signal }) =>
      new Promise<ProviderProbe>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      }),
  });
}

test("the router config defaults off and reads both env prefixes", () => {
  assert.deepEqual(parseRouterConfig({}), {
    enabled: false,
    mode: "prefer-local",
    manualProviderId: null,
    allowCloudRoutes: false,
  });

  const server = parseRouterConfig({
    PREYAS_ROUTER: "1",
    PREYAS_ROUTER_MODE: "fallback",
    PREYAS_ROUTER_PROVIDER: "local",
    PREYAS_ROUTER_ALLOW_CLOUD: "1",
  });
  assert.equal(server.enabled, true);
  assert.equal(server.mode, "fallback-on-local-unavailable");
  assert.equal(server.manualProviderId, "local");
  assert.equal(server.allowCloudRoutes, true);
  assert.equal(server.error, undefined);

  const app = parseRouterConfig({
    EXPO_PUBLIC_PREYAS_ROUTER: "true",
    EXPO_PUBLIC_PREYAS_ROUTER_MODE: "manual",
    EXPO_PUBLIC_PREYAS_ROUTER_PROVIDER: FREE_CLOUD_PROVIDER_ID,
    EXPO_PUBLIC_PREYAS_ROUTER_ALLOW_CLOUD: "yes",
  });
  assert.equal(app.enabled, true);
  assert.equal(app.mode, "manual");
  assert.equal(app.manualProviderId, FREE_CLOUD_PROVIDER_ID);
  assert.equal(app.allowCloudRoutes, true);

  assert.equal(parseRouterConfig({ PREYAS_ROUTER: "0" }).enabled, false);
  assert.equal(parseRouterConfig({ PREYAS_ROUTER: "false" }).enabled, false);
});

test("the flag-off router leaves the existing chat path exactly alone", async () => {
  let probes = 0;
  const providers = [
    fakeProvider({
      id: "local",
      kind: "local",
      probe: async () => {
        probes += 1;
        return { available: true, reason: "ready" };
      },
    }),
  ];
  const decision = await routeChat({ config: parseRouterConfig({}), providers });

  assert.equal(decision.kind, "legacy");
  assert.equal(decision.providerId, null);
  assert.equal(decision.providerLabel, "Existing chat path");
  assert.equal(decision.timeoutMs, 0);
  assert.equal(decision.cloud, false);
  assert.equal(probes, 0);

  // The existing route chooser is still the only rule in the chat path.
  assert.deepEqual(
    chooseRoute({ askPaid: false, localFailed: false, paidAvailable: true, allowPaidOnFailure: false }),
    { route: "local", reason: "local first" },
  );
  assert.equal(
    chooseRoute({ askPaid: true, localFailed: false, paidAvailable: true, allowPaidOnFailure: false }).route,
    "paid",
  );
});

test("the flag-off router makes no network calls at all", async () => {
  let calls = 0;
  const local = createLocalProvider({
    baseUrl: BASE,
    fetchImpl: fakeFetch(() => {
      calls += 1;
      return response({ ok: true, service: "bakugan-brain" });
    }),
  });
  const decision = await routeChat({
    config: parseRouterConfig({}),
    providers: [local, createFreeCloudSlot(), createFallbackSlot()],
  });
  assert.equal(decision.kind, "legacy");
  assert.equal(calls, 0);
});

test("prefer-local picks the healthy local model", async () => {
  const decision = await routeChat({
    config: config(),
    providers: [fakeProvider({ id: "local", kind: "local" })],
  });

  assert.equal(decision.kind, "local");
  assert.equal(decision.providerId, "local");
  assert.equal(decision.providerLabel, "local");
  assert.equal(decision.timeoutMs, DEFAULT_LOCAL_TIMEOUT_MS);
  assert.equal(decision.cloud, false);
  assert.equal(decision.demo, false);
  assert.match(decision.reason, /local model is available/);
});

test("a real local health answer routes to local, and a cold model does not", async () => {
  const localUp = createLocalProvider({
    baseUrl: BASE,
    fetchImpl: fakeFetch(() => response({ ok: true, service: "bakugan-brain" })),
  });
  const up = await routeChat({ config: config(), providers: [localUp, createFreeCloudSlot()] });
  assert.equal(up.kind, "local");
  assert.equal(up.providerId, "local");

  const localCold = createLocalProvider({
    baseUrl: BASE,
    fetchImpl: fakeFetch(() => response({ ok: false, service: "bakugan-brain" })),
  });
  const cold = await routeChat({ config: config(), providers: [localCold, createFreeCloudSlot()] });
  assert.equal(cold.kind, "unavailable");
  assert.match(cold.reason, /not ready/);
});

test("a healthy local model wins over an opted-in fallback", async () => {
  const decision = await routeChat({
    config: config({ mode: "fallback-on-local-unavailable", allowCloudRoutes: true }),
    providers: [
      fakeProvider({ id: "local", kind: "local" }),
      fakeProvider({ id: "fallback", kind: "fallback", timeoutMs: DEFAULT_FALLBACK_TIMEOUT_MS }),
    ],
  });
  assert.equal(decision.kind, "local");
  assert.equal(decision.providerId, "local");
});

test("prefer-local never silently leaves the Mac", async () => {
  const decision = await routeChat({
    config: config({ allowCloudRoutes: true }),
    providers: [
      fakeProvider({ id: "local", kind: "local", probe: async () => ({ available: false, reason: "down" }) }),
      fakeProvider({ id: "fallback", kind: "fallback" }),
      fakeProvider({ id: "free-cloud", kind: "free-cloud" }),
    ],
  });
  assert.equal(decision.kind, "unavailable");
  assert.equal(decision.cloud, false);
  assert.match(decision.reason, /prefer-local|local model is unavailable/);
});

test("fallback-on-local-unavailable needs opt-in and a dedicated fallback", async () => {
  const providers = [
    fakeProvider({ id: "local", kind: "local", probe: async () => ({ available: false, reason: "down" }) }),
    fakeProvider({ id: "fallback", kind: "fallback", timeoutMs: DEFAULT_FALLBACK_TIMEOUT_MS }),
    fakeProvider({ id: "free-cloud", kind: "free-cloud" }),
  ];

  const noOptIn = await routeChat({
    config: config({ mode: "fallback-on-local-unavailable" }),
    providers,
  });
  assert.equal(noOptIn.kind, "unavailable");
  assert.match(noOptIn.reason, /not opted in/);

  const withOptIn = await routeChat({
    config: config({ mode: "fallback-on-local-unavailable", allowCloudRoutes: true }),
    providers,
  });
  assert.equal(withOptIn.kind, "fallback");
  assert.equal(withOptIn.providerId, "fallback");
  assert.equal(withOptIn.cloud, true);
  assert.equal(withOptIn.timeoutMs, DEFAULT_FALLBACK_TIMEOUT_MS);

  const freeCloudOnly = await routeChat({
    config: config({ mode: "fallback-on-local-unavailable", allowCloudRoutes: true }),
    providers: [
      fakeProvider({ id: "local", kind: "local", probe: async () => ({ available: false, reason: "down" }) }),
      fakeProvider({ id: "free-cloud", kind: "free-cloud" }),
    ],
  });
  assert.equal(freeCloudOnly.kind, "unavailable");
  assert.match(freeCloudOnly.reason, /no fallback provider/);
});

test("manual selection is exact and still respects cloud opt-in", async () => {
  const providers = [
    fakeProvider({ id: "local", kind: "local" }),
    fakeProvider({ id: "free-cloud", kind: "free-cloud" }),
  ];

  const local = await routeChat({
    config: config({ mode: "manual", manualProviderId: "local" }),
    providers,
  });
  assert.equal(local.kind, "local");

  const noOptIn = await routeChat({
    config: config({ mode: "manual", manualProviderId: "free-cloud" }),
    providers,
  });
  assert.equal(noOptIn.kind, "unavailable");
  assert.match(noOptIn.reason, /not opted in/);

  const cloud = await routeChat({
    config: config({ mode: "manual", manualProviderId: "free-cloud", allowCloudRoutes: true }),
    providers,
  });
  assert.equal(cloud.kind, "free-cloud");
  assert.equal(cloud.providerId, "free-cloud");
  assert.equal(cloud.cloud, true);

  const unknown = await routeChat({
    config: config({ mode: "manual", manualProviderId: "missing" }),
    providers,
  });
  assert.equal(unknown.kind, "unavailable");
  assert.match(unknown.reason, /not configured/);
});

test("demo free-cloud and fallback slots never become live routes", async () => {
  const slots = [createFreeCloudSlot(), createFallbackSlot()];
  for (const slot of slots) {
    assert.equal(slot.enabled, false);
    assert.equal(slot.demo, true);
  }

  const probed = await probeProviders(slots);
  assert.deepEqual(
    probed.map((row) => row.id),
    [FREE_CLOUD_PROVIDER_ID, FALLBACK_PROVIDER_ID],
  );
  for (const row of probed) {
    assert.equal(row.available, false);
    assert.equal(row.demo, true);
  }

  const demoConfig = config({
    mode: "manual",
    manualProviderId: FREE_CLOUD_PROVIDER_ID,
    allowCloudRoutes: true,
  });
  const decision = await routeChat({ config: demoConfig, providers: slots });
  assert.equal(decision.kind, "unavailable");
  assert.equal(decision.demo, true);
  assert.match(decision.reason, /placeholder/);

  const node = routerBrainNode(routerStatus(decision, demoConfig, { now: () => NOW }));
  assert.equal(node.status, "planned");
  assert.equal(node.live, false);
  assert.notEqual(node.status, "online");
  assert.match(node.statusNote, /Placeholder/);
});

test("a timed-out provider is unavailable, not routed", async () => {
  const rows = await probeProviders([hangingProvider()], { probeTimeoutMs: 20 });
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.available, false);
  assert.match(rows[0]!.reason, /timed out/);
  assert.equal(decideRoute(config(), rows).kind, "unavailable");
});

test("cancelling a probe rejects instead of falling back", async () => {
  const controller = new AbortController();
  const reading = probeProviders([hangingProvider()], { signal: controller.signal, probeTimeoutMs: 5_000 });
  setTimeout(() => controller.abort(), 10);
  await assert.rejects(
    reading,
    (error: unknown) => error instanceof RouterCancelledError,
  );

  const already = new AbortController();
  already.abort();
  let probed = false;
  const provider = fakeProvider({
    id: "local",
    kind: "local",
    probe: async () => {
      probed = true;
      return { available: true, reason: "ready" };
    },
  });
  await assert.rejects(
    probeProviders([provider], { signal: already.signal }),
    (error: unknown) => error instanceof RouterCancelledError,
  );
  assert.equal(probed, false);

  const routed = routeChat({
    config: config(),
    providers: [provider],
    signal: already.signal,
  });
  await assert.rejects(routed, (error: unknown) => error instanceof RouterCancelledError);
  assert.equal(probed, false);
});

test("invalid config or probe answers become unavailable, not a route", async () => {
  const invalidMode = parseRouterConfig({ PREYAS_ROUTER: "1", PREYAS_ROUTER_MODE: "best" });
  assert.match(invalidMode.error || "", /unknown router mode/);
  let probes = 0;
  const badConfig = await routeChat({
    config: invalidMode,
    providers: [
      fakeProvider({
        id: "local",
        kind: "local",
        probe: async () => {
          probes += 1;
          return { available: true, reason: "ready" };
        },
      }),
    ],
  });
  assert.equal(badConfig.kind, "unavailable");
  assert.equal(probes, 0);

  const manualMissing = parseRouterConfig({ PREYAS_ROUTER: "1", PREYAS_ROUTER_MODE: "manual" });
  assert.match(manualMissing.error || "", /needs a provider id/);

  const invalidAnswer = fakeProvider({
    id: "local",
    kind: "local",
    probe: async () => ({ available: "yes" }) as unknown as ProviderProbe,
  });
  const [invalidRow] = await probeProviders([invalidAnswer]);
  assert.equal(invalidRow!.available, false);
  assert.match(invalidRow!.reason, /invalid/);

  const badTimeout = fakeProvider({ id: "local", kind: "local", timeoutMs: 0 });
  const [timeoutRow] = await probeProviders([badTimeout]);
  assert.equal(timeoutRow!.available, false);
  assert.match(timeoutRow!.reason, /timeout setting/);
  assert.equal(decideRoute(config(), [timeoutRow!]).kind, "unavailable");
});

test("the local adapter maps real health answers without a chat call", async () => {
  const up = createLocalProvider({
    baseUrl: BASE + "/",
    fetchImpl: fakeFetch(() => response({ ok: true, service: "bakugan-brain" })),
  });
  const [upRow] = await probeProviders([up]);
  assert.equal(upRow!.available, true);
  assert.equal(upRow!.timeoutMs, DEFAULT_LOCAL_TIMEOUT_MS);
  assert.match(upRow!.reason, /ready/);

  const cold = createLocalProvider({
    baseUrl: BASE,
    fetchImpl: fakeFetch(() => response({ ok: false, service: "bakugan-brain" })),
  });
  const [coldRow] = await probeProviders([cold]);
  assert.equal(coldRow!.available, false);
  assert.match(coldRow!.reason, /not ready/);

  const wrongService = createLocalProvider({
    baseUrl: BASE,
    fetchImpl: fakeFetch(() => response({ ok: true, service: "other-app" })),
  });
  const [wrongRow] = await probeProviders([wrongService]);
  assert.equal(wrongRow!.available, false);
  assert.match(wrongRow!.reason, /another service/);

  const notJson = createLocalProvider({
    baseUrl: BASE,
    fetchImpl: fakeFetch(() => new Response("<html>hello</html>", { status: 200 })),
  });
  const [notJsonRow] = await probeProviders([notJson]);
  assert.equal(notJsonRow!.available, false);
  assert.match(notJsonRow!.reason, /not JSON/);

  const unpaired = createLocalProvider({
    baseUrl: BASE,
    fetchImpl: fakeFetch(() => response({ error: "pair" }, 401)),
  });
  const [unpairedRow] = await probeProviders([unpaired]);
  assert.equal(unpairedRow!.available, false);
  assert.match(unpairedRow!.reason, /pairing/);
});

test("the router status maps onto the Brain router node without a live claim", () => {
  const liveConfig = config();
  const liveDecision = decideRoute(liveConfig, [availability({ id: "local", kind: "local" })]);
  const liveStatus = routerStatus(liveDecision, liveConfig, { now: () => NOW });
  assert.equal(liveStatus.route, "local");
  assert.equal(liveStatus.checkedAt, new Date(NOW).toISOString());
  assert.equal(liveStatus.demo, false);

  const liveNode = routerBrainNode(liveStatus);
  assert.equal(liveNode.id, "router");
  assert.equal(liveNode.name, "Router");
  assert.equal(liveNode.status, "online");
  assert.equal(liveNode.live, true);
  assert.match(liveNode.statusNote, /local/);

  const offConfig = parseRouterConfig({});
  const offDecision = decideRoute(offConfig, []);
  const offStatus = routerStatus(offDecision, offConfig, { now: () => NOW });
  assert.equal(offStatus.checkedAt, null);
  const offNode = routerBrainNode(offStatus);
  assert.equal(offNode.status, "planned");
  assert.equal(offNode.live, false);
  assert.match(offNode.statusNote, /Routing is off/);

  const down = decideRoute(config(), [availability({ id: "local", kind: "local", available: false, reason: "down" })]);
  const downNode = routerBrainNode(routerStatus(down, config(), { now: () => NOW }));
  assert.equal(downNode.status, "unavailable");
  assert.equal(downNode.live, false);
});

test("default providers are one local adapter and two inactive slots", () => {
  const providers = createDefaultProviders({ localBaseUrl: BASE });
  assert.deepEqual(
    providers.map((provider) => provider.id),
    ["local", FREE_CLOUD_PROVIDER_ID, FALLBACK_PROVIDER_ID],
  );
  assert.equal(providers[0]!.enabled, true);
  assert.equal(providers[1]!.enabled, false);
  assert.equal(providers[2]!.enabled, false);
  assert.equal(providers[1]!.demo, true);
  assert.equal(providers[2]!.demo, true);
});

test("the router source holds no keys and no cloud endpoint", () => {
  const source = readFileSync(fileURLToPath(new URL("./router.ts", import.meta.url)), "utf8");
  assert.ok(!/api[_-]?key|authorization|bearer|secret/i.test(source), "the router must not hold a credential");
  assert.ok(
    !/openai|anthropic|openrouter|generativelanguage|googleapis|api\.groq/i.test(source),
    "the router must not name a cloud endpoint",
  );
  assert.ok(source.includes("/v1/health"), "the only HTTP route is the local health probe");
  assert.ok(!source.includes("/v1/chat/completions"), "the foundation must not call chat");
});
