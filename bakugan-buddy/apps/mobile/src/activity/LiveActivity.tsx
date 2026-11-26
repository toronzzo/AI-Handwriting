/**
 * One line above the composer while Preyas is answering: the step he is on and
 * how many steps the run has taken. It never replaces the Activity panel under
 * the reply; it is the "right now" answer while you wait, and it disappears the
 * moment the run is done.
 */
import { useEffect, useRef } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";
import { runOf, summary, type ActivityState } from "../../../../packages/alive/src/activity.ts";
import { theme } from "../theme";
import { useReducedMotion } from "../ui/useReducedMotion";
import { liveLine } from "./liveLine";

/** The accent dot beside the line; still under reduced motion. */
function Pulse() {
  const reduce = useReducedMotion();
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (reduce) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.35, duration: 600, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 600, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [reduce, pulse]);
  return <Animated.View style={[styles.dot, { opacity: pulse }]} />;
}

export function LiveActivity({ state, runId, active }: { state: ActivityState; runId: string; active: boolean }) {
  const line = liveLine(state, runId, active);
  if (!line) return null;
  const meta = summary(runOf(state, runId));
  return (
    <View style={styles.row} accessibilityLiveRegion="polite">
      <Pulse />
      <Text style={styles.label} numberOfLines={1}>
        {line}
      </Text>
      {meta ? <Text style={styles.meta}>{meta}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space.sm,
    minHeight: 20,
    marginTop: theme.space.sm,
    paddingHorizontal: theme.space.xs,
  },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: theme.accent },
  label: { flex: 1, color: theme.dim, fontSize: theme.type.caption },
  meta: { color: theme.faint, fontSize: theme.type.label, fontVariant: ["tabular-nums"] },
});
