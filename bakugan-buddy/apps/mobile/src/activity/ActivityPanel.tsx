import { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import {
  iconFor,
  labelFor,
  newestFinished,
  runOf,
  secondsText,
  summary,
  type ActivityRun,
  type ActivityState,
} from "../../../../packages/alive/src/activity.ts";
import { StepAlert, StepIcon } from "./StepIcon";
import { theme } from "../theme";
import { useReducedMotion } from "../ui/useReducedMotion";

/** One line for the polite live region: only finished steps are announced. */
function finishedLine(run: ActivityRun | undefined): string {
  const step = newestFinished(run);
  if (!step) return "";
  if (step.status === "error" || step.status === "stopped") return `Couldn't finish: ${step.label || step.tool}`;
  if (step.status === "done") return labelFor(step.tool, "done", step.durationMs);
  return "";
}

function Rows({ run }: { run: ActivityRun }) {
  return (
    <>
      {run.order.map((id) => {
        const step = run.byId[id];
        if (!step) return null;
        const running = step.status === "running";
        const failed = step.status === "error" || step.status === "stopped";
        const duration =
          step.durationMs !== undefined
            ? secondsText(step.durationMs)
            : !running && step.endedAt !== undefined
              ? secondsText(step.endedAt - step.startedAt)
              : "";
        return (
          <View key={id} style={styles.row}>
            <View style={styles.circle}>{failed ? <StepAlert size={16} /> : <StepIcon icon={iconFor(step.tool)} size={16} />}</View>
            <View style={styles.rowText}>
              <Text style={styles.label} numberOfLines={1}>
                {failed ? "Couldn't finish" : labelFor(step.tool, step.status, step.durationMs)}
              </Text>
              {step.detail ? (
                <Text style={styles.detail} numberOfLines={1} ellipsizeMode="tail">
                  {step.detail}
                </Text>
              ) : null}
            </View>
            {running ? <RunningDot /> : duration ? <Text style={styles.duration}>{duration}</Text> : null}
          </View>
        );
      })}
    </>
  );
}

/** The small accent dot beside a step that is still running. */
function RunningDot() {
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
  return <Animated.View style={[styles.runningDot, { opacity: pulse }]} />;
}

function Chevron({ open }: { open: boolean }) {
  const stroke = { stroke: theme.dim, strokeWidth: 1.8, fill: "none" as const, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <Svg width={16} height={16} viewBox="0 0 16 16">
      {open ? <Path d="M4 10l4-4 4 4" {...stroke} /> : <Path d="M6 4l4 4-4 4" {...stroke} />}
    </Svg>
  );
}

/**
 * The step list under one reply: a quiet ACTIVITY header with a summary, then
 * one row per step. It is expanded while Preyas works and folds to the header
 * line when he is finished; the chevron always wins over that default.
 */
export function ActivityPanel({ state, runId, style }: { state: ActivityState; runId: string; style?: object }) {
  const run = runOf(state, runId);
  const [choice, setChoice] = useState<boolean | null>(null);
  const steps = run?.order.length ?? 0;
  const open = choice ?? Boolean(run?.open);
  const line = useMemo(() => finishedLine(run), [run]);

  if (!run || !steps) return null;
  return (
    <View style={[styles.panel, style]}>
      <View style={styles.head}>
        <Text style={styles.kicker}>ACTIVITY</Text>
        <Text style={styles.summary}>{summary(run)}</Text>
        <Pressable
          style={styles.chevron}
          onPress={() => setChoice(open ? false : true)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={open ? "Hide steps" : "Show steps"}
          aria-expanded={open}
        >
          <Chevron open={open} />
        </Pressable>
      </View>
      {open ? (
        <View style={styles.list} accessibilityRole="list">
          <Rows run={run} />
        </View>
      ) : null}
      {/* Visually hidden: a screen reader hears only the newest finished step. */}
      <Text style={styles.srOnly} accessibilityLiveRegion="polite">
        {line}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: theme.cardSoft,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.accentLine,
    padding: 12,
    marginTop: 6,
    gap: 4,
    width: "100%",
  },
  head: { flexDirection: "row", alignItems: "center", gap: theme.space.sm, minHeight: 36 },
  kicker: { color: theme.dim, fontSize: 12, fontWeight: "700", letterSpacing: 1.2 },
  summary: { color: theme.dim, fontSize: 12, flex: 1 },
  chevron: { width: 36, height: 36, alignItems: "center", justifyContent: "center", borderRadius: 10 },
  list: { gap: 2, paddingBottom: 2 },
  row: { flexDirection: "row", alignItems: "center", gap: theme.space.sm, minHeight: 34, paddingVertical: 2 },
  circle: { width: 28, height: 28, borderRadius: 14, backgroundColor: theme.accentSoft, alignItems: "center", justifyContent: "center" },
  rowText: { flex: 1, minWidth: 0 },
  label: { color: theme.text, fontSize: 14, fontWeight: "500" },
  detail: { color: theme.dim, fontSize: 12.5 },
  runningDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: theme.accent, marginRight: 6 },
  duration: { color: theme.dim, fontSize: 12, fontVariant: ["tabular-nums"] },
  srOnly: { position: "absolute", width: 1, height: 1, opacity: 0 },
});
