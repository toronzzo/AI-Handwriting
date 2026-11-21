import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { BRAIN_STATES, brainLogFile, createBrain, NEURONS, neuronById, sharedBrain, _setSharedBrainForTests } from "./neurons.mjs";

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "neurons-test-"));
}

test("the registry lists the nine neurons from the plan", () => {
  assert.deepEqual(
    NEURONS.map((neuron) => neuron.id),
    ["chat-small", "chat-big", "chat-huge", "hands", "ears", "voice", "eyes-draw", "memory", "free-cloud"],
  );
  const chatSmall = neuronById("chat-small");
  assert.equal(chatSmall.kind, "chat");
  assert.equal(chatSmall.model, "Qwen3-8B Q4_K_M");
  assert.equal(chatSmall.where, "local");
  assert.equal(neuronById("chat-big").model, "Qwen3-14B Q4_K_M");
  assert.equal(neuronById("chat-huge").model, "Qwen3-30B-A3B Q3_K_M");
  assert.equal(neuronById("hands").where, "cloud");
  assert.match(neuronById("hands").model, /DeepSeek Flash/);
  assert.equal(neuronById("ears").model, "Whisper");
  assert.equal(neuronById("voice").where, "local");
  assert.equal(neuronById("free-cloud").where, "cloud");
  assert.equal(neuronById("nope"), null);
});

test("built neurons start off, unbuilt ones start missing", () => {
  const brain = createBrain({ dataDir: "" });
  for (const neuron of brain.neurons()) {
    if (["eyes-draw", "memory", "free-cloud"].includes(neuron.id)) {
      assert.equal(neuron.state, "missing", `${neuron.id} should be missing`);
    } else {
      assert.equal(neuron.state, "off", `${neuron.id} should start off`);
    }
    assert.equal(neuron.ts, null);
  }
});

test("emit changes one neuron's state and keeps its numbers", () => {
  const brain = createBrain({ dataDir: "", now: () => 1000 });
  brain.emit({ neuron: "chat-small", state: "thinking" });
  assert.equal(brain.neurons().find((neuron) => neuron.id === "chat-small").state, "thinking");

  const done = brain.emit({
    neuron: "chat-small",
    state: "done",
    tps: 12.34,
    costUsd: 0.00021,
    ramMb: 5120,
    detail: "a short answer",
    ts: 1000,
  });
  assert.equal(done.ts, 1000);
  assert.equal(done.state, "done");

  const small = brain.neurons().find((neuron) => neuron.id === "chat-small");
  assert.equal(small.state, "done");
  assert.equal(small.tps, 12.3);
  assert.equal(small.costUsd, 0.00021);
  assert.equal(small.ramMb, 5120);
  assert.equal(small.detail, "a short answer");
  assert.equal(small.ts, 1000);
  // Every other neuron is untouched.
  assert.equal(brain.neurons().find((neuron) => neuron.id === "hands").state, "off");
});

test("every state in BRAIN_STATES round-trips through emit", () => {
  const brain = createBrain({ dataDir: "" });
  for (const state of BRAIN_STATES) {
    const event = brain.emit({ neuron: "ears", state });
    assert.equal(event.state, state);
    assert.equal(brain.neurons().find((neuron) => neuron.id === "ears").state, state);
  }
});

test("a bad state or an unknown neuron never throws", () => {
  const brain = createBrain({ dataDir: "" });
  const event = brain.emit({ neuron: "nope", state: "flying", ts: 5 });
  assert.equal(event.state, "off", "unknown states fall back to off");
  assert.equal(event.neuron, "nope");
  assert.equal(event.ts, 5);
  assert.doesNotThrow(() => brain.emit({}));
});

test("explicit null numbers stay null, never zero", () => {
  const brain = createBrain({ dataDir: "" });
  const event = brain.emit({ neuron: "ears", state: "done", tps: null, costUsd: null, ramMb: null });
  assert.equal(event.tps, null);
  assert.equal(event.costUsd, null);
  assert.equal(event.ramMb, null);
  const ears = brain.neurons().find((neuron) => neuron.id === "ears");
  assert.equal(ears.tps, null);
  assert.equal(ears.costUsd, null);
  assert.equal(ears.ramMb, null);
});

test("a detail is trimmed to 200 characters", () => {
  const brain = createBrain({ dataDir: "" });
  const event = brain.emit({ neuron: "voice", state: "done", detail: "x".repeat(500) });
  assert.equal(event.detail.length, 200);
});

test("subscribers get every event until they unsubscribe", () => {
  const brain = createBrain({ dataDir: "" });
  const seen = [];
  const off = brain.subscribe((event) => seen.push(event));
  brain.emit({ neuron: "ears", state: "thinking" });
  brain.emit({ neuron: "ears", state: "done" });
  assert.equal(seen.length, 2);
  assert.equal(seen[0].neuron, "ears");
  assert.equal(seen[0].state, "thinking");
  off();
  brain.emit({ neuron: "ears", state: "error" });
  assert.equal(seen.length, 2);
});

test("a broken subscriber does not break the brain or the other subscribers", () => {
  const brain = createBrain({ dataDir: "" });
  const seen = [];
  brain.subscribe(() => {
    throw new Error("broken viewer");
  });
  brain.subscribe((event) => seen.push(event));
  brain.emit({ neuron: "ears", state: "thinking" });
  assert.equal(seen.length, 1);
});

test("the jsonl log is append-only and only grows", () => {
  const dir = tempDir();
  try {
    const brain = createBrain({ dataDir: dir, now: () => 1_700_000_000_000 });
    brain.emit({ neuron: "chat-small", state: "thinking", ts: 1_700_000_000_000 });
    brain.emit({ neuron: "chat-small", state: "done", tps: 5.5, ts: 1_700_000_000_100 });

    const file = brainLogFile(dir, 1_700_000_000_000);
    assert.match(path.basename(file), /^\d{4}-\d{2}\.jsonl$/, "one file per month, named YYYY-MM");
    assert.equal(fs.existsSync(file), true);
    const first = fs.readFileSync(file, "utf8");
    assert.equal(first.trim().split("\n").length, 2);

    // A second brain on the same folder appends; it never rewrites.
    const again = createBrain({ dataDir: dir, now: () => 1_700_000_000_200 });
    again.emit({ neuron: "voice", state: "done", ts: 1_700_000_000_200 });

    const second = fs.readFileSync(file, "utf8");
    assert.ok(second.startsWith(first), "old lines are never touched");
    const lines = second.trim().split("\n").map((line) => JSON.parse(line));
    assert.deepEqual(
      lines.map((line) => line.neuron),
      ["chat-small", "chat-small", "voice"],
    );
    assert.deepEqual(Object.keys(lines[1]).sort(), ["costUsd", "detail", "neuron", "ramMb", "state", "tps", "ts"].sort());
    assert.equal(lines[1].tps, 5.5);
    assert.equal(lines[1].costUsd, null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("events stay in memory when the drive is missing", () => {
  const brain = createBrain({ dataDir: "" });
  const event = brain.emit({ neuron: "ears", state: "done" });
  assert.equal(event.state, "done");
  assert.equal(brain.neurons().find((neuron) => neuron.id === "ears").state, "done");
});

test("sharedBrain is one instance, and test injection replaces it", () => {
  const one = sharedBrain("/tmp/irrelevant");
  assert.equal(sharedBrain("/other"), one);
  const fake = { emit() {}, neurons() {} };
  _setSharedBrainForTests(fake);
  assert.equal(sharedBrain(), fake);
  _setSharedBrainForTests(null);
});
