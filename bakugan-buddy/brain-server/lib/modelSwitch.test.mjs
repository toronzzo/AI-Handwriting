import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { HUGE_TIMEOUT_MS, SWITCHING_CHAT_MESSAGE } from "../../packages/alive/src/modelSwitch.ts";
import { chatGate, createModelSwitch, DEFAULT_IDLE_MODEL, freeMemoryGb, IDLE_RETURN_MS, LOAD_TIMEOUT_MS, ROLLBACK_NOTE } from "./modelSwitch.mjs";

/** Poll a condition with real timers (for the crash-rollback test). */
async function waitFor(cond, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (cond()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("waitFor timed out");
}

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
    "Qwen3.5-0.8B-Q4_K_M.gguf",
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
  const events = [];
  const switcher = createModelSwitch({
    modelsDir: models,
    port: 8790,
    llamaBin: "/fake/llama-server",
    template: null,
    dataDir: "",
    brain: { emit: (event) => events.push(event) },
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
    onRollback: options.onRollback ?? null,
  });
  return {
    switcher,
    models,
    spawned,
    killed,
    state,
    clock,
    events,
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

test("a missing model file fails the switch, then the 8B comes back", async () => {
  const f = makeSwitch({ healthy: true, freeGb: 40 });
  try {
    fs.rmSync(path.join(f.models, "Qwen3-30B-A3B.Q3_K_M.gguf"));
    await f.switcher.request("huge", { confirmed: true });
    await f.drain();
    const st = f.switcher.state();
    assert.equal(st.status, "ready", "the rollback restarts the 8B");
    assert.equal(st.current, "small");
    assert.ok(st.rollback && st.rollback.note === ROLLBACK_NOTE);
    assert.ok(f.events.some((event) => event.neuron === "chat-huge" && event.state === "error" && /not on the drive/.test(event.detail || "")));
    assert.equal(f.spawned.length, 1, "only the 8B was started");
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
    assert.equal(f2.switcher.chatTimeoutMs(), HUGE_TIMEOUT_MS, "huge: the one shared budget the app also uses");
    fs.rmSync(f2.models, { recursive: true, force: true });
  } finally {
    fs.rmSync(f.models, { recursive: true, force: true });
  }
});

test("the huge tier takes one shared timeout of at least 600 s for load and reply", () => {
  assert.ok(HUGE_TIMEOUT_MS >= 600_000, "at least 600 s");
  assert.equal(LOAD_TIMEOUT_MS.huge, HUGE_TIMEOUT_MS, "the huge load budget is the same shared value");
  assert.equal(SWITCHING_CHAT_MESSAGE, "switching models, try again in a moment");
});

test("use big: chat-big lights loading, chat-small goes off, then chat-big is off", async () => {
  const f = makeSwitch({ healthy: true, freeGb: 40 });
  try {
    const result = await f.switcher.request("big", { confirmed: true });
    assert.equal(result.ok, true);
    await f.drain();
    assert.equal(f.switcher.state().status, "ready");

    const neurons = f.events.map((event) => `${event.neuron}:${event.state}`);
    assert.ok(neurons.includes("chat-big:loading"), neurons.join(", "));
    assert.ok(neurons.includes("chat-small:off"), neurons.join(", "));
    assert.ok(neurons.includes("chat-big:off"), neurons.join(", "));

    const bigLoading = f.events.findIndex((event) => event.neuron === "chat-big" && event.state === "loading");
    const smallOff = f.events.findIndex((event) => event.neuron === "chat-small" && event.state === "off");
    assert.ok(bigLoading >= 0 && smallOff > bigLoading, "big loads first, then small turns off");
  } finally {
    fs.rmSync(f.models, { recursive: true, force: true });
  }
});

test("a switch that fails reports error on the target neuron, then rolls back", async () => {
  const f = makeSwitch({ healthy: true, freeGb: 40 });
  try {
    fs.rmSync(path.join(f.models, "Huihui-Qwen3-14B-abliterated-v2.Q4_K_M.gguf"));
    const result = await f.switcher.request("big", { confirmed: true });
    assert.equal(result.ok, true, "the switch still starts");
    await f.drain();
    assert.equal(f.switcher.state().status, "ready", "the 8B is back");
    assert.equal(f.switcher.state().current, "small");
    assert.ok(f.events.some((event) => event.neuron === "chat-big" && event.state === "error"));
    assert.ok(f.events.some((event) => event.neuron === "chat-big" && event.state === "loading"));
  } finally {
    fs.rmSync(f.models, { recursive: true, force: true });
  }
});

test("a switch with everything already loaded emits nothing", async () => {
  const f = makeSwitch({ healthy: true, freeGb: 40 });
  try {
    await f.switcher.request("small", { confirmed: true });
    await f.drain();
    assert.equal(f.switcher.state().status, "ready");
    f.events.length = 0;
    const again = await f.switcher.request("small", { confirmed: true });
    assert.equal(again.unchanged, true);
    await f.drain();
    assert.equal(f.events.length, 0, "no new feed lines for a no-op request");
  } finally {
    fs.rmSync(f.models, { recursive: true, force: true });
  }
});

test("a bad model file rolls back: the 8B comes up and the note is exposed", async () => {
  const f = makeSwitch({ healthy: true, freeGb: 40 });
  try {
    fs.rmSync(path.join(f.models, "Huihui-Qwen3-14B-abliterated-v2.Q4_K_M.gguf"));
    await f.switcher.request("big", { confirmed: true });
    await f.drain();
    const st = f.switcher.state();
    assert.equal(st.current, "small", "back on the 8B");
    assert.equal(st.status, "ready");
    assert.ok(st.rollback, "the note rides in the state for the app");
    assert.equal(st.rollback.target, "big");
    assert.equal(st.rollback.note, ROLLBACK_NOTE);
    assert.equal(f.spawned.length, 1, "only the 8B was started");
    assert.ok(f.spawned[0].args.join(" ").includes("Huihui-Qwen3-8B"), "the 8B model file");
    assert.ok(f.events.some((event) => event.neuron === "chat-big" && event.state === "error"));
  } finally {
    fs.rmSync(f.models, { recursive: true, force: true });
  }
});

test("a crash while a big model loads restarts the 8B", async () => {
  const f = makeSwitch({ healthy: false, freeGb: 40, ownClock: true });
  try {
    await f.switcher.request("big", { confirmed: true });
    await waitFor(() => f.spawned.length >= 1, 2000);
    f.spawned[0].child.emitExit(1); // the fake server dies mid-load
    await waitFor(() => f.spawned.length >= 2, 3000); // the rollback started the 8B
    f.state.healthy = true; // the 8B becomes healthy
    await waitFor(() => f.switcher.state().status === "ready" && f.switcher.state().current === "small", 3000);
    const st = f.switcher.state();
    assert.equal(st.current, "small");
    assert.equal(st.status, "ready");
    assert.ok(st.rollback && st.rollback.note === ROLLBACK_NOTE);
    assert.equal(f.spawned.length, 2, "big failed, then the 8B was started");
    assert.ok(f.spawned[1].args.join(" ").includes("Huihui-Qwen3-8B"));
  } finally {
    fs.rmSync(f.models, { recursive: true, force: true });
  }
});

test("a failed rollback does not loop", async () => {
  const f = makeSwitch({ healthy: false, freeGb: 40 });
  try {
    fs.rmSync(path.join(f.models, "Huihui-Qwen3-8B-abliterated-v2.Q4_K_M.gguf"));
    fs.rmSync(path.join(f.models, "Huihui-Qwen3-14B-abliterated-v2.Q4_K_M.gguf"));
    await f.switcher.request("big", { confirmed: true });
    await f.drain();
    assert.equal(f.spawned.length, 0, "neither model file exists");
    const st = f.switcher.state();
    assert.equal(st.status, "error");
    assert.ok(st.rollback, "the note still says what happened");
    assert.equal(f.events.filter((event) => event.state === "error").length, 2, "big failed, the rollback failed, then it stopped");
  } finally {
    fs.rmSync(f.models, { recursive: true, force: true });
  }
});

test("the rollback note reaches the chat callback once the 8B is back", async () => {
  let note = null;
  const f = makeSwitch({ healthy: true, freeGb: 40, onRollback: (text) => (note = text) });
  try {
    fs.rmSync(path.join(f.models, "Huihui-Qwen3-14B-abliterated-v2.Q4_K_M.gguf"));
    await f.switcher.request("big", { confirmed: true });
    await f.drain();
    assert.equal(note, ROLLBACK_NOTE, "the proxy posts the note into the chat");
  } finally {
    fs.rmSync(f.models, { recursive: true, force: true });
  }
});

test("paid replies and unanswered local calls never reset the idle window", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const f = makeSwitch({ healthy: true, freeGb: 40, ownClock: true });
  try {
    assert.equal(f.switcher.touchLocal("preyas"), false, "down: nothing to reset");
    await f.switcher.request("big", { confirmed: true });
    await f.drain();
    assert.equal(f.switcher.state().current, "big");
    assert.equal(f.switcher.touchLocal("paid"), false, "a paid reply never counts");
    t.mock.timers.tick(IDLE_RETURN_MS - 60_000); // 19 quiet minutes
    assert.equal(f.switcher.state().current, "big", "the paid reply held nothing open");
    assert.equal(f.switcher.touchLocal("preyas"), true, "a real local reply counts");
    t.mock.timers.tick(IDLE_RETURN_MS - 60_000); // 19 more minutes
    assert.equal(f.switcher.state().current, "big", "the local reply pushed the window out");
    t.mock.timers.tick(60_000 + 1_000); // 20 min after the last local reply
    await f.drain();
    assert.equal(f.switcher.state().current, "small", "auto-returned to the 8B");
    assert.equal(f.spawned.length, 2);
  } finally {
    fs.rmSync(f.models, { recursive: true, force: true });
  }
});

test("chatGate: a local chat during a switch gets the clear message", () => {
  const loading = { status: "loading", current: "big" };
  const refused = chatGate("preyas", loading);
  assert.equal(refused.ok, false);
  assert.equal(refused.status, 503);
  assert.equal(refused.error, SWITCHING_CHAT_MESSAGE);
  assert.equal(chatGate("paid", loading).ok, true, "paid traffic does not touch the local server");
  assert.equal(chatGate("preyas", { status: "ready", current: "small" }).ok, true);
  assert.equal(chatGate("preyas", { status: "down", current: "small" }).ok, true, "down keeps the old 503 path");
});

test("tiny is a registered tier that loads the Qwen3.5 0.8B file at 16K", async () => {
  const f = makeSwitch({ healthy: true, freeGb: 40 });
  try {
    const res = await f.switcher.request("tiny", { confirmed: true });
    await f.drain();
    assert.equal(res.ok, true, "tiny loads without a memory card");
    assert.equal(f.spawned.length, 1);
    const { args } = f.spawned[0];
    assert.equal(args[args.indexOf("-m") + 1], path.join(f.models, "Qwen3.5-0.8B-Q4_K_M.gguf"));
    assert.equal(args[args.indexOf("-c") + 1], "16384", "the tiny tier uses a 16K context");
    assert.equal(args[args.indexOf("--parallel") + 1], "1");
    assert.equal(args[args.indexOf("--host") + 1], "127.0.0.1");
  } finally {
    fs.rmSync(f.models, { recursive: true, force: true });
  }
});

test("tiny is never the default: the 8B is the idle model and the default tier", () => {
  assert.equal(DEFAULT_IDLE_MODEL, "small");
  assert.notEqual(DEFAULT_IDLE_MODEL, "tiny");
});

test("switching back from tiny to the 8B works like any other switch", async () => {
  const f = makeSwitch({ healthy: true, freeGb: 40 });
  try {
    await f.switcher.request("tiny", { confirmed: true });
    await f.drain();
    assert.equal(f.switcher.state().current, "tiny");
    await f.switcher.request("small", { confirmed: true });
    await f.drain();
    assert.equal(f.switcher.state().current, "small");
    const last = f.spawned[f.spawned.length - 1];
    assert.equal(last.args[last.args.indexOf("-m") + 1], path.join(f.models, "Huihui-Qwen3-8B-abliterated-v2.Q4_K_M.gguf"));
    assert.equal(f.spawned[0].child.killed, "SIGTERM", "the tiny server is stopped first");
  } finally {
    fs.rmSync(f.models, { recursive: true, force: true });
  }
});

test("tiny returns to the 8B after the idle window in off-grid mode", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const f = makeSwitch({ healthy: true, freeGb: 40, ownClock: true });
  try {
    await f.switcher.request("tiny", { confirmed: true });
    await f.drain();
    assert.equal(f.switcher.state().current, "tiny");
    t.mock.timers.tick(IDLE_RETURN_MS + 1_000);
    await f.drain();
    assert.equal(f.switcher.state().current, "small", "idle time brings the 8B back");
  } finally {
    fs.rmSync(f.models, { recursive: true, force: true });
  }
});

test("a missing tiny file rolls back to the 8B with the usual note", async () => {
  const f = makeSwitch({ healthy: true, freeGb: 40 });
  try {
    // The script was never run, so the tiny file is simply not there.
    fs.rmSync(path.join(f.models, "Qwen3.5-0.8B-Q4_K_M.gguf"));
    await f.switcher.request("tiny", { confirmed: true });
    await f.drain();
    // request() accepts the switch up front; the failure shows on the state.
    const st = f.switcher.state();
    assert.equal(st.status, "ready");
    assert.equal(st.current, "small", "the 8B is running again");
    assert.equal(st.rollback?.note, ROLLBACK_NOTE);
    assert.equal(f.spawned.length, 1, "only the 8B was started");
  } finally {
    fs.rmSync(f.models, { recursive: true, force: true });
  }
});
