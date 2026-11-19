/**
 * Where the corner preview's picture comes from. Nothing writes frames yet:
 * a future screen or browser skill will drop a file in
 * `<dataDir>/activity/frames/` and emit a `frame` step. This interface is that
 * door, so the card already knows how to ask without anything else changing.
 */
import { brainFetch } from "../room/brain/token";

export type Frame = { url: string; capturedAt: number };

export interface FrameSource {
  /** The newest picture, or null when there is not one yet. */
  latest(): Promise<Frame | null>;
  /** Let go of anything the source is holding (object URLs). */
  dispose?: () => void;
}

/**
 * Frames served by the brain: GET /v1/activity/frame/<id>. The response is
 * turned into an object URL so the browser can show it like a local file; the
 * previous URL is revoked so pictures never pile up in memory.
 */
export function brainFrameSource(brainUrl: string, frameId: string, fetchImpl: typeof fetch = brainFetch): FrameSource {
  const base = String(brainUrl || "").replace(/\/$/, "");
  const id = String(frameId || "");
  let current: string | null = null;
  return {
    async latest() {
      if (!base || !id) return null;
      try {
        const res = await fetchImpl(`${base}/v1/activity/frame/${encodeURIComponent(id)}`);
        if (!res.ok) return null;
        const blob = await res.blob();
        if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") return null;
        const url = URL.createObjectURL(blob);
        if (current) URL.revokeObjectURL(current);
        current = url;
        return { url, capturedAt: Date.now() };
      } catch {
        return null;
      }
    },
    dispose() {
      if (current) URL.revokeObjectURL(current);
      current = null;
    },
  };
}
