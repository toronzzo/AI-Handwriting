/**
 * The Generate button's data: one draft, one yes/no answer, the live status.
 *
 * The brain owns every decision (prices, cap, draft expiry, single run); this
 * hook only carries JSON back and forth. Safety rule it follows: the status is
 * polled every 1.5 s only while a run is actually running AND the page is
 * visible, so an open tab does not hammer the Mac.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { currentBrainUrl } from "../room/brain/brainLink";
import { brainFetch } from "../room/brain/token";
import { usePageVisible } from "../ui/usePageVisible";

export const HARNESS_POLL_MS = 1500;

export type HarnessState = "idle" | "running" | "done" | "stopped" | "error";

export type HarnessStatus = {
  state: HarnessState;
  runId: string;
  startedAt: number;
  adapter: "cli" | "fake" | "not-configured" | string;
  spentTodayUsd: number;
  capUsd: number;
  summary?: string;
  prUrl?: string;
};

export type HarnessEstimate = {
  inTokens: number;
  outTokensMax: number;
  usdLow: number;
  usdHigh: number;
  basis: string;
} | null;

export type HarnessDraft = {
  id: string;
  prompt: string;
  hash: string;
  estimate: HarnessEstimate;
  createdAt: number;
  startedBy: string;
  used: boolean;
};

export type HarnessCanStart = { ok: boolean; code?: string; reason?: string };

export type HarnessDraftResult = {
  draft: HarnessDraft;
  spentTodayUsd: number;
  capUsd: number;
  canStart: HarnessCanStart;
};

type Json = Record<string, unknown>;

async function readJson(response: Response): Promise<Json> {
  try {
    return (await response.json()) as Json;
  } catch {
    return {};
  }
}

export function useHarness(chatId: string | null) {
  const base = currentBrainUrl();
  const visible = usePageVisible();
  const [status, setStatus] = useState<HarnessStatus | null>(null);
  const [result, setResult] = useState<HarnessDraftResult | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const chatRef = useRef<string | null>(chatId);
  chatRef.current = chatId;

  const refresh = useCallback(async () => {
    try {
      const response = await brainFetch(`${base}/v1/harness/status`);
      if (!response.ok) return;
      const body = await readJson(response);
      setStatus({
        state: (typeof body.state === "string" ? body.state : "idle") as HarnessState,
        runId: String(body.runId ?? ""),
        startedAt: Number(body.startedAt) || 0,
        adapter: String(body.adapter ?? "not-configured"),
        spentTodayUsd: Number(body.spentTodayUsd) || 0,
        capUsd: Number(body.capUsd) || 0,
        ...(typeof body.summary === "string" && body.summary ? { summary: body.summary } : {}),
        ...(typeof body.prUrl === "string" && body.prUrl ? { prUrl: body.prUrl } : {}),
      });
    } catch {
      // The Mac may be restarting; the next poll catches up.
    }
  }, [base]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Poll only while a run is going and the page is visible.
  useEffect(() => {
    if (!visible || status?.state !== "running") return;
    let cancelled = false;
    const timer = setInterval(() => {
      if (!cancelled) void refresh();
    }, HARNESS_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [visible, status?.state, refresh]);

  /** Ask for a draft. The brain prices it; no run starts here. */
  const draft = useCallback(
    async (goal: string): Promise<HarnessDraftResult | null> => {
      setBusy(true);
      setError("");
      try {
        const response = await brainFetch(`${base}/v1/harness/draft`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ goal, chatId: chatRef.current || "" }),
        });
        const body = await readJson(response);
        if (!response.ok) {
          setError(String(body.error ?? "Could not draft the prompt."));
          return null;
        }
        const next = body as unknown as HarnessDraftResult;
        setResult(next);
        return next;
      } catch {
        setError("The Mac did not answer. Is Preyas running?");
        return null;
      } finally {
        setBusy(false);
      }
    },
    [base],
  );

  /** Да or Нет. "no" only discards the draft; the brain starts nothing either way. */
  const answer = useCallback(
    async (verb: "yes" | "no"): Promise<boolean> => {
      const active = result;
      if (!active) return false;
      setBusy(true);
      setError("");
      try {
        const response = await brainFetch(`${base}/v1/harness/approve`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ draftId: active.draft.id, answer: verb }),
        });
        const body = await readJson(response);
        if (!response.ok) {
          setError(String(body.error ?? "Harness could not start."));
          void refresh();
          return false;
        }
        setResult(null);
        void refresh();
        return true;
      } catch {
        setError("The Mac did not answer. Is Preyas running?");
        return false;
      } finally {
        setBusy(false);
      }
    },
    [base, result, refresh],
  );

  /** Drop the card without asking the brain; used by "Draft again". */
  const reset = useCallback(() => {
    setResult(null);
    setError("");
  }, []);

  /** Stop the run; safe when nothing runs. */
  const stop = useCallback(async () => {
    setError("");
    try {
      await brainFetch(`${base}/v1/harness/stop`, { method: "POST" });
    } catch {
      /* the poll will show the truth */
    }
    void refresh();
  }, [base, refresh]);

  return { status, result, error, busy, draft, answer, stop, refresh, reset };
}
