import { useEffect, useRef } from "react";
import { peekActivity, subscribeActivity } from "../../state/activityStore.ts";
import { playCue, warmCues } from "./playCue.ts";
import { cueForBodyState } from "./presenceCue.ts";
import { useCuesFollowVisibility } from "./useCuesFollowVisibility.ts";

/**
 * One app-wide presence listener. Chat publishes the truth; Today and Body may
 * be visible without Chat being the page in front, so the cue policy belongs
 * here rather than in either screen. The cue session still owns mute,
 * reduced-motion, hidden-page, autoplay and rate-limit safety.
 */
export function usePresenceCues(): void {
  const previous = useRef(peekActivity());
  useCuesFollowVisibility(warmCues);
  useEffect(() => {
    const unsubscribe = subscribeActivity((next) => {
      const before = previous.current;
      previous.current = next;
      if (next === before) return;
      const cue = cueForBodyState(next);
      if (cue) playCue(cue);
    });
    return unsubscribe;
  }, []);
}
