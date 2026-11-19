import { Pressable, StyleSheet, Text, View } from "react-native";
import { theme } from "../theme";
import { Stripe } from "../ui/Stripe";
import { Panel } from "../ui/Panel";
import { useRpg } from "./useRpg";

/**
 * Daily XP: the big number against the daily goal and a 10px bar with the
 * Preyas stripe under its fill. In the demo a ghost button adds +10 XP to
 * Mind so the level card can show the level-up animation.
 */
export function DailyXp() {
  const { snapshot, source } = useRpg();
  const fill = Math.min(100, Math.round((snapshot.todayXp / snapshot.dailyGoal) * 100));
  const fillWidth = `${fill}%` as const;
  const nowXp = Math.min(snapshot.todayXp, snapshot.dailyGoal);

  return (
    <Panel>
      <Text style={styles.heading} accessibilityRole="header">DAILY XP</Text>
      <View style={styles.numberRow}>
        <Text style={styles.big}>{snapshot.todayXp}</Text>
        <Text style={styles.goal}>/ {snapshot.dailyGoal}</Text>
      </View>
      <View
        style={styles.bar}
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: snapshot.dailyGoal, now: nowXp }}
        accessibilityLabel={`${nowXp} of ${snapshot.dailyGoal} daily XP`}
      >
        <View style={[styles.fill, { width: fillWidth }]} />
      </View>
      <View style={styles.fillStripe}>
        <Stripe height={2} width={fillWidth} />
      </View>
      {snapshot.isDemo ? (
        <Pressable
          style={styles.demoButton}
          accessibilityRole="button"
          accessibilityLabel="Demo: add 10 XP"
          onPress={() => source.addDemoXp?.("intel", 10)}
        >
          <Text style={styles.demoText}>Demo: +10 XP</Text>
        </Pressable>
      ) : null}
    </Panel>
  );
}

const styles = StyleSheet.create({
  heading: {
    color: theme.dim,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  numberRow: { flexDirection: "row", alignItems: "baseline", gap: 6, marginTop: 6, marginBottom: 10 },
  big: { color: theme.text, fontSize: 48, fontWeight: "800" },
  goal: { color: theme.dim, fontSize: 20, fontWeight: "600" },
  bar: {
    height: 10,
    borderRadius: 99,
    backgroundColor: theme.track,
    borderWidth: 1,
    borderColor: theme.accentLine,
    overflow: "hidden",
  },
  fill: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: theme.accent,
    borderRadius: 99,
  },
  fillStripe: { marginTop: 5 },
  demoButton: {
    alignSelf: "flex-start",
    minHeight: 36,
    justifyContent: "center",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.accentLine,
    paddingHorizontal: 12,
    marginTop: 12,
  },
  demoText: { color: theme.text, fontSize: 13 },
});
