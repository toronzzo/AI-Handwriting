import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { theme } from "../theme";
import { Panel } from "../ui/Panel";
import { Stripe } from "../ui/Stripe";
import { usePalette } from "../usePalette";
import {
  BREAK_MS,
  pause,
  remainingMs,
  reset,
  resume,
  start,
  tick,
  type FocusTimerState,
} from "./focusTimer.ts";
import { useRpg } from "./useRpg";

/** The quest lengths offered by the segmented control, in minutes. */
const LENGTHS = [15, 25, 45] as const;

/** Circumference of the ring circle (2π × 52 ≈ 326.7). */
const RING = 326.7;

/** The XP the mock source pays for a finished focus quest. Kept in sync with
 *  mockSource.addFocus so the bubble matches what actually lands. */
function focusXp(minutes: number): number {
  return Math.max(2, Math.round(minutes / 5));
}

/** MM:SS, rounding up so the ring never shows 00:00 a moment early. */
function formatTime(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/**
 * The Focus quest panel (right column of the Today screen, under Quests):
 * a countdown ring, the 15/25/45 minute segmented control and Start / Pause
 * / Reset buttons. The state machine is timestamp-based; the UI only ticks
 * once per second while the page is visible, so a hidden tab stays correct
 * and catches up on the next visible tick.
 */
export function FocusQuest() {
  const { source, postNotice } = useRpg();
  const palette = usePalette();

  const [minutes, setMinutes] = useState<number>(25);
  const [state, setState] = useState<FocusTimerState>(() => reset());
  const [nowMs, setNowMs] = useState(() => Date.now());
  const stateRef = useRef(state);

  const apply = useCallback((next: FocusTimerState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  useEffect(() => {
    const visible = () => typeof document === "undefined" || !document.hidden;
    const step = () => {
      if (!visible()) return;
      const current = stateRef.current;
      if (current.mode !== "run" && current.mode !== "break") return;
      const now = Date.now();
      setNowMs(now);
      const result = tick(current, now);
      if (result.state !== current) apply(result.state);
      if (result.completed !== null) {
        source.addFocus?.(result.completed);
        postNotice(`Quest complete! +${focusXp(result.completed)} XP. Break: 5 min.`);
      }
    };
    const timer = setInterval(step, 1000);
    const onVisible = () => step();
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisible);
    }
    return () => {
      clearInterval(timer);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisible);
      }
    };
  }, [apply, source, postNotice]);

  const running = state.mode === "run";
  const breaking = state.mode === "break";
  const totalMs = running || state.mode === "pause" ? state.minutes * 60_000 : BREAK_MS;
  const displayMs =
    state.mode === "idle" ? minutes * 60_000 : remainingMs(state, nowMs);
  const progress = totalMs <= 0 ? 1 : Math.min(1, Math.max(0, displayMs / totalMs));
  const canStart = state.mode === "idle" || state.mode === "pause";

  return (
    <Panel style={styles.panel}>
      <View style={styles.topStripe}>
        <Stripe height={3} gap={0} />
      </View>

      <View style={styles.body}>
        <View
          accessible
          accessibilityRole="timer"
          accessibilityLabel={`Focus timer, ${
            breaking ? "break" : formatTime(displayMs)
          } left`}
        >
          <View style={styles.ring}>
            <Svg width={78} height={78} viewBox="0 0 120 120" accessibilityElementsHidden>
              <Circle cx={60} cy={60} r={52} stroke={palette.track} strokeWidth={9} fill="none" />
              <Circle
                cx={60}
                cy={60}
                r={52}
                stroke={palette.accent}
                strokeWidth={9}
                fill="none"
                strokeLinecap="round"
                strokeDasharray={String(RING)}
                strokeDashoffset={RING * (1 - progress)}
                rotation={-90}
                origin="60 60"
              />
            </Svg>
            <View style={styles.ringCenter} pointerEvents="none">
              <Text style={styles.ringTime}>{formatTime(displayMs)}</Text>
              {breaking ? <Text style={styles.ringLabel}>Break</Text> : null}
            </View>
          </View>
        </View>

        <View style={styles.side}>
          <View style={styles.titleRow}>
            <Text style={styles.title}>Focus quest</Text>
            <Text style={styles.length}>{minutes} min</Text>
          </View>

          <View style={styles.seg}>
            {LENGTHS.map((length) => {
              const selected = length === minutes;
              return (
                <Pressable
                  key={length}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={`${length} minute focus quest`}
                  onPress={() => setMinutes(length)}
                  style={[styles.segItem, selected && styles.segItemOn]}
                >
                  <Text style={[styles.segText, selected && styles.segTextOn]}>{length}</Text>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.buttons}>
            <Pressable
              accessibilityRole="button"
              disabled={!canStart}
              onPress={() => {
                const now = Date.now();
                setNowMs(now);
                apply(
                  state.mode === "pause" ? resume(stateRef.current, now) : start(minutes, now),
                );
              }}
              style={[styles.button, styles.buttonPrimary, !canStart && styles.buttonDisabled]}
            >
              <Text style={styles.buttonPrimaryText}>Start</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={!running}
              onPress={() => {
                const now = Date.now();
                setNowMs(now);
                apply(pause(stateRef.current, now));
              }}
              style={[styles.button, styles.buttonGhost, !running && styles.buttonDisabled]}
            >
              <Text style={styles.buttonGhostText}>Pause</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={state.mode === "idle"}
              onPress={() => {
                setNowMs(Date.now());
                apply(reset());
              }}
              style={[styles.button, styles.buttonGhost, state.mode === "idle" && styles.buttonDisabled]}
            >
              <Text style={styles.buttonGhostText}>Reset</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Panel>
  );
}

const styles = StyleSheet.create({
  panel: { paddingTop: 24 },
  topStripe: {
    position: "absolute",
    left: 20,
    right: 20,
    top: 0,
  },
  body: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  ring: {
    width: 78,
    height: 78,
  },
  ringCenter: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    gap: 1,
  },
  ringTime: {
    fontFamily: theme.font.display,
    fontWeight: "600",
    fontSize: theme.type.display.timer,
    fontVariant: ["tabular-nums"],
    color: theme.text,
  },
  ringLabel: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
    color: theme.dim,
  },
  side: {
    flex: 1,
    minWidth: 0,
    gap: 8,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 8,
  },
  title: {
    color: theme.text,
    fontSize: 14,
    fontWeight: "600",
  },
  length: {
    color: theme.dim,
    fontSize: 12.5,
    fontVariant: ["tabular-nums"],
  },
  seg: {
    flexDirection: "row",
    alignSelf: "flex-start",
    borderWidth: 1,
    borderColor: theme.lineStrong,
    borderRadius: 8,
    overflow: "hidden",
  },
  segItem: {
    minHeight: 36,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  segItemOn: {
    backgroundColor: theme.accent,
  },
  segText: {
    color: theme.dim,
    fontSize: 12.5,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
  },
  segTextOn: {
    color: theme.onAccent,
  },
  buttons: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  button: {
    minHeight: 36,
    borderRadius: 10,
    paddingVertical: 6,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonPrimary: {
    backgroundColor: theme.accent,
  },
  buttonPrimaryText: {
    color: theme.onAccent,
    fontSize: 13,
    fontWeight: "700",
  },
  buttonGhost: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: theme.lineStrong,
  },
  buttonGhostText: {
    color: theme.text,
    fontSize: 13,
    fontWeight: "600",
  },
  buttonDisabled: {
    opacity: 0.45,
  },
});
