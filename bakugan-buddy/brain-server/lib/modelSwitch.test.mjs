import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createModelSwitch, freeMemoryGb, IDLE_RETURN_MS } from "./modelSwitch.mjs";

/** A fake spawned llama-server that records its fate. */
function fakeChild(pid) {
  const child = {
    pid,
    killed: null,
    unref() {
      return child;
    },
    on(event, cb) {
      child.exitCb = cb;
    },
    kill(signal) {
      child.killed = signal;
    },
    emitExit(code, signal) {
      if (child.exitCb) child.exitCb(code, signal);
    },
  };
  return child;
}

/**
 * Build a switch with fakes. `now` and `sleep` share a clock so the health
 * poll loop always advances; tests flip `healthy` and drain microtasks.
 */
function makeSwitch(options = {}) {
  const clock = { ms: options.startMs ?? 1_000_000 };
  const models = fs.mkdtempSync(path.join(os.tmpdir(), "preyas-models-"));
  for (const file of [
    "Huihui-Qwen3-8B-abliterated-v2.Q4_K_M.gguf",
    "Huihui-Qwen3-14B-abliterated-v2.Q4_K_M.gguf",
    "Qwen3-30B-A3B.Q3_K_M.gguf",
  ]) {
    fs.writeFileSync(path.join(models, file), "not a real gguf");
  }
  const spawned = [];
  const killed = [];
  const state = {
    healthy: options.healthy ?? false,
    portPid: options.portPid ?? null,
    portName: options.portName ?? "llama-server",
    freeGb: options.freeGb ?? null,
    nextPid: 9000,
  };
  // Idle-timer tests let the module use its own clock and setTimeout, which
  // node:test mock timers then control. All other tests use the fake clock.
  const ownClock = options.ownClock === true;
  const switcher = createModelSwitch({
    modelsDir: models,
    port: 8790,
    llamaBin: "/fake/llama-server",
    template: null,
    dataDir: "",
    fetchImpl: async (url) => {
      if (String(url).includes("/health")) {
        return { ok: state.healthy };
      }
      if (String(url).includes("/props")) {
        return { ok: true, json: async () => ({ model: "/models/Huihui-Qwen3-8B-abliterated-v2.Q4_K_M.gguf" }) };
      }
      return { ok: false, status: 404 };
    },
    spawnImpl: (bin, args) => {
      const child = fakeChild(++state.nextPid);
      spawned.push({ bin, args, child });
      return child;
    },
    execImpl: (cmd, args, opts, cb) => {
      if (cmd === "lsof") {
        const pid = state.portPid;
        cb(null, pid === null ? "" : String(pid));
        return undefined;
      }
      if (cmd === "ps") {
        cb(null, state.portName);
        return undefined;
      }
      cb(new Error("unexpected exec"), "");
      return undefined;
    },
    killImpl: (pid, signal) => {
      killed.push({ pid, signal });
      // The real process leaves the port when it dies.
      if (state.portPid === pid) state.portPid = null;
    },
    probeFree: async () => state.freeGb,
    sleep: ownClock ? undefined : async () => {
      clock.ms += 500;
    },
    now: ownClock ? undefined : () => clock.ms,
    log: () => {},
  });
  return {
    switcher,
    models,
    spawned,
    killed,
    state,
    clock,
    drain: async () => {
      for (let i = 0; i < 20; i++) {
        await Promise.resolve();
      }
      await new Promise((resolve) => setImmediate(resolve));
    },
  };
}

test("big under 10 GB free asks for a card and starts nothing", async () => {
  const f = makeSwitch({ freeGb: 9.5, healthy: true });
  try {
    const result = await f.switcher.request("big");
    assert.equal(result.ok, false);
    assert.equal(result.needsConfirm, true);
    assert.equal(result.freeGb, 9.5);
    assert.equal(f.spawned.length, 0, "no server may start before the card is answered");
    assert.equal(f.switcher.state().status, "down");
  } finally {
    fs.rmSync(f.models, { recursive: true, force: true });
  }
});

test("huge always asks for a card, even with plenty of memory", async () => {
  const f = makeSwitch({ freeGb: 60, healthy: true });
  try {
    const result = await f.switcher.request("huge");
    assert.equal(result.needsConfirm, true);
    assert.equal(f.spawned.length, 0);
  } finally {
    fs.rmSync(f.models, { recursive: true, force: true });
  }
});

test("big with 10+ GB free starts right away; confirm also works under the limit", async () => {
  for (const opts of [
    { freeGb: 10, confirmed: false },
    { freeGb: 2, confirmed: true },
  ]) {
    const f = makeSwitch({ ...opts, healthy: true });
    try {
      const result = await f.switcher.request("big", { confirmed: opts.confirmed });
      assert.equal(result.ok, true);
      assert.equal(result.needsConfirm, undefined);
      await f.drain();
      const st = f.switcher.state();
      assert.equal(st.status, "ready");
      assert.equal(st.current, "big");
      assert.equal(f.spawned.length, 1);
    } finally {
      fs.rmSync(f.models, { recursive: true, force: true });
    }
  }
});

test("an unknown model id is refused", async () => {
  const f = makeSwitch({ healthy: true });
  try {
    const result = await f.switcher.request("medium");
    assert.equal(result.ok, false);
    assert.match(result.error, /unknown model/);
    assert.equal(f.spawned.length, 0);
  } finally {
    fs.rmSync(f.models, { recursive: true, force: true });
  }
});

test("the server starts with flash attention, one slot and the right context", async () => {
  const f = makeSwitch({ healthy: true, freeGb: 40 });
  try {
    await f.switcher.request("big", { confirmed: true });
    await f.drain();
    assert.equal(f.spawned.length, 1);
    const { bin, args } = f.spawned[0];
    assert.equal(bin, "/fake/llama-server");
    assert.equal(args[args.indexOf("-m") + 1], path.join(f.models, "Huihui-Qwen3-14B-abliterated-v2.Q4_K_M.gguf"));
    assert.equal(args[args.indexOf("-c") + 1], "16384", "big keeps the 16K window");
    assert.equal(args[args.indexOf("--flash-attn") + 1], "on");
    assert.equal(args[args.indexOf("--parallel") + 1], "1");
    assert.ok(args.includes("--slots"), "one slot only");
    assert.ok(args.includes("--jinja"), "Qwen3 template so thinking can be turned off per request");
    assert.ok(args.includes("--no-context-shift"));
    assert.equal(args[args.indexOf("--host") + 1], "127.0.0.1");
    assert.equal(args[args.indexOf("--port") + 1], "8790");
    assert.equal(args[args.indexOf("-ngl") + 1], "99", "8B and 14B fit fully on the GPU");
    // huge gets the 8K window and a partial offload so the 16 GB Mac survives
    const f2 = makeSwitch({ healthy: true, freeGb: 1 });
    await f2.switcher.request("huge", { confirmed: true });
    await f2.drain();
    assert.equal(f2.spawned[0].args[f2.spawned[0].args.indexOf("-c") + 1], "8192");
    assert.equal(f2.spawned[0].args[f2.spawned[0].args.indexOf("-ngl") + 1], "24", "the 30B keeps most layers on the CPU");
    fs.rmSync(f2.models, { recursive: true, force: true });
  } finally {
    fs.rmSync(f.models, { recursive: true, force: true });
  }
});

test("switching stops the old server before starting the new one", async () => {
  const f = makeSwitch({ healthy: true, freeGb: 40, portPid: 4242 });
  try {
    await f.switcher.request("big", { confirmed: true });
    await f.drain();
    const bigChild = f.spawned[0].child;
    // The drive launcher's 8B held the port first: it must be stopped politely.
    assert.deepEqual(f.killed, [{ pid: 4242, signal: "SIGTERM" }]);
    // Now the switch's own server owns the port.
    f.state.portPid = null;
    await f.switcher.request("small");
    await f.drain();
    assert.equal(bigChild.killed, "SIGTERM", "the running big server is stopped");
    assert.equal(f.spawned.length, 2);
    assert.equal(f.spawned[1].args[f.spawned[1].args.indexOf("-m") + 1], path.join(f.models, "Huihui-Qwen3-8B-abliterated-v2.Q4_K_M.gguf"));
    assert.equal(f.switcher.state().current, "small");
  } finally {
    fs.rmSync(f.models, { recursive: true, force: true });
  }
});

test("asking for the model that is already running does not restart it", async () => {
  const f = makeSwitch({ healthy: true, freeGb: 40 });
  try {
    await f.switcher.request("big", { confirmed: true });
    await f.drain();
    const result = await f.switcher.request("big");
    assert.equal(result.ok, true);
    assert.equal(result.unchanged, true);
    assert.equal(f.spawned.length, 1);
  } finally {
    fs.rmSync(f.models, { recursive: true, force: true });
  }
});

test("a port held by a stranger is never killed", async () => {
  const f = makeSwitch({ healthy: true, freeGb: 40, portPid: 777, portName: "Finder" });
  try {
    await f.switcher.request("big", { confirmed: true });
    await f.drain();
    assert.equal(f.spawned.length, 0, "nothing may start on a stranger's port");
    assert.equal(f.killed.length, 0);
    const st = f.switcher.state();
    assert.equal(st.status, "error");
    assert.match(st.error, /Finder/);
  } finally {
    fs.rmSync(f.models, { recursive: true, force: true });
  }
});

test("a missing model file fails the switch cleanly", async () => {
  const f = makeSwitch({ healthy: true, freeGb: 40 });
  try {
    fs.rmSync(path.join(f.models, "Qwen3-30B-A3B.Q3_K_M.gguf"));
    await f.switcher.request("huge", { confirmed: true });
    await f.drain();
    const st = f.switcher.state();
    assert.equal(st.status, "error");
    assert.match(st.error, /not on the drive/);
    assert.equal(f.spawned.length, 0);
  } finally {
    fs.rmSync(f.models, { recursive: true, force: true });
  }
});

test("idle timer: 20 quiet minutes on big bring the 8B back; activity resets it", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const f = makeSwitch({ healthy: true, freeGb: 40, ownClock: true });
  try {
    await f.switcher.request("big", { confirmed: true });
    await f.drain();
    assert.equal(f.switcher.state().current, "big");
    assert.equal(f.spawned.length, 1);

    t.mock.timers.tick(IDLE_RETURN_MS - 60_000); // 19 min
    assert.equal(f.switcher.state().current, "big", "not idle long enough yet");

    f.switcher.touch(); // the user said something
    t.mock.timers.tick(IDLE_RETURN_MS - 60_000); // 19 more min
    assert.equal(f.switcher.state().current, "big", "activity pushed the window out");

    t.mock.timers.tick(120_000); // 2 more min — 20 min after the last message
    await f.drain();
    const st = f.switcher.state();
    assert.equal(st.current, "small", "auto-returned to the 8B");
    assert.equal(st.status, "ready");
    assert.equal(f.spawned.length, 2);
    assert.equal(f.spawned[0].child.killed, "SIGTERM", "the big server was stopped");
  } finally {
    fs.rmSync(f.models, { recursive: true, force: true });
  }
});

test("no idle timer runs while the 8B is already live", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const f = makeSwitch({ healthy: true, freeGb: 40, ownClock: true });
  try {
    await f.switcher.request("small");
    await f.drain();
    assert.equal(f.switcher.state().current, "small");
    t.mock.timers.tick(IDLE_RETURN_MS + 60_000);
    await f.drain();
    assert.equal(f.spawned.length, 1, "small stays small");
  } finally {
    fs.rmSync(f.models, { recursive: true, force: true });
  }
});

test("freeMemoryGb turns vm_stat pages into GB, and null when the probe fails", async () => {
  const vmStat = [
    "Mach Virtual Memory Statistics: (page size of 16384 bytes)",
    "Pages free:                                4182.",
    "Pages active:                            288873.",
    "Pages inactive:                          287112.",
    "Pages speculative:                         1031.",
    "Pages purgeable:                           1962.",
    "Pages wired down:                        157524.",
  ].join("\n");
  const fake = (cmd, args, opts, cb) => cb(null, vmStat);
  assert.equal(await freeMemoryGb(fake), 4.8);
  const failing = (cmd, args, opts, cb) => cb(new Error("no vm_stat"), "");
  assert.equal(await freeMemoryGb(failing), null);
  const garbage = (cmd, args, opts, cb) => cb(null, "not a vm_stat page");
  assert.equal(await freeMemoryGb(garbage), null);
});

test("refresh flips status when :8790 goes down and comes back", async () => {
  const f = makeSwitch({ healthy: true, freeGb: 40 });
  try {
    await f.switcher.request("small");
    await f.drain();
    assert.equal((await f.switcher.refresh()).status, "ready");
    f.state.healthy = false;
    assert.equal((await f.switcher.refresh()).status, "down");
    f.state.healthy = true;
    assert.equal((await f.switcher.refresh()).status, "ready");
  } finally {
    fs.rmSync(f.models, { recursive: true, force: true });
  }
});

test("the proxy timeout grows with the tier", async () => {
  const f = makeSwitch({ healthy: true, freeGb: 40 });
  try {
    assert.equal(f.switcher.chatTimeoutMs(), 90_000, "down: keep the base timeout");
    await f.switcher.request("big", { confirmed: true });
    await f.drain();
    assert.equal(f.switcher.chatTimeoutMs(), 150_000);
    const f2 = makeSwitch({ healthy: true, freeGb: 40 });
    await f2.switcher.request("huge", { confirmed: true });
    await f2.drain();
    assert.equal(f2.switcher.chatTimeoutMs(), 300_000);
    fs.rmSync(f2.models, { recursive: true, force: true });
  } finally {
    fs.rmSync(f.models, { recursive: true, force: true });
  }
});
