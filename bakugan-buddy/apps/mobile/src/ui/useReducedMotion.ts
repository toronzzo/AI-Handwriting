import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";

/**
 * True while the platform asks for less motion (WCAG 2.3.3), so every
 * animation can skip its scale, slide or pulse and jump to the end state.
 *
 * Web: matchMedia("(prefers-reduced-motion: reduce)") plus its change event.
 * iPhone: AccessibilityInfo.isReduceMotionEnabled() plus the
 * reduceMotionChanged event, so a change in Settings applies live.
 */
export function useReducedMotion(): boolean {
  const [reduce, setReduce] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
      const media = window.matchMedia("(prefers-reduced-motion: reduce)");
      const update = () => setReduce(media.matches);
      update();
      media.addEventListener("change", update);
      return () => media.removeEventListener("change", update);
    }
    let cancel = false;
    AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (!cancel) setReduce(enabled);
    });
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduce);
    return () => {
      cancel = true;
      subscription.remove();
    };
  }, []);

  return reduce;
}
