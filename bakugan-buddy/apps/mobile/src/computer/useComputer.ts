import { useCallback, useEffect, useRef, useState } from "react";
import { currentBrainUrl } from "../room/brain/brainLink";
import { brainFetch } from "../room/brain/token";

export type ComputerProposal = {
  proposalId: string;
  action: "click" | "type" | "key" | "done" | "ask";
  target: string | null;
  targetLabel: string | null;
  text: string | null;
  combo: string | null;
  why: string;
  warn?: string | null;
  shotUrl: string | null;
  step: number;
  maxActions: number;
  reason?: string | null;
};

export type ComputerState = {
  enabled: boolean;
  phase: "idle" | "proposed" | "running" | "stopped" | "ended";
  goal: string | null;
  sessionId: string | null;
  step: number;
  executed: number;
  proposal: ComputerProposal | null;
  spentTodayUsd: number;
  capUsd: number;
  maxActions: number;
  idleSeconds: number;
};

export type EscalationInfo = {
  preview: string;
  estimateUsd: number;
  spentTodayUsd: number;
  capUsd: number;
  allowed: boolean;
  reason: string;
  error?: string;
};

/** One action in plain words, for the Да/Нет card. */
export function plainWords(proposal: {
  action: string;
  targetLabel?: string | null;
  target?: string | null;
  text?: string | null;
  combo?: string | null;
  why?: string | null;
} | null | undefined): string {
  if (!proposal) return "";
  if (proposal.action === "click") return `Click '${proposal.targetLabel || proposal.target || ""}'`;
  if (proposal.action === "type") return `Type '${proposal.text ?? ""}'`;
  if (proposal.action === "key") return `Press '${proposal.combo ?? ""}'`;
  if (proposal.action === "done") return proposal.why || "The goal is done.";
  return proposal.why || "Preyas needs more information.";
}

const POLL_MS = 1200;

/**
 * Computer control state + actions through the brain. The brain URL is
 * derived the same way the rest of the app does (currentBrainUrl), and the
 * state is polled every 1.2 s while a session runs, like the other panels.
 */
export function useComputer() {
  const [state, setState] = useState<ComputerState | null>(null);
  const [escalation, setEscalation] = useState<EscalationInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const urlRef = useRef<string | null>(null);
  const getUrl = useCallback(() => {
    if (!urlRef.current) urlRef.current = currentBrainUrl();
    return urlRef.current;
  }, []);

  const refresh = useCallback(async () => {
    const brainUrl = getUrl();
    if (!brainUrl) return;
    try {
      const res = await brainFetch(`${brainUrl}/v1/computer/state`);
      if (res.ok) setState((await res.json()) as ComputerState);
    } catch {
      /* brain offline: the section stays quiet */
    }
  }, [getUrl]);

  const running = Boolean(state?.sessionId && state.phase !== "stopped" && state.phase !== "ended");

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [running, refresh]);

  const post = useCallback(
    async (path: string, body?: unknown) => {
      const brainUrl = getUrl();
      if (!brainUrl) return null;
      setBusy(true);
      setError(null);
      try {
        const res = await brainFetch(`${brainUrl}${path}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        const data = (await res.json()) as Record<string, unknown>;
        if (!res.ok && data && data.error) setError(String(data.error));
        return data;
      } catch {
        setError("the Mac did not answer");
        return null;
      } finally {
        setBusy(false);
      }
    },
    [getUrl],
  );

  /** Enabling always carries confirmed:true — the panel showed the Да/Нет card first. */
  const enable = useCallback(
    async (on: boolean) => {
      const data = await post("/v1/computer/settings", { enabled: on, confirmed: on });
      await refresh();
      return data;
    },
    [post, refresh],
  );

  const start = useCallback(
    async (goal: string) => {
      const data = await post("/v1/computer/start", { goal });
      await refresh();
      return data;
    },
    [post, refresh],
  );

  const step = useCallback(async () => {
    const data = await post("/v1/computer/step", {});
    await refresh();
    return data;
  }, [post, refresh]);

  const decide = useCallback(
    async (proposalId: string, yes: boolean) => {
      const data = await post("/v1/computer/decide", { proposalId, yes });
      await refresh();
      return data;
    },
    [post, refresh],
  );

  const stop = useCallback(async () => {
    const data = await post("/v1/computer/stop", {});
    await refresh();
    return data;
  }, [post, refresh]);

  const askEscalate = useCallback(async () => {
    const data = await post("/v1/computer/escalate", {});
    if (data) {
      if (typeof data.preview === "string") setEscalation(data as unknown as EscalationInfo);
      else if (data.error) setError(String(data.error));
    }
    return data;
  }, [post]);

  const confirmEscalate = useCallback(
    async (yes: boolean) => {
      const data = await post("/v1/computer/escalate/confirm", { yes });
      setEscalation(null);
      await refresh();
      return data;
    },
    [post, refresh],
  );

  const closeEscalate = useCallback(() => setEscalation(null), []);

  return {
    state,
    running,
    escalation,
    busy,
    error,
    refresh,
    enable,
    start,
    step,
    decide,
    stop,
    askEscalate,
    confirmEscalate,
    closeEscalate,
  };
}
