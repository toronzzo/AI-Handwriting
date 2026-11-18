import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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

function ctx({ pathname, dataDir }) {
  return {
    req: { method: "GET" },
    url: { pathname },
    dataDir,
    readJson: async () => ({}),
    readBody: async () => Buffer.alloc(0),
    now: () => new Date("2026-11-18T23:00:00.000Z"),
  };
}

test("GET /v1/persona answers with the persona view", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "os-routes-"));
  try {
    const { res, out } = fakeRes();
    const answered = await handleOsRoute({ ...ctx({ pathname: "/v1/persona", dataDir: dir }), res });
    assert.equal(answered, true);
    assert.equal(out.status, 200);
    const body = JSON.parse(out.body);
    assert.equal(typeof body.text, "string");
    assert.ok(body.text.length > 0);
    assert.equal(body.rev, 1);
    assert.equal(body.source, "default");
    assert.ok(body.text.includes("[[ASK_PAID]]"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("GET /v1/persona/versions lists revisions without the text", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "os-routes-versions-"));
  try {
    const { res, out } = fakeRes();
    const answered = await handleOsRoute({ ...ctx({ pathname: "/v1/persona/versions", dataDir: dir }), res });
    assert.equal(answered, true);
    const body = JSON.parse(out.body);
    assert.ok(Array.isArray(body.versions));
    for (const record of body.versions) {
      assert.equal(typeof record.rev, "number");
      assert.ok(!("text" in record), "revision lines carry no persona text");
    }
    assert.equal(body.versions.length, 0, "no persona loaded yet");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("an unknown path returns false", async () => {
  const { res } = fakeRes();
  const answered = await handleOsRoute({ ...ctx({ pathname: "/v1/nothing", dataDir: "" }), res });
  assert.equal(answered, false);
});

test("a broken dataDir never throws", async () => {
  const { res, out } = fakeRes();
  const answered = await handleOsRoute({ ...ctx({ pathname: "/v1/persona", dataDir: "/dev/null/persona" }), res });
  assert.equal(answered, true);
  assert.equal(out.status, 200);
  const body = JSON.parse(out.body);
  assert.equal(body.usedDefault, true);
  assert.ok(body.warnings.length > 0);
});

test("GET /v1/persona works when ctx.now returns a number (as proxy.mjs passes)", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "os-routes-now-"));
  try {
    let status = 0;
    let body = "";
    const res = { writeHead(code) { status = code; }, end(text) { body = text; } };
    const handled = await handleOsRoute({ req: { method: "GET" }, res, url: new URL("http://x/v1/persona"), dataDir, now: () => Date.now() });
    assert.equal(handled, true);
    assert.equal(status, 200);
    assert.equal(JSON.parse(body).rev, 1);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
