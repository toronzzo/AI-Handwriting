import { useEffect, useRef, useState } from "react";
import { Animated } from "react-native";
import { usePageVisible } from "../ui/usePageVisible";
import { useReducedMotion } from "../ui/useReducedMotion";

/**
 * A single, slow "neural breathing" phase for the Brain map.
 *
 * Returns a number that eases from 0 up to near 1 and back again, on one
 * `Animated.loop`, only while the page is actually visible and the platform
 * does not prefer reduced motion. When either stops being true it snaps to a
 * still 0 and the loop is torn down, so there is no hidden work and no
 * per-frame React churn left running.
 *
 * One value drives every ring in the map, so there is exactly one loop and
 * one listener for the whole screen — no constant expensive animation, and
 * no flashing: the easing never reaches a hard 1, it just tilts gently.
 */
export function useIdlePulse(): number {
  const visible = usePageVisible();
  const reduce = useReducedMotion();
  const anim = useRef(new Animated.Value(0)).current;
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const id = anim.addListener(({ value }) => setPhase(value as number));
    return () => anim.removeListener(id);
  }, [anim]);

  useEffect(() => {
    if (!visible || reduce) {
      anim.stopAnimation();
      anim.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        // Ease up from 0 to 1 over ~2.4 s, then back down over ~2.4 s;
        // keyframe 0.96 keeps the peak soft so nothing ever flashes.
        Animated.timing(anim, { toValue: 1, duration: 2400, useNativeDriver: false }),
        Animated.timing(anim, { toValue: 0, duration: 2400, useNativeDriver: false }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [visible, reduce, anim]);

  // 0..1 breathing; a touch of ease-in-out already comes from the two timings.
  return phase;
}
