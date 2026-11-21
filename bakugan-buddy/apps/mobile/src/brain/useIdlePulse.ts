import { useEffect, useRef } from "react";
import { Animated, Easing, Platform } from "react-native";
import { usePageVisible } from "../ui/usePageVisible";
import { useReducedMotion } from "../ui/useReducedMotion";

/**
 * The two slow phases behind the Brain map's glow.
 *
 * Both are plain react-native Animated values: opacity and transform only, so
 * the native driver can run them on the UI thread. There is no per-frame
 * setState and no per-node loop — one breath for the resting map, one faster
 * pulse for neurons that are in use, shared by every halo.
 *
 * While the page is hidden or the platform asks for reduced motion, both
 * values stop at a still midpoint. A reduced-motion map therefore keeps its
 * static glow but never pulses or travels.
 */
export type BrainMotion = {
  breath: Animated.Value;
  activePulse: Animated.Value;
  reduce: boolean;
};

const STILL = 0.5;
const SLOW_MS = 4_200;
const FAST_MS = 1_250;

export function useIdlePulse(): BrainMotion {
  const visible = usePageVisible();
  const reduce = useReducedMotion();
  const breath = useRef(new Animated.Value(0)).current;
  const activePulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible || reduce) {
      breath.stopAnimation();
      activePulse.stopAnimation();
      breath.setValue(STILL);
      activePulse.setValue(STILL);
      return;
    }

    // Start each loop at 0 so Animated.loop's reset lands on the same value
    // every cycle; starting from STILL would jump halfway each time.
    breath.setValue(0);
    activePulse.setValue(0);

    // react-native-web has no native animated module; the JS driver still
    // animates only opacity and transform, which the browser composites.
    const native = Platform.OS !== "web";
    const slow = Animated.loop(
      Animated.sequence([
        Animated.timing(breath, {
          toValue: 1,
          duration: SLOW_MS,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: native,
        }),
        Animated.timing(breath, {
          toValue: 0,
          duration: SLOW_MS,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: native,
        }),
      ]),
    );
    const fast = Animated.loop(
      Animated.sequence([
        Animated.timing(activePulse, {
          toValue: 1,
          duration: FAST_MS,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: native,
        }),
        Animated.timing(activePulse, {
          toValue: 0,
          duration: FAST_MS,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: native,
        }),
      ]),
    );

    slow.start();
    fast.start();
    return () => {
      slow.stop();
      fast.stop();
    };
  }, [visible, reduce, breath, activePulse]);

  return { breath, activePulse, reduce };
}
