/**
 * Live Brain status tests: the health read, the honest fallback maps and the
 * source-shape rules. Pure node with no react-native import, so it runs under
 * `node --test`.
 */
/// <reference types="node" />
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { DEMO_BRAIN_MAP } from "./demoBrains.ts";
import { STATUS_LABEL, STATUS_TOKEN } from "./brainGeometry.ts";
import {
  BRAIN_POLL_MS,
  BRAIN_TIMEOUT_MS,
  BrainLiveError,
  LOCAL_MODEL_ID,
  ROUTER_ID,
  brainSourceLine,
  checkedTimeLabel,
  createLiveBrainSource,
  fetchLiveBrainMap,
  loadingBrainMap,
  mapHealth,
  offlineBrainMap,
  staleBrainMap,
} from "./liveBrain.ts";
import type { BrainMap } from "./types.ts";

const BASE = "http://127.0.0.1:8788";
const CHECKED = "2026-11-21T07:12:00.000Z";

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

function hangingFetch(): typeof fetch {
  return ((_input: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      const abort = () => reject(new DOMException("Aborted", "AbortError"));
      if (init?.signal?.aborted) {
        abort();
        return;
      }
      init?.signal?.addEventListener("abort", abort);
    })) as typeof fetch;
}

function findNode(map: BrainMap, id: string) {
  const found = map.nodes.find((item) => item.id === id);
  assert.ok(found, `node ${id} missing from the map`);
  return found;
}

test("a healthy Mac reports the local model and the router online", async () => {
  const seen: string[] = [];
  const map = await fetchLiveBrainMap({
    baseUrl: BASE,
    fetchImpl: fakeFetch((url) => {
      seen.push(url);
      return response({ ok: true, service: "bakugan-brain", model: "preyas", warn: false, llama: "http://127.0.0.1:8790" });
    }),
    now: () => Date.parse(CHECKED),
  });

  assert.deepEqual(seen, [BASE + "/v1/health"]);
  assert.equal(map.mode, "live");
  assert.equal(map.isDemo, false);
  assert.equal(map.checkedAt, CHECKED);
  assert.equal(findNode(map, LOCAL_MODEL_ID).status, "online");
  assert.equal(findNode(map, LOCAL_MODEL_ID).live, true);
  assert.match(findNode(map, LOCAL_MODEL_ID).statusNote || "", /8790/);
  assert.equal(findNode(map, ROUTER_ID).status, "online");
  assert.equal(findNode(map, ROUTER_ID).live, true);
  assert.match(map.note, /Live/);
});

test("a reachable router still reports online when the local model is cold", async () => {
  const map = await fetchLiveBrainMap({
    baseUrl: BASE,
    fetchImpl: fakeFetch(() => response({ ok: false, service: "bakugan-brain", model: "preyas" })),
    now: () => Date.parse(CHECKED),
  });

  assert.equal(map.mode, "live");
  assert.equal(map.isDemo, false);
  assert.equal(findNode(map, LOCAL_MODEL_ID).status, "offline");
  assert.equal(findNode(map, ROUTER_ID).status, "online");
  assert.match(findNode(map, LOCAL_MODEL_ID).statusNote || "", /down or still loading/);
  assert.match(map.note, /local model is offline/);
});

test("a missing Mac falls back to demo data without a false online claim", async () => {
  const source = createLiveBrainSource({
    baseUrl: BASE,
    fetchImpl: fakeFetch(() => {
      throw new TypeError("Failed to fetch");
    }),
    now: () => Date.parse(CHECKED),
  });

  assert.equal(source.get().mode, "loading");
  const map = await source.refresh();

  assert.equal(map.mode, "offline");
  assert.equal(map.isDemo, true);
  assert.equal(map.checkedAt, null);
  assert.equal(findNode(map, LOCAL_MODEL_ID).status, "unavailable");
  assert.equal(findNode(map, ROUTER_ID).status, "unavailable");
  for (const node of map.nodes) {
    assert.notEqual(node.status, "online", `${node.id} must not claim to be online`);
  }
  assert.match(map.note, /unavailable/i);
  assert.equal(source.get(), map);
});

test("a raw read failure is typed, not guessed", async () => {
  await assert.rejects(
    fetchLiveBrainMap({
      baseUrl: BASE,
      fetchImpl: fakeFetch(() => {
        throw new TypeError("Failed to fetch");
      }),
    }),
    (error: unknown) => error instanceof BrainLiveError && error.code === "unreachable",
  );
});

test("invalid or unexpected health answers are rejected", async () => {
  const cases: { name: string; fetchImpl: typeof fetch; code: string }[] = [
    { name: "not an object", fetchImpl: fakeFetch(() => response(["ok", true])), code: "bad-response" },
    { name: "missing ok", fetchImpl: fakeFetch(() => response({ service: "bakugan-brain" })), code: "bad-response" },
    { name: "string ok", fetchImpl: fakeFetch(() => response({ ok: "yes" })), code: "bad-response" },
    { name: "another service", fetchImpl: fakeFetch(() => response({ ok: true, service: "some-other-app" })), code: "bad-response" },
    { name: "not JSON", fetchImpl: fakeFetch(() => new Response("<html>hello</html>", { status: 200 })), code: "bad-response" },
    { name: "server error", fetchImpl: fakeFetch(() => response({ ok: true }, 500)), code: "unreachable" },
    { name: "unpaired phone", fetchImpl: fakeFetch(() => response({ error: "pair" }, 401)), code: "unauthorized" },
  ];

  for (const item of cases) {
    await assert.rejects(
      fetchLiveBrainMap({ baseUrl: BASE, fetchImpl: item.fetchImpl }),
      (error: unknown) => error instanceof BrainLiveError && error.code === item.code,
      item.name,
    );
  }

  const source = createLiveBrainSource({
    baseUrl: BASE,
    fetchImpl: fakeFetch(() => response({ ok: "yes" })),
  });
  const map = await source.refresh();
  assert.equal(map.mode, "offline");
  assert.match(map.note, /did not expect/);
});

test("a slow health read is bounded by its timeout", async () => {
  const started = Date.now();
  await assert.rejects(
    fetchLiveBrainMap({ baseUrl: BASE, fetchImpl: hangingFetch(), timeoutMs: 25 }),
    (error: unknown) => error instanceof BrainLiveError && error.code === "timeout",
  );
  assert.ok(Date.now() - started < 2_000, "the timeout did not bound the read");
});

test("an external abort cancels the read", async () => {
  const controller = new AbortController();
  const reading = fetchLiveBrainMap({
    baseUrl: BASE,
    fetchImpl: hangingFetch(),
    timeoutMs: 5_000,
    signal: controller.signal,
  });
  setTimeout(() => controller.abort(), 10);
  await assert.rejects(
    reading,
    (error: unknown) => error instanceof BrainLiveError && error.code === "cancelled",
  );
});

test("an already-aborted signal never calls fetch", async () => {
  const controller = new AbortController();
  controller.abort();
  let called = false;
  await assert.rejects(
    fetchLiveBrainMap({
      baseUrl: BASE,
      fetchImpl: fakeFetch(() => {
        called = true;
        return response({ ok: true });
      }),
      signal: controller.signal,
    }),
    (error: unknown) => error instanceof BrainLiveError && error.code === "cancelled",
  );
  assert.equal(called, false);
});

test("the static demo map keeps its marker and note", () => {
  assert.equal(DEMO_BRAIN_MAP.isDemo, true);
  assert.equal(DEMO_BRAIN_MAP.mode, "demo");
  assert.equal(DEMO_BRAIN_MAP.checkedAt, null);
  assert.match(DEMO_BRAIN_MAP.note, /Demo data/);
  assert.equal(DEMO_BRAIN_MAP.nodes.length, 6);
});

test("the loading map checks only the two probed nodes", () => {
  const map = loadingBrainMap();
  assert.equal(map.mode, "loading");
  assert.equal(map.isDemo, true);
  assert.equal(findNode(map, LOCAL_MODEL_ID).status, "checking");
  assert.equal(findNode(map, ROUTER_ID).status, "checking");
  for (const node of map.nodes) {
    if (node.id === LOCAL_MODEL_ID || node.id === ROUTER_ID) continue;
    assert.equal(node.status, DEMO_BRAIN_MAP.nodes.find((item) => item.id === node.id)?.status);
  }
});

test("an offline map keeps the demo descriptions and only drops the probed claims", () => {
  const map = offlineBrainMap("timeout");
  assert.equal(map.mode, "offline");
  assert.equal(map.isDemo, true);
  assert.deepEqual(
    map.nodes.map((node) => node.description),
    DEMO_BRAIN_MAP.nodes.map((node) => node.description),
  );
  for (const node of map.nodes) {
    assert.notEqual(node.status, "online", `${node.id} must not claim to be online`);
  }
  assert.equal(findNode(map, LOCAL_MODEL_ID).status, "unavailable");
  assert.equal(findNode(map, ROUTER_ID).status, "unavailable");
  assert.match(findNode(map, LOCAL_MODEL_ID).statusNote || "", /No live reading/);
});

test("a later failure keeps the last live reading but marks it stale", async () => {
  let down = false;
  const source = createLiveBrainSource({
    baseUrl: BASE,
    fetchImpl: fakeFetch(() => {
      if (down) throw new TypeError("Failed to fetch");
      return response({ ok: true, service: "bakugan-brain" });
    }),
    now: () => Date.parse(CHECKED),
  });

  const live = await source.refresh();
  assert.equal(live.mode, "live");
  down = true;
  const stale = await source.refresh();

  assert.equal(stale.mode, "stale");
  assert.equal(stale.isDemo, false);
  assert.equal(stale.checkedAt, CHECKED);
  assert.equal(findNode(stale, LOCAL_MODEL_ID).status, "online");
  assert.match(stale.note, /last status/);
  assert.equal(source.get().mode, "stale");
});

test("status mapping stays plain and never uses a danger token", () => {
  assert.equal(STATUS_LABEL.offline, "Offline");
  assert.equal(STATUS_LABEL.checking, "Checking");
  assert.equal(STATUS_TOKEN.offline, "off");
  for (const token of Object.values(STATUS_TOKEN)) {
    assert.notEqual(token, "danger");
  }
});

test("the detail panel explains live, static and demo statuses", () => {
  const live = mapHealth({ ok: true, service: "bakugan-brain" }, CHECKED);
  assert.match(brainSourceLine(live, findNode(live, LOCAL_MODEL_ID)), /Live reading/);
  assert.match(brainSourceLine(live, findNode(live, "drawing")), /Static configuration/);

  const offline = offlineBrainMap("unreachable");
  assert.match(brainSourceLine(offline, findNode(offline, LOCAL_MODEL_ID)), /Demo data/);

  const stale = staleBrainMap(live);
  assert.match(brainSourceLine(stale, findNode(stale, LOCAL_MODEL_ID)), /may be out of date/);
});

test("checked times render as a short HH:MM", () => {
  assert.equal(checkedTimeLabel(null), "");
  assert.equal(checkedTimeLabel("not a date"), "");
  assert.match(checkedTimeLabel(CHECKED), /^\d{2}:\d{2}$/);
});

test("the Brain live source stays local, bounded and credential-free", () => {
  const root = process.cwd();
  const files = ["src/brain/liveBrain.ts", "src/brain/useLiveBrainMap.ts", "src/brain/BrainScreen.tsx"];

  for (const rel of files) {
    const source = readFileSync(join(root, rel), "utf8");
    assert.ok(!/(theme|palette)\.danger/.test(source), `${rel} uses the danger colour`);
    assert.ok(!/api[_-]?key|authorization|bearer|secret/i.test(source), `${rel} looks for a credential`);
    assert.ok(
      !/openai|anthropic|openrouter|generativelanguage|googleapis|api\.groq/i.test(source),
      `${rel} talks to a cloud provider`,
    );
  }

  const live = readFileSync(join(root, "src/brain/liveBrain.ts"), "utf8");
  assert.ok(live.includes("/v1/health"), "the live source must use the local health route");
  assert.ok(BRAIN_POLL_MS >= 15_000 && BRAIN_POLL_MS <= 60_000, "polling must stay slow");
  assert.ok(BRAIN_TIMEOUT_MS >= 1_000 && BRAIN_TIMEOUT_MS <= 10_000, "one read must be time-limited");

  const hook = readFileSync(join(root, "src/brain/useLiveBrainMap.ts"), "utf8");
  for (const needle of ["usePageVisible", "setInterval", "clearInterval", "abort()"]) {
    assert.ok(hook.includes(needle), `the hook must clean up or pause: ${needle}`);
  }

  const screen = readFileSync(join(root, "src/brain/BrainScreen.tsx"), "utf8");
  assert.ok(screen.includes("useLiveBrainMap"), "the screen must use the live hook");
  assert.ok(!screen.includes("fetch("), "the screen must not fetch directly");
});
