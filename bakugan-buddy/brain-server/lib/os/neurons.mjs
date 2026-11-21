/**
 * Preyas's brain events (MODEL_BRAIN_PLAN.md, slice N2).
 *
 * The neuron registry, the one event bus every model and tool reports into,
 * the append-only JSONL log (<dataDir>/brain/YYYY-MM.jsonl) and the fan-out
 * the GET /v1/brain/stream route subscribes to. Emitting is a nicety: it
 * never throws into a chat flow, and a missing drive only silences the log.
 *
 * Event shape on the wire and in the log:
 *   { neuron, state, ramMb, tps, costUsd, detail, ts }
 * States: off, loading, thinking, done, error, missing.
 * `ramMb` is the llama-server's resident memory for chat neurons, null
 * everywhere else.
 */
import fs from "node:fs";
import path from "node:path";

export const BRAIN_STATES = ["off", "loading", "thinking", "done", "error", "missing"];

/**
 * The registry from the plan. `built` is true for the neurons this slice (or
 * an earlier one) already reports; eyes-draw, memory and free-cloud arrive in
 * later slices and stay "missing" until then.
 */
export const NEURONS = [
  { id: "chat-small", name: "Chat small", kind: "chat", model: "Qwen3-8B Q4_K_M", where: "local", built: true },
  { id: "chat-big", name: "Chat big", kind: "chat", model: "Qwen3-14B Q4_K_M", where: "local", built: true },
  { id: "chat-huge", name: "Chat huge", kind: "chat", model: "Qwen3-30B-A3B Q3_K_M", where: "local", built: true },
  { id: "hands", name: "Hands", kind: "tools", model: "DeepSeek Flash (gateway :4000)", where: "cloud", built: true },
  { id: "ears", name: "Ears", kind: "speech", model: "Whisper", where: "local", built: true },
  { id: "voice", name: "Voice", kind: "speech", model: "Piper", where: "local", built: true },
  { id: "eyes-draw", name: "Eyes (draw)", kind: "image", model: "SDXL / FLUX.1-schnell", where: "local", built: false },
  { id: "memory", name: "Memory", kind: "search", model: "bge-small embeddings", where: "local", built: false },
  { id: "free-cloud", name: "Free cloud", kind: "chat", model: "Gemini / Groq / OpenRouter free tiers", where: "cloud", built: false },
];

export function neuronById(id) {
  return NEURONS.find((neuron) => neuron.id === String(id)) || null;
}

/** The brain folder on the drive; events are one file per local month. */
export function brainLogDir(dataDir) {
  return path.join(dataDir, "brain");
}

/** "YYYY-MM" of a timestamp in the machine's own time zone. */
export function monthKey(ts) {
  const map = {};
  for (const part of new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit" }).formatToParts(new Date(ts))) {
    map[part.type] = part.value;
  }
  return `${map.year}-${map.month}`;
}

export function brainLogFile(dataDir, ts) {
  return path.join(brainLogDir(dataDir), `${monthKey(ts)}.jsonl`);
}

export function createBrain(options = {}) {
  const {
    dataDir = process.env.BAKUGAN_DATA_DIR || "",
    now = () => Date.now(),
  } = options;
  /** id -> last event; the registry snapshot reads from here. */
  const last = new Map();
  const listeners = new Set();

  const asState = (state) => (BRAIN_STATES.includes(state) ? state : "off");
  const asNumber = (value, round) => {
    if (value === null || value === undefined || value === "") return null;
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? round(n) : null;
  };
  const asTps = (value) => asNumber(value, (n) => Math.round(n * 10) / 10);
  const asRam = (value) => asNumber(value, (n) => Math.round(n));
  const asCost = (value) => asNumber(value, (n) => Math.round(n * 1e6) / 1e6);
  const asDetail = (value) => {
    if (value === null || value === undefined) return null;
    const text = String(value);
    return text ? text.slice(0, 200) : null;
  };

  /** Every neuron with its live state, in registry order. */
  function neurons() {
    return NEURONS.map((def) => {
      const event = last.get(def.id);
      return {
        ...def,
        state: event ? event.state : def.built ? "off" : "missing",
        ts: event ? event.ts : null,
        ramMb: event ? event.ramMb : null,
        tps: event ? event.tps : null,
        costUsd: event ? event.costUsd : null,
        detail: event ? event.detail : null,
      };
    });
  }

  /**
   * Record one event: update the in-memory state, append to today's JSONL
   * file, then tell every subscriber. Never throws; a bad event is still
   * logged under its neuron id and only the snapshot ignores unknown ids.
   */
  function emit(input = {}) {
    const ts = Number(input.ts) > 0 ? Number(input.ts) : now();
    const record = {
      neuron: String(input.neuron || ""),
      state: asState(input.state),
      ramMb: asRam(input.ramMb),
      tps: asTps(input.tps),
      costUsd: asCost(input.costUsd),
      detail: asDetail(input.detail),
      ts,
    };
    if (!record.neuron) return record;
    last.set(record.neuron, record);
    if (dataDir) {
      try {
        fs.mkdirSync(brainLogDir(dataDir), { recursive: true });
        fs.appendFileSync(brainLogFile(dataDir, ts), JSON.stringify(record) + "\n");
      } catch {
        /* the drive may be gone; events stay in memory */
      }
    }
    for (const fn of [...listeners]) {
      try {
        fn(record);
      } catch {
        /* a broken viewer must not break the brain */
      }
    }
    return record;
  }

  /** Watch events live; returns an unsubscribe function. */
  function subscribe(fn) {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }

  return { emit, neurons, subscribe };
}

let sharedInstance = null;

/**
 * The one brain for the whole proxy process. The first call decides the
 * dataDir (proxy.mjs passes its own), later calls just return the instance.
 */
export function sharedBrain(dataDir) {
  if (!sharedInstance) {
    sharedInstance = createBrain({ dataDir: dataDir ?? process.env.BAKUGAN_DATA_DIR ?? "" });
  }
  return sharedInstance;
}

/** Test-only injection; the proxy never calls this. */
export function _setSharedBrainForTests(brain) {
  sharedInstance = brain;
}
