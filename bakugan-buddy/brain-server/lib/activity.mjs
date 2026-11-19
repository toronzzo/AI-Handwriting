/**
 * Live Activity: every step Preyas takes is one small event ("Searched web",
 * "Read file", "Thought 5s"). The app polls them; there is no stream here.
 *
 * The hub keeps the newest 500 in memory and, when a data dir is given, also
 * appends each one as a JSON line to `<dataDir>/activity/YYYY-MM-DD.jsonl`
 * (local date, append only, never deleted) so the future Preyas OS event log
 * can ingest the same lines.
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { clipDetail, isActivityEvent } from "../../packages/alive/src/activity.ts";

export const RING_SIZE = 500;

/** Anything that looks like a key never reaches memory, the file or the app. */
export const REDACTED = "[redacted]";
const SECRET_PATTERNS = [/\bsk-[A-Za-z0-9_-]{8,}/g, /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi];
const SECRET_LINE = /(?:^|[\s,;])([A-Z][A-Z0-9_]*(?:KEY|TOKEN|PASSWORD|SECRET)[A-Z0-9_]*)\s*[:=]\s*["']?([^\s"',;]+)/gi;

/** Hide `sk-…`, `Bearer …` and the value of any KEY/TOKEN/PASSWORD/SECRET line. */
export function redactSecrets(text) {
  let out = String(text ?? "");
  for (const pattern of SECRET_PATTERNS) out = out.replace(pattern, REDACTED);
  out = out.replace(SECRET_LINE, (_all, name) => `${name}=${REDACTED}`);
  return out;
}

/** Exact values that must never be logged, such as what the proxy read from .env. */
function secretValues(values) {
  return (Array.isArray(values) ? values : []).map((item) => String(item ?? "")).filter(Boolean);
}

function hideKnown(text, values) {
  let out = text;
  for (const value of values) {
    if (value.length >= 4 && out.includes(value)) out = out.split(value).join(REDACTED);
  }
  return out;
}

function clean(value, values) {
  if (value === undefined || value === null) return undefined;
  return clipDetail(hideKnown(redactSecrets(value), values));
}

/** Local calendar day, the same YYYY-MM-DD the rest of the drive uses. */
export function dayKey(ts) {
  const date = new Date(ts);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * @param {object} options
 * @param {string} [options.dataDir]  when set, events are also appended to activity/YYYY-MM-DD.jsonl
 * @param {() => number} [options.now]
 * @param {number} [options.ringSize]
 * @param {string[]} [options.secrets]  exact values that must never be logged
 */
export function createActivityHub({ dataDir = "", now = Date.now, ringSize = RING_SIZE, secrets = [] } = {}) {
  const ring = [];
  const hidden = secretValues(secrets);
  const size = Math.max(1, Number(ringSize) || RING_SIZE);
  let seq = 0;

  function appendToFile(event) {
    if (!dataDir) return;
    try {
      const dir = path.join(dataDir, "activity");
      fs.mkdirSync(dir, { recursive: true });
      fs.appendFileSync(path.join(dir, `${dayKey(event.ts)}.jsonl`), `${JSON.stringify(event)}\n`);
    } catch {
      // The feed still works from memory when the drive is read-only.
    }
  }

  function emit(partial) {
    const values = [...hidden, ...secretValues(partial?.secrets)];
    const ts = Number.isFinite(partial?.ts) ? partial.ts : now();
    const nextSeq = seq + 1;
    const event = {
      v: 1,
      id: String(partial?.id || randomUUID()),
      seq: nextSeq,
      runId: String(partial?.runId || "adhoc"),
      ts,
      kind: partial?.kind || "tool",
      tool: String(partial?.tool || ""),
      label: clean(partial?.label, values) ?? "",
      status: partial?.status || "running",
      startedAt: Number.isFinite(partial?.startedAt) ? partial.startedAt : ts,
    };
    const detail = clean(partial?.detail, values);
    if (detail) event.detail = detail;
    if (Number.isFinite(partial?.endedAt)) event.endedAt = partial.endedAt;
    if (Number.isFinite(partial?.durationMs)) event.durationMs = partial.durationMs;
    if (partial?.frame && typeof partial.frame === "object") {
      event.frame = { id: String(partial.frame.id || ""), w: Number(partial.frame.w) || 0, h: Number(partial.frame.h) || 0 };
    }
    if (!isActivityEvent(event)) return null;
    seq = nextSeq;
    ring.push(event);
    while (ring.length > size) ring.shift();
    appendToFile(event);
    return event;
  }

  /**
   * One step: a running event now and a finishing event when done(), fail() or
   * stop() is called. The finishing event reuses the id, so the app merges it
   * into the same row.
   */
  function begin(runId, tool, detail) {
    const startedAt = now();
    const first = emit({ kind: tool === "think" ? "thought" : "tool", tool, runId: String(runId || "adhoc"), detail, status: "running", startedAt, ts: startedAt });
    const id = first?.id || randomUUID();
    let ended = false;
    const finish = (status, nextDetail) => {
      if (ended) return null;
      ended = true;
      const at = now();
      const shownDetail = nextDetail !== undefined && nextDetail !== null ? nextDetail : detail;
      return emit({
        id,
        kind: tool === "think" ? "thought" : "tool",
        tool,
        runId: String(runId || "adhoc"),
        detail: shownDetail,
        status,
        startedAt,
        ts: at,
        endedAt: at,
        durationMs: Math.max(0, at - startedAt),
      });
    };
    return {
      id,
      done: (nextDetail) => finish("done", nextDetail),
      fail: (nextDetail) => finish("error", nextDetail),
      stop: (nextDetail) => finish("stopped", nextDetail),
    };
  }

  function since(afterSeq = 0, { runId = "", limit = 200 } = {}) {
    const after = Number.isFinite(Number(afterSeq)) ? Number(afterSeq) : 0;
    const cap = Math.min(Math.max(1, Number(limit) || 200), 500);
    const events = ring.filter((event) => event.seq > after && (!runId || event.runId === runId)).slice(0, cap);
    const last = events.length ? events[events.length - 1].seq : after;
    return { events, last };
  }

  return {
    emit,
    begin,
    since,
    ring,
    get size() {
      return ring.length;
    },
  };
}
