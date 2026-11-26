import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { todayColumns } from "../layout";
import { theme } from "../theme";
import { Stripe } from "../ui/Stripe";
import { usePageVisible } from "../ui/usePageVisible";
import { DailyXp } from "./DailyXp";
import { FocusQuest } from "./FocusQuest";
import { LevelCard } from "./LevelCard";
import { PathsRow } from "./PathsRow";
import { QuestList } from "./QuestList";
import { Radar } from "./Radar";
import { useRpg } from "./useRpg";

function clockText(d: Date): string {
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

/**
 * The Today field journal: header with the brand plate and the live clock,
 * then an asymmetric print spread — the level card and daily XP on the
 * narrow 38% journal column, the radar and quests on the wide content
 * column — and the PATHS row across the bottom. Plain scroll flow, nothing
 * fixed. The equal three-column card grid is gone with the riso redesign.
 */
export function TodayScreen() {
  const { snapshot } = useRpg();
  const { width } = useWindowDimensions();
  const [time, setTime] = useState(() => clockText(new Date()));
  const pageVisible = usePageVisible();

  useEffect(() => {
    if (!pageVisible) return;
    setTime(clockText(new Date()));
    const timer = setInterval(() => setTime(clockText(new Date())), 30_000);
    return () => clearInterval(timer);
  }, [pageVisible]);

  const cols = todayColumns(width);
  const left = (
    <View style={styles.leftCol}>
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

      {cols === 2 ? (
        <View style={styles.row}>
          <View style={styles.journalCol}>{left}</View>
          <View style={styles.contentCol}>
            <Radar />
            <QuestList />
            <FocusQuest />
          </View>
        </View>
      ) : (
        <View style={styles.stacked}>
          {left}
          <Radar />
          <QuestList />
          <FocusQuest />
        </View>
      )}

      <PathsRow />
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
    borderWidth: 1.5,
    borderBottomWidth: 0,
    borderColor: theme.text,
    borderRadius: theme.radius.square,
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
    borderRadius: theme.radius.square,
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
    borderWidth: 1.5,
    borderColor: theme.text,
    borderRadius: theme.radius.square,
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
  /** The asymmetric riso spread: a 38% journal column beside the content. */
  row: { flexDirection: "row", alignItems: "flex-start", gap: 24 },
  journalCol: { width: "38%", minWidth: 240, gap: 20 },
  contentCol: { flex: 1, minWidth: 0, gap: 20 },
  leftCol: { gap: 20 },
  stacked: { gap: 20 },
});
