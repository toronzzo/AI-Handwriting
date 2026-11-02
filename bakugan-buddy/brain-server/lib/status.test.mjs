import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PARTS, collectStatus, restartArgs } from "./status.mjs";

function fakeFetch(up) {
  return async (url) => {
    for (const [name, ok] of Object.entries(up)) {
      const needle = name === "llama" ? "8790" : name === "proxy" ? "8788" : name === "whisper" ? "8178" : name === "gateway" ? "4000" : "8081";
      if (url.includes(needle)) {
        if (ok === "throw") throw new Error("down");
        return { ok: Boolean(ok), status: ok ? 200 : 503 };
      }
    }
    return { ok: false, status: 404 };
  };
}

function driveWith(mounted) {
  if (!mounted) return "/nonexistent/preyas-drive";
  return fs.mkdtempSync(path.join(os.tmpdir(), "preyas-status-"));
}

test("every part is reported with ok/down detail", async () => {
  const root = driveWith(true);
  try {
    const status = await collectStatus({
      drive: root,
      buddy: root,
      fetchImpl: fakeFetch({ llama: true, proxy: true, whisper: true, gateway: true, web: true }),
      diskFree: async () => 412.5,
      swap: async () => 4821,
      now: () => "2026-11-02T21:00:00.000Z",
    });
    assert.equal(status.ok, true);
    assert.equal(status.checkedAt, "2026-11-02T21:00:00.000Z");
    for (const name of PARTS) {
      assert.ok(status.parts[name], `${name} missing`);
      assert.equal(status.parts[name].ok, true, `${name} should be ok`);
      assert.equal(typeof status.parts[name].label, "string");
      assert.equal(status.parts[name].detail, name === "drive" ? root : "running");
    }
    assert.equal(status.drive.mounted, true);
    assert.equal(status.drive.freeGb, 412.5);
    assert.equal(status.memory.swapUsedMb, 4821);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a down part makes the whole status not ok", async () => {
  const root = driveWith(true);
  try {
    const status = await collectStatus({
      drive: root,
      buddy: root,
      fetchImpl: fakeFetch({ llama: true, proxy: false, whisper: "throw", gateway: true, web: true }),
      diskFree: async () => 10,
      swap: async () => 100,
    });
    assert.equal(status.ok, false);
    assert.equal(status.parts.proxy.ok, false);
    assert.equal(status.parts.proxy.detail, "down");
    assert.equal(status.parts.whisper.ok, false);
    assert.equal(status.parts.llama.ok, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("an unmounted drive is reported without probing disk space", async () => {
  let probed = false;
  const status = await collectStatus({
    drive: "/nonexistent/preyas-drive",
    buddy: "/nonexistent/preyas-drive",
    fetchImpl: fakeFetch({ llama: true, proxy: true, whisper: true, gateway: true, web: true }),
    diskFree: async () => {
      probed = true;
      return 1;
    },
    swap: async () => null,
  });
  assert.equal(status.parts.drive.ok, false);
  assert.equal(status.drive.mounted, false);
  assert.equal(status.drive.freeGb, null);
  assert.equal(probed, false, "no point asking for free space on a missing drive");
  assert.equal(status.ok, false);
});

test("checks can be overridden without touching the network", async () => {
  const root = driveWith(true);
  try {
    const status = await collectStatus({
      drive: root,
      buddy: root,
      checks: { llama: true, proxy: false, whisper: true, gateway: true, web: false },
      diskFree: async () => 0,
      swap: async () => 0,
    });
    assert.equal(status.parts.llama.ok, true);
    assert.equal(status.parts.proxy.ok, false);
    assert.equal(status.parts.web.ok, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("restart runs the down script, then the up script", () => {
  const args = restartArgs("/repo/bakugan-buddy/launcher");
  assert.equal(args[0], "-c");
  const command = args[1];
  assert.ok(command.indexOf("preyas-down.sh") < command.indexOf("preyas-up.sh"));
  assert.match(command, /\/repo\/bakugan-buddy\/launcher\/preyas-down\.sh/);
});
