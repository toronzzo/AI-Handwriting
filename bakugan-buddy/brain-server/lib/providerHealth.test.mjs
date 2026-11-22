/**
 * Provider health block for GET /v1/health: local, Groq free-cloud, paid
 * fallback. Pure node tests with fake fetches — no live llama or Groq.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { GROQ_LABEL, GROQ_REASON } from "../../packages/alive/src/freeCloud.ts";
import {
  HEALTH_FREE_ID,
  HEALTH_LOCAL_ID,
  HEALTH_PAID_ID,
  PAID_REASON,
  collectProviderHealth,
  freeProviderStatus,
  healthPayloadHasSecrets,
  mergeProviderEnv,
  providerEnvFromSources,
  paidProviderStatus,
  parseEnvText,
  providerRow,
  sanitizeReason,
} from "./providerHealth.mjs";

const CHECKED = "2026-11-21T13:00:00.000Z";
const GOOD_KEY = "gsk_testdeadbeef0123456789abcdef";
const SECRET_KEY = "gsk_live_should_never_leak_abc12345";

function response(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function modelsOk(ids = ["llama-3.1-8b-instant"]) {
  return response({ data: ids.map((id) => ({ id, active: true })) });
}

function fakeFetch(handler) {
  return (input, init) => Promise.resolve(handler(String(input), init));
}

function hangingFetch() {
  return (_input, init) =>
    new Promise((_resolve, reject) => {
      const abort = () => reject(new DOMException("Aborted", "AbortError"));
      if (init?.signal?.aborted) return abort();
      init?.signal?.addEventListener("abort", abort);
    });
}

test("local healthy reports configured and available without a network call", async () => {
  let calls = 0;
  const rows = await collectProviderHealth({
    localOnline: true,
    env: {},
    envText: "",
    fetchImpl: fakeFetch(() => {
      calls += 1;
      return response({ ok: false }, 500);
    }),
    now: () => CHECKED,
  });
  const local = rows.find((row) => row.id === HEALTH_LOCAL_ID);
  assert.ok(local);
  assert.equal(local.configured, true);
  assert.equal(local.available, true);
  assert.match(local.reason, /ready/);
  assert.equal(local.checkedAt, CHECKED);
  assert.equal(calls, 0, "unconfigured cloud providers must not be probed");
});

test("Groq with a real key and a healthy models probe is configured and available", async () => {
  const seen = [];
  const row = await freeProviderStatus({
    env: { GROQ_API_KEY: GOOD_KEY },
    fetchImpl: fakeFetch((url) => {
      seen.push(url);
      return modelsOk();
    }),
    checkedAt: CHECKED,
  });
  assert.equal(row.id, HEALTH_FREE_ID);
  assert.equal(row.label, GROQ_LABEL);
  assert.equal(row.configured, true);
  assert.equal(row.available, true);
  assert.equal(row.reason, GROQ_REASON.ready);
  assert.ok(seen.some((url) => url.includes("/models")));
  assert.ok(!seen.some((url) => url.includes("/chat/completions")), "health must not send chat");
  assert.ok(!JSON.stringify(row).includes(GOOD_KEY));
});

test("Groq missing key is not configured and is not probed", async () => {
  let calls = 0;
  const row = await freeProviderStatus({
    env: {},
    fetchImpl: fakeFetch(() => {
      calls += 1;
      return modelsOk();
    }),
    checkedAt: CHECKED,
  });
  assert.equal(row.configured, false);
  assert.equal(row.available, false);
  assert.equal(row.reason, GROQ_REASON.noKey);
  assert.equal(calls, 0);
});

test("Groq placeholder key is not configured and is not probed", async () => {
  let calls = 0;
  const row = await freeProviderStatus({
    env: { GROQ_API_KEY: "changeme" },
    fetchImpl: fakeFetch(() => {
      calls += 1;
      return modelsOk();
    }),
    checkedAt: CHECKED,
  });
  assert.equal(row.configured, false);
  assert.equal(row.available, false);
  assert.equal(row.reason, GROQ_REASON.placeholderKey);
  assert.equal(calls, 0);
});

test("Groq configured but unreachable is unavailable with a stable reason", async () => {
  const row = await freeProviderStatus({
    env: { GROQ_API_KEY: GOOD_KEY },
    fetchImpl: fakeFetch(() => response({ error: { message: "quota exploded sk-live-abc" } }, 503)),
    checkedAt: CHECKED,
  });
  assert.equal(row.configured, true);
  assert.equal(row.available, false);
  assert.equal(row.reason, GROQ_REASON.refused);
  assert.ok(!row.reason.includes("quota"));
  assert.ok(!row.reason.includes("sk-live"));
});

test("Groq probe timeout is a distinct unavailable reason", async () => {
  const started = Date.now();
  const row = await freeProviderStatus({
    env: { GROQ_API_KEY: GOOD_KEY },
    fetchImpl: hangingFetch(),
    checkedAt: CHECKED,
    probeTimeoutMs: 40,
  });
  assert.equal(row.configured, true);
  assert.equal(row.available, false);
  assert.equal(row.reason, GROQ_REASON.timedOut);
  assert.ok(Date.now() - started < 2_000, "timeout must bound the probe");
});

test("paid fallback missing key is not configured and skips the gateway", async () => {
  let calls = 0;
  const row = await paidProviderStatus({
    envText: "DEEPSEEK_OFF_PEAK_ONLY=1\n",
    fetchImpl: fakeFetch(() => {
      calls += 1;
      return response({ data: [] });
    }),
    checkedAt: CHECKED,
  });
  assert.equal(row.id, HEALTH_PAID_ID);
  assert.equal(row.configured, false);
  assert.equal(row.available, false);
  assert.equal(row.reason, PAID_REASON.noKey);
  assert.equal(calls, 0);
});

test("paid fallback with a key and a live gateway is available", async () => {
  const row = await paidProviderStatus({
    envText: "DEEPSEEK_API_KEY=sk-test-secret-value\n",
    fetchImpl: fakeFetch(() => response({ data: [] })),
    checkedAt: CHECKED,
  });
  assert.equal(row.configured, true);
  assert.equal(row.available, true);
  assert.equal(row.reason, PAID_REASON.ready);
  assert.ok(!JSON.stringify(row).includes("sk-test-secret"));
});

test("health responses never echo raw secrets", async () => {
  const rows = await collectProviderHealth({
    localOnline: true,
    env: { GROQ_API_KEY: SECRET_KEY },
    envText: `DEEPSEEK_API_KEY=${SECRET_KEY}\nGROQ_API_KEY=${SECRET_KEY}\n`,
    fetchImpl: fakeFetch((url) => {
      if (url.includes("groq") || url.includes("/models")) {
        return modelsOk();
      }
      return response({ data: [] });
    }),
    now: () => CHECKED,
  });
  const payload = {
    ok: true,
    service: "bakugan-brain",
    model: "preyas",
    warn: false,
    llama: "http://127.0.0.1:8790",
    providers: rows,
  };
  assert.equal(healthPayloadHasSecrets(payload, [SECRET_KEY]), false);
  assert.ok(!JSON.stringify(payload).includes(SECRET_KEY));
  assert.ok(!JSON.stringify(payload).includes("gsk_live_should_never"));
});

test("existing health clients stay compatible: ok/service remain load-bearing", async () => {
  const providers = await collectProviderHealth({
    localOnline: false,
    env: {},
    envText: "",
    fetchImpl: fakeFetch(() => response({})),
    now: () => CHECKED,
  });
  const classic = {
    ok: false,
    service: "bakugan-brain",
    model: "preyas",
    warn: false,
    llama: "http://127.0.0.1:8790",
    providers,
  };
  assert.equal(typeof classic.ok, "boolean");
  assert.equal(classic.service, "bakugan-brain");
  assert.ok(Array.isArray(classic.providers));
  assert.equal(classic.providers.length, 3);
  assert.deepEqual(
    classic.providers.map((row) => row.id),
    [HEALTH_LOCAL_ID, HEALTH_FREE_ID, HEALTH_PAID_ID],
  );
});

test("sanitizeReason strips credential-shaped tokens", () => {
  assert.equal(sanitizeReason(`boom ${SECRET_KEY} done`), "boom [redacted] done");
  assert.equal(providerRow({ id: "x", label: "X", configured: false, available: true, reason: "no" }).available, false);
});

test("parseEnvText and mergeProviderEnv keep process overrides", () => {
  const file = parseEnvText("GROQ_API_KEY=from-file\nDEEPSEEK_API_KEY=file-key\n");
  const merged = mergeProviderEnv({ GROQ_API_KEY: "from-process" }, file);
  assert.equal(merged.GROQ_API_KEY, "from-process");
  assert.equal(merged.DEEPSEEK_API_KEY, "file-key");
  assert.equal(parseEnvText("export GROQ_API_KEY = gsk_spacedkey123 # note\n").GROQ_API_KEY, "gsk_spacedkey123");
  const rescued = providerEnvFromSources({
    processEnv: { GROQ_API_KEY: "changeme" },
    texts: ["GROQ_API_KEY=gsk_frombrain\n", "GROQ_API_KEY=gsk_fromsecrets\n"],
  });
  assert.equal(rescued.GROQ_API_KEY, "gsk_fromsecrets");
});

test("caller cancellation rejects instead of inventing a provider failure", async () => {
  const controller = new AbortController();
  const pending = freeProviderStatus({
    env: { GROQ_API_KEY: GOOD_KEY },
    fetchImpl: hangingFetch(),
    signal: controller.signal,
    probeTimeoutMs: 5_000,
    checkedAt: CHECKED,
  });
  controller.abort();
  await assert.rejects(pending);
});
