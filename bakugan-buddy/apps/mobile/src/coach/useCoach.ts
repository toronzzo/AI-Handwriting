import { useCallback, useEffect, useRef, useState } from "react";
import { brainFetch } from "../room/brain/token";

export type CoachState = {
  mode: "off" | "skill" | "pending" | "lesson";
  skillName: string | null;
  step: number;
  of: number;
  startedAt: number | null;
  learnedCount: number;
  lastSpeak: { id: number; text: string; lang: string } | null;
  danger: boolean;
};

export type CoachSkill = { name: string; when: string[]; valid: boolean; learned: boolean };

/**
 * Coach state + skill list through the brain. The brain URL is a ref that is
 * only known after pairing, so the hook takes a getter. The same ref the send
 * flow reads is updated after every coach turn, so "is the coach active"
 * stays synchronous for the command handler.
 */
export function useCoach(getUrl: () => string | null) {
  const [state, setState] = useState<CoachState | null>(null);
  const [skills, setSkills] = useState<CoachSkill[]>([]);
  const stateRef = useRef<CoachState | null>(null);

  const applyState = useCallback((next: CoachState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const refresh = useCallback(async () => {
    const brainUrl = getUrl();
    if (!brainUrl) return;
    try {
      const res = await brainFetch(`${brainUrl}/v1/coach/state`);
      applyState(await res.json());
      if (stateRef.current?.mode !== "skill") {
        const skillRes = await brainFetch(`${brainUrl}/v1/coach/skills`);
        const data = await skillRes.json();
        setSkills(Array.isArray(data.skills) ? data.skills : []);
      }
    } catch {
      /* brain offline: chip just shows Coach */
    }
  }, [getUrl, applyState]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const turn = useCallback(
    async (text: string) => {
      const brainUrl = getUrl();
      if (!brainUrl) return { handled: false, reply: "The brain is offline.", state: null };
      const res = await brainFetch(`${brainUrl}/v1/coach/turn`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (data && data.state) applyState(data.state);
      return data;
    },
    [getUrl, applyState],
  );

  return { state, skills, stateRef, active: (state?.mode ?? "off") !== "off", refresh, applyState, turn };
}
