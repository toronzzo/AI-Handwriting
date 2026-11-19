/**
 * Live Activity: the small step list under a reply ("Searched web", "Read
 * file", "Thought 5s"), the shape it travels in, and the reducer the app folds
 * poll results into.
 *
 * Pure logic only: the brain writes the events (`brain-server/lib/activity.mjs`),
 * the app polls them, both sides read the same types. Every event is
 * `v: 1` so the future Preyas OS event log can ingest the same lines unchanged.
 */

export type ActivityKind = "tool" | "thought" | "frame" | "status";
export type ActivityStatus = "running" | "done" | "error" | "stopped";

export type ActivityEvent = {
  v: 1;
  id: string;
  seq: number;
  runId: string;
  ts: number;
  kind: ActivityKind;
  tool: string;
  label: string;
  detail?: string;
  status: ActivityStatus;
  startedAt: number;
  endedAt?: number;
  durationMs?: number;
  frame?: { id: string; w: number; h: number };
};

export type ActivityIcon = "globe" | "file" | "folder" | "note" | "brain" | "screen" | "bot" | "dot";

export type ToolLabel = { running: string; done: string; icon: ActivityIcon };

/** The words and the icon for every tool the brain can report. */
export const TOOL_LABELS: Record<string, ToolLabel> = {
  search_web: { running: "Searching web…", done: "Searched web", icon: "globe" },
  read_file: { running: "Reading file…", done: "Read file", icon: "file" },
  list_files: { running: "Listing files…", done: "Listed files", icon: "folder" },
  search_notes: { running: "Searching notes…", done: "Searched notes", icon: "note" },
  save_note: { running: "Saving note…", done: "Saved note", icon: "note" },
  vault_save: { running: "Saving to vault…", done: "Saved to vault", icon: "note" },
  think: { running: "Thinking…", done: "Thought", icon: "brain" },
  screen: { running: "Watching screen…", done: "Watched screen", icon: "screen" },
  browser: { running: "Browsing…", done: "Browsed", icon: "globe" },
  harness: { running: "Harness working…", done: "Harness", icon: "bot" },
};

export const MAX_DETAIL = 120;

const KINDS: readonly ActivityKind[] = ["tool", "thought", "frame", "status"];
const STATUSES: readonly ActivityStatus[] = ["running", "done", "error", "stopped"];

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

/** Strict enough that a malformed line never reaches the UI. */
export function isActivityEvent(x: unknown): x is ActivityEvent {
  if (!isObject(x)) return false;
  if (x.v !== 1) return false;
  if (typeof x.id !== "string" || !x.id) return false;
  if (typeof x.seq !== "number" || !Number.isFinite(x.seq)) return false;
  if (typeof x.runId !== "string" || !x.runId) return false;
  if (typeof x.ts !== "number" || !Number.isFinite(x.ts)) return false;
  if (typeof x.kind !== "string" || !KINDS.includes(x.kind as ActivityKind)) return false;
  if (typeof x.tool !== "string" || !x.tool) return false;
  if (typeof x.label !== "string") return false;
  if (x.detail !== undefined && typeof x.detail !== "string") return false;
  if (typeof x.status !== "string" || !STATUSES.includes(x.status as ActivityStatus)) return false;
  if (typeof x.startedAt !== "number" || !Number.isFinite(x.startedAt)) return false;
  if (x.endedAt !== undefined && (typeof x.endedAt !== "number" || !Number.isFinite(x.endedAt))) return false;
  if (x.durationMs !== undefined && (typeof x.durationMs !== "number" || !Number.isFinite(x.durationMs))) return false;
  if (x.frame !== undefined) {
    const frame = x.frame;
    if (!isObject(frame)) return false;
    if (typeof frame.id !== "string" || !frame.id) return false;
    if (typeof frame.w !== "number" || !Number.isFinite(frame.w)) return false;
    if (typeof frame.h !== "number" || !Number.isFinite(frame.h)) return false;
  }
  return true;
}

/** One tidy line: whitespace collapsed and capped at 120 characters. */
export function clipDetail(text: unknown): string {
  const flat = String(text ?? "").replace(/\s+/g, " ").trim();
  if (flat.length <= MAX_DETAIL) return flat;
  return `${flat.slice(0, MAX_DETAIL - 1)}…`;
}

/** Whole seconds, at least one: 5.2 s reads "5s", 0.3 s reads "1s". */
export function secondsText(ms: number): string {
  const value = Number.isFinite(ms) && ms > 0 ? ms : 0;
  return `${Math.max(1, Math.round(value / 1000))}s`;
}

function toolLabel(tool: string): ToolLabel {
  return TOOL_LABELS[tool] ?? { running: `Running ${tool}…`, done: `Ran ${tool}`, icon: "dot" };
}

/**
 * The words under a step. A finished thought keeps its time ("Thought 5s");
 * a running one, or a step that ended badly, uses the table text.
 */
export function labelFor(tool: string, status: ActivityStatus, durationMs?: number): string {
  const table = toolLabel(tool);
  if (tool === "think" && status === "done") {
    return `${table.done} ${secondsText(durationMs ?? 0)}`;
  }
  return status === "running" ? table.running : table.done;
}

export function iconFor(tool: string): ActivityIcon {
  return toolLabel(tool).icon;
}

export type ActivityRun = {
  runId: string;
  /** Step ids in the order their first event arrived. */
  order: string[];
  byId: Record<string, ActivityEvent>;
  lastSeq: number;
  startedAt: number;
  endedAt?: number;
  /** True while any step in the run is still running. */
  open: boolean;
};

export type ActivityState = { runs: Record<string, ActivityRun> };

export function emptyActivity(): ActivityState {
  return { runs: {} };
}

export function runOf(state: ActivityState, runId: string): ActivityRun | undefined {
  return state.runs[runId];
}

/** `next` is the run after a change; its end is the latest moment it was seen to finish. */
function endingRun(previous: ActivityRun, next: ActivityRun): ActivityRun {
  const running = next.order.some((id) => next.byId[id]?.status === "running");
  if (running) return { ...next, open: true, endedAt: previous.endedAt };
  const lastEnd = next.order.reduce((latest, id) => {
    const ended = next.byId[id]?.endedAt;
    return typeof ended === "number" && ended > latest ? ended : latest;
  }, previous.endedAt ?? 0);
  return { ...next, open: false, endedAt: Math.max(lastEnd, next.startedAt) };
}

/**
 * Fold one event into the state. Two rules matter:
 * an event with a known id merges into that step (running -> done, adding
 * endedAt and durationMs), and an event whose seq was already passed with an
 * unknown id is a duplicate from an old poll and is dropped.
 */
export function activityReducer(state: ActivityState, event: ActivityEvent): ActivityState {
  if (!isActivityEvent(event)) return state;
  const run = state.runs[event.runId];
  if (!run) {
    if (event.status === "running") {
      const started: ActivityRun = {
        runId: event.runId,
        order: [event.id],
        byId: { [event.id]: event },
        lastSeq: event.seq,
        startedAt: event.ts,
        open: true,
      };
      return { runs: { ...state.runs, [event.runId]: started } };
    }
    const finished: ActivityRun = {
      runId: event.runId,
      order: [event.id],
      byId: { [event.id]: event },
      lastSeq: event.seq,
      startedAt: event.ts,
      endedAt: event.ts,
      open: false,
    };
    return { runs: { ...state.runs, [event.runId]: finished } };
  }
  const known = run.byId[event.id];
  if (!known) {
    if (event.seq <= run.lastSeq) return state;
    const next: ActivityRun = {
      ...run,
      order: [...run.order, event.id],
      byId: { ...run.byId, [event.id]: event },
      lastSeq: event.seq,
      startedAt: Math.min(run.startedAt, event.startedAt),
    };
    return { runs: { ...state.runs, [event.runId]: endingRun(run, next) } };
  }
  // An old, out-of-order update must not undo a newer one.
  if (event.seq < known.seq) return state;
  const merged: ActivityEvent = { ...known, ...event };
  const next: ActivityRun = {
    ...run,
    byId: { ...run.byId, [event.id]: merged },
    lastSeq: Math.max(run.lastSeq, event.seq),
    startedAt: Math.min(run.startedAt, merged.startedAt),
  };
  return { runs: { ...state.runs, [event.runId]: endingRun(run, next) } };
}

/** Fold a whole poll at once, in arrival order. */
export function foldActivity(state: ActivityState, events: readonly ActivityEvent[]): ActivityState {
  return events.reduce(activityReducer, state);
}

/** "4 steps · 12s": the one-line summary under the ACTIVITY heading. */
export function summary(run: ActivityRun | undefined): string {
  if (!run) return "";
  const steps = run.order.length;
  if (!steps) return "";
  const startedAt = run.startedAt;
  // A step that lists its own start time may be older than the run's first row.
  const first = Math.min(
    startedAt,
    ...run.order.map((id) => run.byId[id]?.startedAt ?? startedAt),
  );
  const totalMs = Math.max(0, (run.endedAt ?? Date.now()) - first);
  return `${steps} step${steps === 1 ? "" : "s"} · ${secondsText(totalMs)}`;
}

/** The newest finished step, for the polite live region. */
export function newestFinished(run: ActivityRun | undefined): ActivityEvent | null {
  if (!run) return null;
  let best: ActivityEvent | null = null;
  for (const id of run.order) {
    const step = run.byId[id];
    if (!step || step.status === "running") continue;
    if (!best || step.seq > best.seq) best = step;
  }
  return best;
}
