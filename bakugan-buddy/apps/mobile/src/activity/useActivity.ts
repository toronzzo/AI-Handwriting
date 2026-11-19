/**
 * Poll the brain for the steps of one run. The brain has no stream, so this
 * follows the same 1 s cursor poll the task card uses: ask for everything
 * newer than the last seq we saw, fold it with the shared reducer.
 *
 * `pushLocal` adds a step the client itself measured (thinking time), and
 * `markDone` closes a local step that is still running.
 */
import { useEffect, useRef, useState } from "react";
import { activityReducer, emptyActivity, type ActivityEvent, type ActivityState } from "../../../../packages/alive/src/activity.ts";
import { brainFetch } from "../room/brain/token";
import { usePageVisible } from "../ui/usePageVisible";

export const ACTIVITY_POLL_MS = 1000;

export type ActivitySink = {
  state: ActivityState;
  /** A brand new run must not inherit the previous cursor. */
  resubscribe: () => void;
  /** Add a step the client measured itself; returns its id. */
  pushLocal: (event: Omit<ActivityEvent, "v" | "id" | "seq" | "ts" | "runId" | "startedAt" | "label"> & Partial<ActivityEvent>) => string;
  /** Finish a local step (running -> done) with the measured duration. */
  markDone: (id: string, endedAt?: number) => void;
};

let localSeq = 0;
let localRun = 0;

export function useActivity({ runId, active, brainUrl }: { runId: string; active: boolean; brainUrl?: string }): ActivitySink {
  const [state, setState] = useState<ActivityState>(emptyActivity);
  const lastSeq = useRef(0);
  const visible = usePageVisible();
  const base = brainUrl || "";
  const idRef = useRef(`l-${Date.now()}-${(localRun += 1)}`);
  const [attempt, setAttempt] = useState(0);

  /** A new run starts from seq 0 with an empty feed. */
  const resubscribe = () => {
    lastSeq.current = 0;
    setState(emptyActivity());
    setAttempt((count) => count + 1);
  };

  useEffect(() => {
    if (!runId || !active || !visible || !base) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      if (cancelled) return;
      try {
        const res = await brainFetch(
          `${base}/v1/activity?after=${lastSeq.current}&run=${encodeURIComponent(runId)}`,
        );
        if (res.ok) {
          const body = (await res.json()) as { events?: ActivityEvent[]; last?: number };
          const events = Array.isArray(body.events) ? body.events : [];
          if (!cancelled && events.length) {
            lastSeq.current = Math.max(lastSeq.current, ...events.map((event) => Number(event.seq) || 0));
            setState((previous) => events.reduce(activityReducer, previous));
          }
        }
      } catch {
        // The brain may be restarting; keep polling quietly.
      }
      if (!cancelled) timer = setTimeout(poll, ACTIVITY_POLL_MS);
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [runId, active, visible, base, attempt]);

  // One last look when the run closes, so the final step is never missing.
  useEffect(() => {
    if (active || !runId || !base) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await brainFetch(
          `${base}/v1/activity?after=${lastSeq.current}&run=${encodeURIComponent(runId)}`,
        );
        if (!res.ok || cancelled) return;
        const body = (await res.json()) as { events?: ActivityEvent[] };
        const events = Array.isArray(body.events) ? body.events : [];
        if (!cancelled && events.length) {
          lastSeq.current = Math.max(lastSeq.current, ...events.map((event) => Number(event.seq) || 0));
          setState((previous) => events.reduce(activityReducer, previous));
        }
      } catch {
        /* the last poll is best effort */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active, runId, base]);

  const pushLocal: ActivitySink["pushLocal"] = (partial) => {
    const now = Date.now();
    localSeq += 1;
    const event: ActivityEvent = {
      v: 1,
      id: `${idRef.current}-${localSeq}`,
      seq: lastSeq.current + localSeq,
      runId,
      ts: now,
      startedAt: now,
      label: "",
      ...partial,
      kind: partial.kind ?? "thought",
      tool: partial.tool ?? "think",
      status: partial.status ?? "running",
    };
    setState((previous) => activityReducer(previous, event));
    return event.id;
  };

  const markDone = (id: string, endedAt = Date.now()) => {
    setState((previous) => {
      const run = previous.runs[runId];
      const step = run?.byId[id];
      if (!run || !step || step.status !== "running") return previous;
      return activityReducer(previous, {
        ...step,
        status: "done",
        endedAt,
        durationMs: Math.max(0, endedAt - step.startedAt),
      });
    });
  };

  return { state, resubscribe, pushLocal, markDone };
}
