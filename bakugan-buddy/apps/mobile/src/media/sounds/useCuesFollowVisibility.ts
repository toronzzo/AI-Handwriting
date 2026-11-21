/**
 * Stop the cue that is playing when the page is hidden or the app goes to the
 * background, and warm the audio mode when it comes back (media plan §13.3:
 * a cue never rings from a hidden tab or a backgrounded phone).
 *
 * It reuses the house visibility hook rather than a second implementation.
 * The web path also watches document.visibilityState directly, because
 * usePageVisible's default is "visible" until its first effect runs.
 */
import { useEffect } from "react";
import { usePageVisible } from "../../ui/usePageVisible.ts";
import { stopCue } from "./playCue.ts";

/** Keep cues from outliving the page they belong to. */
export function useCuesFollowVisibility(warm: () => Promise<unknown> | void): void {
  const visible = usePageVisible();

  useEffect(() => {
    if (visible) {
      void warm();
      return;
    }
    stopCue();
  }, [visible, warm]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") stopCue();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);
}
