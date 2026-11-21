import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createPowerController, RESTART_TARGETS } from "./power.mjs";

function tempScript(name = "preyas.sh") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "preyas-power-"));
  const script = path.join(dir, name);
  fs.writeFileSync(script, "#!/bin/bash\nexit 0\n");
  return { dir, script, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

const STATUS = {
  ok: true,
  checkedAt: "2026-11-21T12:00:00Z",
  services: [
    { name: "llama", label: "llama-server", port: 8790, running: true, health: true, pid: 100, ramMb: 512, available: true },
    { name: "brain", label: "brain-server", port: 8788, running: true, health: true, pid: 200, ramMb: 64, available: true },
  ],
  autostart: { installed: false, supported: true, path: "/tmp/com.preyas.control.plist" },
};

test("status parses the controller JSON", async () => {
  const t = tempScript();
  try {
    const calls = [];
    const power = createPowerController({
      scriptPath: t.script,
      logDir: t.dir,
      run: async (file, args, opts) => {
        calls.push({ file, args, opts });
        return { stdout: JSON.stringify(STATUS), stderr: "" };
      },
    });
    const status = await power.status();
    assert.equal(status.ok, true);
    assert.equal(status.services.length, 2);
    assert.equal(status.services[0].ramMb, 512);
    assert.deepEqual(calls[0].args, [t.script, "status", "--json"]);
    assert.equal(calls[0].file, "bash");
  } finally {
    t.cleanup();
  }
});

test("an unreadable or missing controller becomes a clear, safe status", async () => {
  const t = tempScript();
  try {
    const bad = createPowerController({
      scriptPath: t.script,
      logDir: t.dir,
      run: async () => ({ stdout: "not json", stderr: "" }),
    });
    const broken = await bad.status();
    assert.equal(broken.ok, false);
    assert.equal(broken.services.length, 0);
    assert.match(broken.error, /controller/i);

    const missing = createPowerController({ scriptPath: path.join(t.dir, "nope.sh"), logDir: t.dir });
    const gone = await missing.status();
    assert.equal(gone.ok, false);
    assert.match(gone.error, /controller/i);
  } finally {
    t.cleanup();
  }
});

test("restart only launches an allowlisted service, detached, after answering", async () => {
  const t = tempScript("preyas control.sh");
  try {
    const spawned = [];
    const power = createPowerController({
      scriptPath: t.script,
      logDir: t.dir,
      run: async () => ({ stdout: "{}" }),
      spawnDetached: (file, args) => spawned.push({ file, args }),
    });
    assert.ok(RESTART_TARGETS.includes("brain"));
    const result = await power.restart("brain");
    assert.equal(result.ok, true);
    assert.equal(spawned.length, 1);
    assert.equal(spawned[0].file, "/bin/bash");
    assert.match(spawned[0].args[1], /sleep 1/);
    assert.match(spawned[0].args[1], /restart 'brain'/);
    assert.match(spawned[0].args[1], /'\/.*preyas control\.sh'/, "the path is quoted");

    const bad = await power.restart("../../etc/passwd");
    assert.equal(bad.ok, false);
    assert.equal(bad.code, "bad_service");
    assert.equal(spawned.length, 1, "a bad name never reaches a shell");
  } finally {
    t.cleanup();
  }
});

test("off asks the controller to stop everything", async () => {
  const t = tempScript();
  try {
    const spawned = [];
    const power = createPowerController({
      scriptPath: t.script,
      logDir: t.dir,
      run: async () => ({ stdout: "{}" }),
      spawnDetached: (file, args) => spawned.push({ file, args }),
    });
    const result = await power.off();
    assert.equal(result.ok, true);
    assert.equal(result.stopping, true);
    assert.match(spawned[0].args[1], /stop/);
  } finally {
    t.cleanup();
  }
});

test("autostart reads and writes the launchd state through the script", async () => {
  const t = tempScript();
  try {
    const calls = [];
    const responses = [
      { stdout: JSON.stringify({ installed: false, supported: true, path: t.script }), stderr: "" },
      { stdout: "Auto-start on login is ON.\n", stderr: "" },
      { stdout: JSON.stringify({ installed: true, supported: true, path: t.script }), stderr: "" },
    ];
    const power = createPowerController({
      scriptPath: t.script,
      logDir: t.dir,
      run: async (file, args, opts) => {
        calls.push({ file, args, opts });
        return responses.shift();
      },
    });
    const before = await power.autostartStatus();
    assert.equal(before.installed, false);
    assert.equal(before.supported, true);

    const after = await power.setAutostart(true);
    assert.equal(after.installed, true);
    assert.deepEqual(calls[1].args, [t.script, "autostart", "on"]);
    assert.deepEqual(calls[2].args, [t.script, "autostart", "status", "--json"]);
  } finally {
    t.cleanup();
  }
});
