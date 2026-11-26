import { Pressable, StyleSheet, Text, View } from "react-native";
import { theme } from "../theme";
import { Panel } from "../ui/Panel";
import { PrintedBar } from "./risoPrint";
import { useRpg } from "./useRpg";

/**
 * Daily XP: the big Oswald number against the daily goal and a printed bar
 * with ink tick marks. In the demo a ghost button adds +10 XP to Mind so the
 * level card can show the level-up animation.
 */
export function DailyXp() {
  const { snapshot, source } = useRpg();
  const fill = Math.min(100, Math.round((snapshot.todayXp / snapshot.dailyGoal) * 100));
  const nowXp = Math.min(snapshot.todayXp, snapshot.dailyGoal);

  return (
    <Panel plate="PL. 02">
      <Text style={styles.heading} accessibilityRole="header">DAILY XP</Text>
      <View style={styles.numberRow}>
        <Text style={styles.big}>{snapshot.todayXp}</Text>
        <Text style={styles.goal}>/ {snapshot.dailyGoal}</Text>
      </View>
      <PrintedBar
        pct={fill}
        min={0}
        max={snapshot.dailyGoal}
        now={nowXp}
        label={`${nowXp} of ${snapshot.dailyGoal} daily XP`}
      />
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
  big: {
    fontFamily: theme.font.display,
    fontWeight: "700",
    fontSize: 56,
    color: theme.text,
  },
  goal: { color: theme.dim, fontSize: 20, fontWeight: "600" },
  demoButton: {
    alignSelf: "flex-start",
    minHeight: 36,
    justifyContent: "center",
    borderRadius: theme.radius.square,
    borderWidth: 1,
    borderColor: theme.lineStrong,
    paddingHorizontal: 12,
    marginTop: 12,
  },
  demoText: { color: theme.text, fontSize: 13 },
});
