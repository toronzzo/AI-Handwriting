/**
 * Live neuron activity for the Brain map.
 *
 * The brain already publishes one small snapshot at GET /v1/brain:
 *   { neurons: [{ neuron, state, ramMb, tps, costUsd, detail, ts }], ts }
 * The brain events slice (N2) calls these "neurons": chat tiers, hands,
 * ears, voice and the planned drawing/memory/free-cloud slots. This module
 * turns that feed into the one thing the map needs to know: which neurons are
 * busy right now, which just finished, and which pair should carry a signal.
 *
 * Pure logic only — no React, no react-native import and no timers — so the
 * animation state can be tested under node --experimental-strip-types.
 */

export const NEURON_IDS = [
  "chat-small",
  "chat-big",
  "chat-huge",
  "hands",
  "ears",
  "voice",
  "eyes-draw",
  "memory",
  "free-cloud",
] as const;

export type NeuronId = (typeof NEURON_IDS)[number];

export const NEURON_STATES = ["off", "loading", "thinking", "done", "error", "missing"] as const;
export type NeuronState = (typeof NEURON_STATES)[number];

/** The map node a neuron is drawn on. Senses share the core. */
export type MapNodeId =
  | "core"
  | "local-model"
  | "paid-fallback"
  | "free-provider"
  | "router"
  | "drawing"
  | "memory";

export type NeuronMeta = {
  label: string;
  node: MapNodeId;
};

/**
 * The registry mirrors brain-server/lib/os/neurons.mjs. The text is the map's
 * own short label; nothing here comes from an event body.
 */
export const NEURON_META: Record<NeuronId, NeuronMeta> = {
  "chat-small": { label: "Chat small", node: "local-model" },
  "chat-big": { label: "Chat big", node: "local-model" },
  "chat-huge": { label: "Chat huge", node: "local-model" },
  hands: { label: "Hands", node: "paid-fallback" },
  ears: { label: "Ears", node: "core" },
  voice: { label: "Voice", node: "core" },
  "eyes-draw": { label: "Drawing", node: "drawing" },
  memory: { label: "Memory", node: "memory" },
  "free-cloud": { label: "Free cloud", node: "free-provider" },
};

export type NeuronRecord = {
  id: NeuronId;
  state: NeuronState;
  /** Resident model memory in MB, when the event carries it. */
  ramMb: number | null;
  tps: number | null;
  costUsd: number | null;
  /** One short, already-redacted line from the brain feed. */
  detail: string;
  /** Event time in ms, or the read time when the event has no usable ts. */
  updatedAt: number;
};

/** A pulse from one neuron (or the core) to another. */
export type NeuronSignal = {
  id: string;
  from: NeuronId | "core";
  to: NeuronId;
  at: number;
};

export type NeuronFeed = {
  /** False until the first snapshot (or event) has been folded in. */
  seeded: boolean;
  neurons: Record<string, NeuronRecord>;
  /** Active neuron ids at the last fold, in activation order. */
  active: NeuronId[];
  /** Newest last; bounded so a stable screen never grows without limit. */
  signals: NeuronSignal[];
  /** Monotonic id for signals. */
  seq: number;
  /** Time of the last successful fold; null before one. */
  receivedAt: number | null;
};

/** How long a finished neuron keeps a soft after-glow. */
export const DONE_GLOW_MS = 2_600;
/** Keep at most this many signals; the screen draws only the last four. */
export const MAX_SIGNALS = 6;

export function emptyNeuronFeed(): NeuronFeed {
  return {
    seeded: false,
    neurons: {},
    active: [],
    signals: [],
    seq: 0,
    receivedAt: null,
  };
}

export function isNeuronId(value: unknown): value is NeuronId {
  return typeof value === "string" && (NEURON_IDS as readonly string[]).includes(value);
}

export function isNeuronState(value: unknown): value is NeuronState {
  return typeof value === "string" && (NEURON_STATES as readonly string[]).includes(value);
}

/** Loading and thinking are the two states that mean "in use right now". */
export function isActiveState(state: NeuronState | undefined): boolean {
  return state === "loading" || state === "thinking";
}

export function neuronIsActive(feed: NeuronFeed, id: NeuronId): boolean {
  return isActiveState(feed.neurons[id]?.state);
}

export function activeNeuronIds(feed: NeuronFeed): NeuronId[] {
  return [...feed.active];
}

/** Finished neurons keep a very soft glow for a moment, never a hard flash. */
export function warmNeuronIds(feed: NeuronFeed, now = Date.now()): NeuronId[] {
  return NEURON_IDS.filter((id) => {
    const row = feed.neurons[id];
    if (!row || row.state !== "done") return false;
    const age = now - row.updatedAt;
    return age >= 0 && age < DONE_GLOW_MS;
  });
}

export type NodeActivity = {
  active: boolean;
  warm: boolean;
  /** Labels of the active neurons on this node, in feed order. */
  labels: string[];
};

/**
 * What one map node should show. The core represents Preyas and the senses,
 * so it is active whenever *any* neuron is active.
 */
export function nodeActivity(feed: NeuronFeed, nodeId: MapNodeId, now = Date.now()): NodeActivity {
  const warm = new Set(warmNeuronIds(feed, now));
  const ids =
    nodeId === "core"
      ? activeNeuronIds(feed)
      : NEURON_IDS.filter((id) => NEURON_META[id].node === nodeId);
  const active = ids.filter((id) => neuronIsActive(feed, id));
  return {
    active: active.length > 0,
    warm: ids.some((id) => warm.has(id)),
    labels: active.map((id) => NEURON_META[id].label),
  };
}

/** One plain line for the map header, e.g. "Chat small · Hands". */
export function activitySummary(feed: NeuronFeed, now = Date.now()): string {
  const active = activeNeuronIds(feed);
  if (active.length > 0) {
    const labels = active.slice(0, 3).map((id) => NEURON_META[id].label);
    const extra = active.length > 3 ? ` +${active.length - 3}` : "";
    return labels.join(" · ") + extra;
  }
  if (warmNeuronIds(feed, now).length > 0) return "Finishing up";
  return feed.seeded ? "Resting" : "Waiting for the brain feed";
}

/** The map node a neuron is drawn on; senses intentionally share the core. */
export function neuronToNode(id: NeuronId): MapNodeId {
  return NEURON_META[id].node;
}

function finite(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function positive(value: unknown, fallback: number): number {
  const number = finite(value);
  return number !== null && number > 0 ? number : fallback;
}

function round(value: unknown, places: number): number | null {
  const number = finite(value);
  if (number === null || number < 0) return null;
  const factor = 10 ** places;
  return Math.round(number * factor) / factor;
}

/**
 * Read one neuron row without trusting it. Unknown ids are ignored; an
 * unknown state reads as "off" rather than inventing activity.
 */
export function parseNeuronRecord(raw: unknown, now = Date.now()): NeuronRecord | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  if (!isNeuronId(row.neuron)) return null;
  const state = isNeuronState(row.state) ? row.state : "off";
  return {
    id: row.neuron,
    state,
    ramMb: round(row.ramMb, 0),
    tps: round(row.tps, 1),
    costUsd: round(row.costUsd, 6),
    detail: typeof row.detail === "string" ? row.detail.slice(0, 120) : "",
    updatedAt: positive(row.ts, now),
  };
}

/**
 * Fold a set of records into the feed, emitting a signal for each neuron that
 * became active. The first fold only seeds: an already-busy map should glow,
 * not replay a journey that happened before the screen opened.
 */
function advance(
  feed: NeuronFeed,
  neurons: Record<string, NeuronRecord>,
  now: number,
  seed: boolean,
): NeuronFeed {
  // Keep the order neurons became active: the most recently started one is
  // the caller when another begins. Re-sorting by registry order would make
  // the signal jump from the wrong node.
  const stillActive = feed.active.filter((id) => isActiveState(neurons[id]?.state));
  const started = NEURON_IDS.filter(
    (id) => isActiveState(neurons[id]?.state) && !stillActive.includes(id),
  );
  const nextActive = [...stillActive, ...started];
  let signals = feed.signals;
  let seq = feed.seq;

  if (!seed && feed.seeded) {
    const previous = feed.active;
    let from: NeuronId | "core" = previous.length > 0 ? previous[previous.length - 1]! : "core";
    for (const to of started) {
      if (from !== to) {
        seq += 1;
        signals = [...signals, { id: `neuron-signal-${seq}`, from, to, at: now }].slice(-MAX_SIGNALS);
      }
      from = to;
    }
  }

  return {
    ...feed,
    seeded: true,
    neurons,
    active: nextActive,
    signals,
    seq,
    receivedAt: now,
  };
}

/**
 * Read GET /v1/brain. A malformed or empty body leaves the last good feed
 * untouched; it never clears the map to a fake resting state.
 */
export function ingestNeuronSnapshot(feed: NeuronFeed, raw: unknown, now = Date.now()): NeuronFeed {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return feed;
  const rows = (raw as { neurons?: unknown }).neurons;
  if (!Array.isArray(rows) || rows.length === 0) return feed;

  const neurons = { ...feed.neurons };
  let read = 0;
  for (const row of rows) {
    const record = parseNeuronRecord(row, now);
    if (!record) continue;
    neurons[record.id] = record;
    read += 1;
  }
  if (read === 0) return feed;
  return advance(feed, neurons, now, !feed.seeded);
}

/**
 * Fold one SSE-shaped event. Out-of-order events are ignored: the map must
 * not unfinish a neuron because an older line arrived late.
 */
export function applyNeuronEvent(feed: NeuronFeed, raw: unknown, now = Date.now()): NeuronFeed {
  const record = parseNeuronRecord(raw, now);
  if (!record) return feed;
  const current = feed.neurons[record.id];
  if (current && record.updatedAt < current.updatedAt) return feed;
  if (
    current &&
    record.updatedAt === current.updatedAt &&
    record.state === current.state &&
    record.detail === current.detail &&
    record.ramMb === current.ramMb
  ) {
    return feed;
  }
  return advance(feed, { ...feed.neurons, [record.id]: record }, now, !feed.seeded);
}
