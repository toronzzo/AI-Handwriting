import { test } from "node:test";
import assert from "node:assert/strict";
import { handleOsRoute } from "./routes.mjs";

function fakeRes() {
  const out = { status: 0, headers: {}, body: "" };
  return {
    out,
    res: {
      writeHead(status, headers) {
        out.status = status;
        out.headers = headers || {};
      },
      end(body) {
        out.body = String(body);
      },
    },
  };
}

function ctx({ pathname, method = "GET", body = null, power = null, capabilities = null, selfKnowledge = null }) {
  return {
    req: { method },
    url: { pathname },
    dataDir: "",
    readJson: async () => JSON.parse(body ?? "{}"),
    readBody: async () => Buffer.from(body ?? ""),
    now: () => new Date("2026-11-21T12:00:00Z"),
    capabilities,
    selfKnowledge,
    power,
  };
}

const SNAPSHOT = {
  v: 1,
  builtAt: "2026-11-21T12:00:00Z",
  tools: [{ id: "files", label: "Files" }],
  models: [{ id: "small", label: "8B local" }],
  media: [],
  services: [{ id: "brain", label: "brain-server", running: true }],
  changelog: [{ id: "x", date: "2026-11-21", text: "I can now test." }],
  summary: "CAPS",
};

test("GET /v1/capabilities refreshes and returns the list with the changelog", async () => {
  const { res, out } = fakeRes();
  let refreshed = 0;
  const capabilities = {
    refresh: async () => {
      refreshed += 1;
      return SNAPSHOT;
    },
    snapshot: () => SNAPSHOT,
  };
  const answered = await handleOsRoute({
    ...ctx({ pathname: "/v1/capabilities", capabilities, selfKnowledge: { about: () => ({ changelog: SNAPSHOT.changelog }) } }),
    res,
  });
  assert.equal(answered, true);
  assert.equal(out.status, 200);
  assert.equal(refreshed, 1);
  const body = JSON.parse(out.body);
  assert.equal(body.tools[0].label, "Files");
  assert.equal(body.about.changelog.length, 1);
});

test("GET /v1/power/status answers with the controller's services", async () => {
  const { res, out } = fakeRes();
  const power = { status: async () => ({ ok: true, services: [{ name: "brain", running: true }] }) };
  const answered = await handleOsRoute({ ...ctx({ pathname: "/v1/power/status", power }), res });
  assert.equal(answered, true);
  assert.equal(out.status, 200);
  assert.deepEqual(JSON.parse(out.body).services, [{ name: "brain", running: true }]);
});

test("POST /v1/power/restart passes the service and answers 202", async () => {
  const { res, out } = fakeRes();
  let asked = "";
  const power = {
    restart: async (service) => {
      asked = service;
      return { ok: true, restarting: service };
    },
  };
  const answered = await handleOsRoute({
    ...ctx({ pathname: "/v1/power/restart", method: "POST", body: JSON.stringify({ service: "brain" }), power }),
    res,
  });
  assert.equal(answered, true);
  assert.equal(asked, "brain");
  assert.equal(out.status, 202);
});

test("POST /v1/power/restart surfaces a refused service as 400", async () => {
  const { res, out } = fakeRes();
  const power = { restart: async () => ({ ok: false, code: "bad_service", error: "Unknown service." }) };
  await handleOsRoute({
    ...ctx({ pathname: "/v1/power/restart", method: "POST", body: JSON.stringify({ service: "nope" }), power }),
    res,
  });
  assert.equal(out.status, 400);
  assert.equal(JSON.parse(out.body).code, "bad_service");
});

test("POST /v1/power/off asks the controller to stop everything", async () => {
  const { res, out } = fakeRes();
  let stopped = 0;
  const power = {
    off: async () => {
      stopped += 1;
      return { ok: true, stopping: true };
    },
  };
  await handleOsRoute({ ...ctx({ pathname: "/v1/power/off", method: "POST", power }), res });
  assert.equal(stopped, 1);
  assert.equal(out.status, 202);
});

test("autostart is readable and writable, but only with a boolean", async () => {
  let installed = false;
  const power = {
    autostartStatus: async () => ({ installed, supported: true }),
    setAutostart: async (on) => {
      installed = on;
      return { installed, supported: true };
    },
  };
  let { res, out } = fakeRes();
  await handleOsRoute({ ...ctx({ pathname: "/v1/power/autostart", power }), res });
  assert.equal(out.status, 200);
  assert.equal(JSON.parse(out.body).installed, false);

  ({ res, out } = fakeRes());
  await handleOsRoute({
    ...ctx({ pathname: "/v1/power/autostart", method: "POST", body: JSON.stringify({ on: true }), power }),
    res,
  });
  assert.equal(out.status, 200);
  assert.equal(JSON.parse(out.body).installed, true);

  ({ res, out } = fakeRes());
  await handleOsRoute({
    ...ctx({ pathname: "/v1/power/autostart", method: "POST", body: JSON.stringify({ on: "yes" }), power }),
    res,
  });
  assert.equal(out.status, 400);
  assert.equal(JSON.parse(out.body).error, "on_must_be_boolean");
});

test("the power routes say unavailable without a controller", async () => {
  const { res, out } = fakeRes();
  await handleOsRoute({ ...ctx({ pathname: "/v1/power/status" }), res });
  assert.equal(out.status, 503);
  assert.equal(JSON.parse(out.body).error, "power_unavailable");
});
