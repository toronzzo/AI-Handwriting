#!/usr/bin/env node
/**
 * Preyas's brain, live in a terminal: one line per neuron event.
 *
 *   node brain-server/tools/brain-watch.mjs [baseUrl]
 *
 * The snapshot from GET /v1/brain fills the screen first, then every event
 * from GET /v1/brain/stream prints as one line. The watcher survives proxy
 * restarts and dropped connections; heartbeats are silent.
 */
import { readLocalToken } from "../lib/pairing.mjs";

const base = String(process.argv[2] || "http://127.0.0.1:8788").replace(/\/$/, "");
const dataDir = process.env.BAKUGAN_DATA_DIR || "/Volumes/Agent/BakuganBuddy";
const token = readLocalToken(dataDir);
const headers = { "X-Preyas-Token": token };

const COLORS = {
  thinking: "\x1b[94m",
  loading: "\x1b[93m",
  done: "\x1b[92m",
  error: "\x1b[91m",
  off: "\x1b[90m",
  missing: "\x1b[90m",
};
const RESET = "\x1b[0m";

function clock(ts) {
  return new Date(ts || Date.now()).toLocaleTimeString("en-GB", { hour12: false });
}

/** One line for one neuron entry (snapshot rows and events share the shape). */
function lineFor(entry) {
  const color = COLORS[entry.state] || "";
  const head = [clock(entry.ts), String(entry.neuron || entry.id || "?").padEnd(12), `${color}${String(entry.state || "off").padEnd(9)}${RESET}`];
  const bits = [];
  if (entry.model) bits.push(entry.model);
  if (typeof entry.tps === "number") bits.push(`${entry.tps} tok/s`);
  if (typeof entry.costUsd === "number") bits.push(`$${entry.costUsd.toFixed(4)}`);
  if (typeof entry.ramMb === "number") bits.push(`${entry.ramMb} MB`);
  if (entry.detail) bits.push(String(entry.detail));
  if (bits.length) head.push(bits.join(" · "));
  return head.join("  ");
}

async function snapshot() {
  const res = await fetch(`${base}/v1/brain`, { headers, signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`GET /v1/brain answered ${res.status}`);
  const body = await res.json();
  console.log(`Preyas brain — ${base} (ctrl-c to leave)`);
  for (const neuron of body.neurons || []) console.log(lineFor(neuron));
}

/**
 * One stream connection. The stall timer aborts the fetch only when no
 * heartbeat arrived for 45 s — the 15 s heartbeat alone must not kill it.
 */
async function streamOnce() {
  const controller = new AbortController();
  const lastActivity = { ms: Date.now() };
  const stall = setInterval(() => {
    if (Date.now() - lastActivity.ms > 45_000) controller.abort();
  }, 5000);
  if (typeof stall.unref === "function") stall.unref();
  const connect = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(`${base}/v1/brain/stream`, { headers, signal: controller.signal });
    clearTimeout(connect);
    if (!res.ok || !res.body) throw new Error(`stream answered ${res.status}`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    for (;;) {
      const step = await reader.read();
      if (step.done) return;
      lastActivity.ms = Date.now();
      buf += decoder.decode(step.value, { stream: true });
      const blocks = buf.split("\n\n");
      buf = blocks.pop() ?? "";
      for (const block of blocks) handle(block);
    }
  } finally {
    clearTimeout(connect);
    clearInterval(stall);
  }
}

function handle(block) {
  for (const raw of block.split("\n")) {
    if (!raw.startsWith("data:")) continue; // ": ping" heartbeats stay silent
    const payload = raw.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      const event = JSON.parse(payload);
      if (event && Array.isArray(event.neurons)) {
        for (const neuron of event.neurons) console.log(lineFor(neuron));
      } else if (event && event.neuron) {
        console.log(lineFor(event));
      }
    } catch {
      /* a torn chunk is not a line */
    }
  }
}

let stopping = false;
process.on("SIGINT", () => {
  stopping = true;
});

while (!stopping) {
  try {
    await snapshot();
    await streamOnce();
  } catch (error) {
    console.error(`brain-watch: ${error instanceof Error ? error.message : String(error)} — reconnecting in 3 s`);
  }
  if (!stopping) await new Promise((resolve) => setTimeout(resolve, 3000));
}
