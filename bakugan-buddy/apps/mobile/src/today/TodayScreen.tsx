import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { todayColumns } from "../layout";
import { theme } from "../theme";
import { Stripe } from "../ui/Stripe";
import { Panel } from "../ui/Panel";
import { DailyXp } from "./DailyXp";
import { LevelCard } from "./LevelCard";
import { useRpg } from "./useRpg";

function clockText(d: Date): string {
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

/** A placeholder column until the Quests and Radar slices land. */
function ComingSoon() {
  return (
    <Panel>
      <Text style={styles.coming}>Coming in the next slice</Text>
    </Panel>
  );
}

/**
 * The Today dashboard: header with the brand chip and the live clock, then
 * the level card and daily XP on the left, with the centre and right
 * columns reserved for the next slices. Plain scroll flow, nothing fixed.
 */
export function TodayScreen() {
  const { snapshot } = useRpg();
  const { width } = useWindowDimensions();
  const [time, setTime] = useState(() => clockText(new Date()));

  useEffect(() => {
    const timer = setInterval(() => setTime(clockText(new Date())), 30_000);
    return () => clearInterval(timer);
  }, []);

  const cols = todayColumns(width);
  const left = (
    <View style={[styles.leftCol, cols === 1 && styles.stacked]}>
      <LevelCard />
      <DailyXp />
    </View>
  );

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.pad}>
      <View style={styles.header}>
        <View style={styles.brandGroup}>
          <View style={styles.brandBlock}>
            <View style={styles.brandChip}>
              <Text style={styles.brandText}>PREYAS</Text>
            </View>
            <Stripe height={4} />
          </View>
          {snapshot.isDemo ? (
            <View style={styles.demoTag}>
              <Text style={styles.demoTagText}>DEMO DATA</Text>
            </View>
          ) : null}
        </View>
        <View style={styles.clockChip}>
          <Text style={styles.clockText}>{time}</Text>
        </View>
      </View>

      {cols === 3 ? (
        <View style={styles.row}>
          <View style={styles.sideCol}>{left}</View>
          <View style={styles.centerCol}>
            <ComingSoon />
          </View>
          <View style={styles.sideCol}>
            <ComingSoon />
          </View>
        </View>
      ) : cols === 2 ? (
        <View style={styles.row}>
          <View style={styles.sideCol}>{left}</View>
          <View style={[styles.centerCol, styles.stacked]}>
            <ComingSoon />
            <ComingSoon />
          </View>
        </View>
      ) : (
        <View style={styles.stacked}>
          {left}
          <ComingSoon />
          <ComingSoon />
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  pad: { padding: 24, paddingBottom: 24 },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 16,
    marginBottom: 20,
  },
  brandGroup: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  brandBlock: { alignItems: "flex-start" },
  brandChip: {
    backgroundColor: theme.card,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    paddingVertical: 6,
    paddingHorizontal: 14,
  },
  brandText: {
    fontFamily: theme.font.display,
    fontWeight: "700",
    fontSize: 32,
    textTransform: "uppercase",
    letterSpacing: 0.64,
    color: theme.text,
  },
  demoTag: {
    backgroundColor: theme.accent,
    borderRadius: 5,
    paddingVertical: 2,
    paddingHorizontal: 8,
    marginTop: 14,
  },
  demoTagText: {
    color: theme.onAccent,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.3,
    textTransform: "uppercase",
  },
  clockChip: {
    backgroundColor: theme.card,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  clockText: {
    fontFamily: theme.font.display,
    fontWeight: "600",
    fontSize: 24,
    fontVariant: ["tabular-nums"],
    color: theme.text,
  },
  row: { flexDirection: "row", alignItems: "flex-start", gap: 20 },
  sideCol: { width: "26%", minWidth: 280 },
  centerCol: { flex: 1, minWidth: 280 },
  leftCol: { gap: 20 },
  stacked: { gap: 20 },
  coming: { color: theme.dim, fontSize: 14 },
});
