import { useEffect, useState } from "react";
import { currentBrainUrl } from "../room/brain/brainLink";
import { brainFetch } from "../room/brain/token";
import { usePageVisible } from "../ui/usePageVisible";
import {
  BRAIN_POLL_MS,
  BrainLiveError,
  createLiveBrainSource,
  offlineBrainMap,
  staleBrainMap,
} from "./liveBrain.ts";
import type { BrainMap } from "./types.ts";

/**
 * The Brain map's live status, with one slow poll while the page is visible.
 *
 * The Brain tab unmounts when another tab is selected (App.tsx), and this
 * effect also stops while the browser tab is hidden (usePageVisible). In both
 * cases the interval is cleared and the in-flight request is aborted, so a
 * hidden Brain view never keeps the Mac busy.
 *
 * There is no animation here and no per-frame work: one fetch every 30 s,
 * one state update when it answers, and the demo map until then.
 */
export function useLiveBrainMap(): BrainMap {
  const visible = usePageVisible();
  const [source] = useState(() =>
    createLiveBrainSource({ baseUrl: currentBrainUrl(), fetchImpl: brainFetch }),
  );
  const [map, setMap] = useState<BrainMap>(() => source.get());

  useEffect(() => {
    if (!visible) return;
    let disposed = false;
    const controller = new AbortController();

    const check = async () => {
      try {
        const next = await source.refresh({ signal: controller.signal });
        if (!disposed) setMap(next);
      } catch (error) {
        if (disposed) return;
        // Cancellation is this effect cleaning up, not an offline Mac.
        if (error instanceof BrainLiveError && error.code === "cancelled") return;
        setMap((last) =>
          last.mode === "live" || last.mode === "stale"
            ? staleBrainMap(last)
            : offlineBrainMap("unreachable"),
        );
      }
    };

    void check();
    const timer = setInterval(() => {
      void check();
    }, BRAIN_POLL_MS);

    return () => {
      disposed = true;
      controller.abort();
      clearInterval(timer);
    };
  }, [source, visible]);

  return map;
}
