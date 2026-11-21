/**
 * Brain animation-state tests: which neurons are active, which just finished,
 * and which transition should carry a signal. Pure node with no react-native
 * import, so it runs under node --test.
 */
/// <reference types="node" />
import assert from "node:assert/strict";
import test from "node:test";
import {
  DONE_GLOW_MS,
  NEURON_IDS,
  NEURON_META,
  activitySummary,
  activeNeuronIds,
  applyNeuronEvent,
  emptyNeuronFeed,
  ingestNeuronSnapshot,
  isActiveState,
  neuronIsActive,
  neuronToNode,
  nodeActivity,
  parseNeuronRecord,
  warmNeuronIds,
} from "./neuronActivity.ts";

const T0 = 1_700_000_000_000;

function row(neuron: string, state: string, over: Record<string, unknown> = {}) {
  return { neuron, state, ts: T0, ...over };
}

function snapshot(...rows: Record<string, unknown>[]) {
  return { neurons: rows, ts: T0 };
}

test("an empty feed is not pretending to be active", () => {
  const feed = emptyNeuronFeed();
  assert.deepEqual(activeNeuronIds(feed), []);
  assert.equal(feed.seeded, false);
  assert.equal(activitySummary(feed, T0), "Waiting for the brain feed");
  assert.equal(nodeActivity(feed, "local-model", T0).active, false);
});

test("the first snapshot seeds active neurons without replaying a signal", () => {
  const feed = ingestNeuronSnapshot(
    emptyNeuronFeed(),
    snapshot(row("chat-small", "thinking"), row("ears", "thinking"), row("hands", "off")),
    T0,
  );

  assert.equal(feed.seeded, true);
  assert.deepEqual(activeNeuronIds(feed), ["chat-small", "ears"]);
  assert.equal(feed.signals.length, 0);
  assert.equal(activitySummary(feed, T0), "Chat small · Ears");
});

test("loading and thinking count as active; done goes quiet but stays warm briefly", () => {
  let feed = ingestNeuronSnapshot(emptyNeuronFeed(), snapshot(row("chat-small", "loading")), T0);
  assert.equal(neuronIsActive(feed, "chat-small"), true);

  feed = applyNeuronEvent(feed, row("chat-small", "done", { ts: T0 + 100, ramMb: 8_140, tps: 9.4 }), T0 + 120);
  assert.equal(neuronIsActive(feed, "chat-small"), false);
  assert.deepEqual(activeNeuronIds(feed), []);
  assert.deepEqual(warmNeuronIds(feed, T0 + 1_000), ["chat-small"]);
  assert.equal(activitySummary(feed, T0 + 1_000), "Finishing up");

  assert.deepEqual(warmNeuronIds(feed, T0 + 100 + DONE_GLOW_MS), []);
  assert.equal(activitySummary(feed, T0 + 100 + DONE_GLOW_MS), "Resting");
  assert.equal(feed.neurons["chat-small"]?.ramMb, 8_140);
});

test("a second neuron starting emits a signal from the one already active", () => {
  let feed = ingestNeuronSnapshot(emptyNeuronFeed(), snapshot(row("chat-small", "thinking")), T0);
  feed = applyNeuronEvent(feed, row("hands", "thinking", { ts: T0 + 500 }), T0 + 520);

  assert.deepEqual(activeNeuronIds(feed), ["chat-small", "hands"]);
  assert.equal(feed.signals.length, 1);
  assert.equal(feed.signals[0]?.from, "chat-small");
  assert.equal(feed.signals[0]?.to, "hands");
  assert.match(feed.signals[0]?.id || "", /^neuron-signal-/);
});

test("the most recently started neuron is the caller for the next one", () => {
  let feed = ingestNeuronSnapshot(
    emptyNeuronFeed(),
    snapshot(row("chat-small", "thinking"), row("chat-big", "off"), row("hands", "off")),
    T0,
  );
  feed = applyNeuronEvent(feed, row("chat-big", "thinking", { ts: T0 + 100 }), T0 + 110);
  feed = applyNeuronEvent(feed, row("hands", "thinking", { ts: T0 + 200 }), T0 + 210);

  assert.deepEqual(feed.active, ["chat-small", "chat-big", "hands"]);
  assert.deepEqual(
    feed.signals.map((signal) => [signal.from, signal.to]),
    [
      ["chat-small", "chat-big"],
      ["chat-big", "hands"],
    ],
  );
});

test("an initial activation travels from the core", () => {
  let feed = ingestNeuronSnapshot(emptyNeuronFeed(), snapshot(row("chat-small", "off")), T0);
  feed = applyNeuronEvent(feed, row("hands", "thinking", { ts: T0 + 50 }), T0 + 60);

  assert.equal(feed.signals.length, 1);
  assert.equal(feed.signals[0]?.from, "core");
  assert.equal(feed.signals[0]?.to, "hands");
});

test("finishing a neuron does not emit a signal", () => {
  let feed = ingestNeuronSnapshot(emptyNeuronFeed(), snapshot(row("chat-small", "thinking"), row("hands", "off")), T0);
  feed = applyNeuronEvent(feed, row("chat-small", "done", { ts: T0 + 200 }), T0 + 210);
  assert.equal(feed.signals.length, 0);
});

test("chat tiers share the local model node; hands and senses map to theirs", () => {
  const feed = ingestNeuronSnapshot(
    emptyNeuronFeed(),
    snapshot(
      row("chat-small", "thinking"),
      row("chat-big", "loading"),
      row("hands", "thinking"),
      row("ears", "thinking"),
      row("eyes-draw", "off"),
    ),
    T0,
  );

  const local = nodeActivity(feed, "local-model", T0);
  assert.equal(local.active, true);
  assert.deepEqual(local.labels, ["Chat small", "Chat big"]);

  const paid = nodeActivity(feed, "paid-fallback", T0);
  assert.equal(paid.active, true);
  assert.deepEqual(paid.labels, ["Hands"]);

  const core = nodeActivity(feed, "core", T0);
  assert.equal(core.active, true);
  assert.ok(core.labels.includes("Ears"));

  assert.equal(nodeActivity(feed, "drawing", T0).active, false);
  assert.equal(neuronToNode("free-cloud"), "free-provider");
  assert.equal(neuronToNode("memory"), "memory");
  assert.equal(neuronToNode("hands"), "paid-fallback");
});

test("every feed neuron has a label and a map home", () => {
  for (const id of NEURON_IDS) {
    assert.ok(NEURON_META[id].label.length > 0, id + " label");
    assert.ok(NEURON_META[id].node.length > 0, id + " node");
  }
});

test("a late, older event cannot unfinish a neuron", () => {
  let feed = ingestNeuronSnapshot(emptyNeuronFeed(), snapshot(row("chat-small", "done", { ts: T0 + 2_000 })), T0 + 2_000);
  feed = applyNeuronEvent(feed, row("chat-small", "thinking", { ts: T0 + 1_000 }), T0 + 2_100);

  assert.equal(feed.neurons["chat-small"]?.state, "done");
  assert.deepEqual(activeNeuronIds(feed), []);
});

test("malformed, unknown and empty bodies are ignored, never turned into activity", () => {
  const feed = ingestNeuronSnapshot(emptyNeuronFeed(), snapshot(row("chat-small", "thinking")), T0);

  assert.equal(ingestNeuronSnapshot(feed, null, T0), feed);
  assert.equal(ingestNeuronSnapshot(feed, { neurons: [] }, T0), feed);
  assert.equal(ingestNeuronSnapshot(feed, { neurons: "nope" }, T0), feed);
  assert.equal(ingestNeuronSnapshot(feed, snapshot({ neuron: "unknown", state: "thinking" }), T0), feed);

  const badState = applyNeuronEvent(feed, row("handss", "thinking", { ts: T0 + 1 }), T0 + 2);
  assert.equal(badState, feed);
  const unknownState = applyNeuronEvent(feed, row("hands", "flying", { ts: T0 + 1 }), T0 + 2);
  assert.equal(unknownState.neurons["hands"]?.state, "off");
});

test("parse keeps only sane numbers and clips detail", () => {
  const parsed = parseNeuronRecord(
    { neuron: "hands", state: "done", ramMb: "12.6", tps: "9.44", costUsd: 0.00123456, detail: "x".repeat(500), ts: T0 },
    T0,
  );
  assert.ok(parsed);
  assert.equal(parsed.ramMb, 13);
  assert.equal(parsed.tps, 9.4);
  assert.equal(parsed.costUsd, 0.001235);
  assert.equal(parsed.detail.length, 120);

  const bad = parseNeuronRecord({ neuron: "hands", state: "done", ramMb: -4, tps: "fast", ts: T0 }, T0);
  assert.ok(bad);
  assert.equal(bad.ramMb, null);
  assert.equal(bad.tps, null);
  assert.equal(bad.updatedAt, T0);
});

test("the summary caps long active lists without hiding that there are more", () => {
  const feed = ingestNeuronSnapshot(
    emptyNeuronFeed(),
    snapshot(
      row("chat-small", "thinking"),
      row("hands", "thinking"),
      row("ears", "thinking"),
      row("voice", "thinking"),
    ),
    T0,
  );
  assert.equal(activitySummary(feed, T0), "Chat small · Hands · Ears +1");
});

test("the active-state helper agrees with the feed state", () => {
  assert.equal(isActiveState("thinking"), true);
  assert.equal(isActiveState("loading"), true);
  assert.equal(isActiveState("done"), false);
  assert.equal(isActiveState(undefined), false);
});
