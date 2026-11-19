/**
 * The user's own pictures (slice 10).
 *
 * A fixed whitelist of slots, each one file named <slot>.jpg|jpeg|png|webp in
 * /Volumes/Agent/agent/art (then /Volumes/Agent/agent/prototypes/images). The
 * brain reads the file; the app only asks for the bytes.
 *
 * An <img src="…"> cannot carry the pairing header, so the picture is fetched
 * with the same authed helper as every other brain call (brainFetch, which
 * attaches X-Preyas-Token), turned into a blob object URL and that is what the
 * Image shows. The URL is revoked when the slot unmounts, when its picture
 * changes, or when the tab is hidden for good. A 404 simply means "no image".
 */
import { useEffect, useState } from "react";
import { currentBrainUrl } from "../room/brain/brainLink.ts";
import { brainFetch } from "../room/brain/token.ts";

/** The seven fixed slots. Anything else is refused by the brain as a bad slot. */
export const SLOT_IDS = ["hero", "bg", "house", "car", "study", "bakugan-buddy", "studio"] as const;

export type SlotId = (typeof SLOT_IDS)[number];

/** One slot's picture: the object URL to show, or why there is none. */
export type ArtState = {
  /** Blob object URL, or "" when there is no picture to show. */
  url: string;
  /** "loading" until the first answer, then "ready" or "none". */
  status: "loading" | "ready" | "none";
};

export function isSlotId(value: string): value is SlotId {
  return (SLOT_IDS as readonly string[]).includes(value);
}

/** The brain route for one slot. */
export function artUrl(slot: SlotId, brain = currentBrainUrl()): string {
  return `${brain.replace(/\/$/, "")}/v1/art/${slot}`;
}

/** How often a visible tab asks again for a picture that is not there yet. */
export const ART_RECHECK_MS = 60_000;

/**
 * Fetch one slot's picture and keep it available as a blob URL.
 *
 * `show` lets a caller that only needs the picture under a condition (the
 * level card's hero) skip the download until it matters. A hidden tab is not
 * asked; when it becomes visible again the picture is checked again, at most
 * once per minute. `version` lets a caller force a fresh look (for example
 * after the user dropped a new file in).
 */
export function useArt(slot: SlotId, options: { show?: boolean; version?: number } = {}): ArtState {
  const show = options.show !== false;
  const version = options.version ?? 0;
  const [state, setState] = useState<ArtState>({ url: "", status: "loading" });

  useEffect(() => {
    if (!show) {
      setState({ url: "", status: "none" });
      return;
    }

    let cancelled = false;
    let current: string | null = null;
    let lastCheck = 0;

    const release = () => {
      if (current && typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") {
        URL.revokeObjectURL(current);
      }
      current = null;
    };

    const check = () => {
      const now = Date.now();
      lastCheck = now;
      void (async () => {
        try {
          const res = await brainFetch(artUrl(slot));
          if (cancelled) return;
          if (!res.ok) {
            // 404 (mostly) means the user has not put this picture in yet.
            release();
            setState({ url: "", status: "none" });
            return;
          }
          const blob = await res.blob();
          if (cancelled) return;
          if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") {
            setState({ url: "", status: "none" });
            return;
          }
          const next = URL.createObjectURL(blob);
          release();
          current = next;
          setState({ url: next, status: "ready" });
        } catch {
          if (cancelled) return;
          // The Mac did not answer: keep whatever we already have.
          setState((prev) => (prev.url ? prev : { url: "", status: "none" }));
        }
      })();
    };

    check();

    const onVisible = () => {
      if (typeof document !== "undefined" && document.hidden) return;
      if (Date.now() - lastCheck < ART_RECHECK_MS) return;
      check();
    };
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisible);
    }

    return () => {
      cancelled = true;
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisible);
      }
      release();
    };
  }, [slot, show, version]);

  return state;
}
