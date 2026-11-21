import { useEffect, useState } from "react";
import { currentBrainUrl } from "../room/brain/brainLink";
import { brainFetch } from "../room/brain/token";
import { usePageVisible } from "../ui/usePageVisible";
import { normalizePowerStatus, type PowerStatus } from "../settings/power.ts";

/**
 * Real RAM per service for the Brain view.
 *
 * One small GET to /v1/power/status every 15 s while the page is visible.
 * The Mac remains the only source: a failed read keeps the last real numbers
 * and labels them as old rather than showing a made-up figure.
 */
export const BRAIN_POWER_POLL_MS = 15_000;
export const BRAIN_POWER_TIMEOUT_MS = 6_000;

export type BrainPower = {
  status: PowerStatus | null;
  error: string;
  loading: boolean;
};

export function useBrainPower(): BrainPower {
  const visible = usePageVisible();
  const [base] = useState(() => currentBrainUrl());
  const [status, setStatus] = useState<PowerStatus | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!visible || !base) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let reading = new AbortController();

    const load = async () => {
      if (cancelled) return;
      reading = new AbortController();
      const deadline = setTimeout(() => reading.abort(), BRAIN_POWER_TIMEOUT_MS);
      try {
        const response = await brainFetch(`${base}/v1/power/status`, {
          method: "GET",
          headers: { accept: "application/json" },
          signal: reading.signal,
        });
        if (cancelled) return;
        if (response.status === 401 || response.status === 429) {
          setError("Pair this device with the Mac to read RAM.");
          return;
        }
        if (!response.ok) {
          setError("The Mac could not report its RAM.");
          return;
        }
        const next = normalizePowerStatus(await response.json());
        setStatus(next);
        setError(next.error || "");
      } catch {
        if (!cancelled) {
          setError(
            reading.signal.aborted
              ? "The Mac is taking too long to report RAM."
              : "The Mac did not answer with RAM.",
          );
        }
      } finally {
        clearTimeout(deadline);
        if (!cancelled) {
          setLoading(false);
          timer = setTimeout(load, BRAIN_POWER_POLL_MS);
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
      reading.abort();
      if (timer) clearTimeout(timer);
    };
  }, [base, visible]);

  return { status, error, loading };
}
