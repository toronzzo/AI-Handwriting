import { useEffect, useState } from "react";
import { currentBrainUrl } from "../room/brain/brainLink";
import { brainFetch } from "../room/brain/token";
import { usePageVisible } from "../ui/usePageVisible";
import { emptyNeuronFeed, ingestNeuronSnapshot, type NeuronFeed } from "./neuronActivity.ts";

/**
 * The live neuron snapshot behind the Brain map.
 *
 * GET /v1/brain is the snapshot sibling of the existing /v1/brain/stream SSE
 * feed. Polling it (instead of opening an EventSource) keeps the pairing
 * header on every request: EventSource cannot send X-Preyas-Token, and the
 * brain deliberately does not accept tokens in query strings. One small GET
 * every 1.5 s while the Brain tab is visible is enough for a map, and it works
 * on the web, in Expo Go and on a real phone without a new dependency.
 *
 * A failed read keeps the last good feed and says so; it never invents
 * activity or clears the map to a fake resting state.
 */
export const NEURON_POLL_MS = 1_500;
export const NEURON_TIMEOUT_MS = 2_500;
export const MAX_NEURON_BYTES = 32_768;

export type NeuronFeedState = {
  feed: NeuronFeed;
  /** Empty while the feed is healthy; one plain sentence otherwise. */
  error: string;
  /** True after the first successful snapshot. */
  live: boolean;
};

export function useNeuronFeed(): NeuronFeedState {
  const visible = usePageVisible();
  const [base] = useState(() => currentBrainUrl());
  const [feed, setFeed] = useState<NeuronFeed>(() => emptyNeuronFeed());
  const [error, setError] = useState("");
  const [live, setLive] = useState(false);

  useEffect(() => {
    if (!visible || !base) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let reading = new AbortController();

    const poll = async () => {
      if (cancelled) return;
      reading = new AbortController();
      const deadline = setTimeout(() => reading.abort(), NEURON_TIMEOUT_MS);
      try {
        const response = await brainFetch(`${base}/v1/brain`, {
          method: "GET",
          headers: { accept: "application/json" },
          signal: reading.signal,
        });
        if (cancelled) return;
        if (response.status === 401 || response.status === 429) {
          setError("Pair this device with the Mac to see live neurons.");
          return;
        }
        if (!response.ok) {
          setError("The brain feed did not answer.");
          return;
        }
        const text = await response.text();
        if (text.length > MAX_NEURON_BYTES) {
          setError("The brain feed sent more data than this view accepts.");
          return;
        }
        let body: unknown;
        try {
          body = JSON.parse(text);
        } catch {
          setError("The brain feed sent something this view did not expect.");
          return;
        }
        const rows = body && typeof body === "object" && !Array.isArray(body)
          ? (body as { neurons?: unknown }).neurons
          : null;
        if (!Array.isArray(rows)) {
          setError("The brain feed sent something this view did not expect.");
          return;
        }
        setFeed((previous) => ingestNeuronSnapshot(previous, body, Date.now()));
        setError("");
        setLive(true);
      } catch {
        if (!cancelled) {
          setError(
            reading.signal.aborted
              ? "The brain feed is taking too long to answer."
              : "The brain feed did not answer.",
          );
        }
      } finally {
        clearTimeout(deadline);
        if (!cancelled) timer = setTimeout(poll, NEURON_POLL_MS);
      }
    };

    void poll();
    return () => {
      cancelled = true;
      reading.abort();
      if (timer) clearTimeout(timer);
    };
  }, [base, visible]);

  return { feed, error, live };
}
