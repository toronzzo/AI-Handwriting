import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { AREAS, type QuestState } from "../rpg/types.ts";
import { theme } from "../theme";
import { Panel } from "../ui/Panel";
import { usePalette } from "../usePalette";
import { useRpg } from "./useRpg";

/** One quest row: check box, title, progress hint and the +5 XP chip. */
function QuestRow({ quest, onToggle }: { quest: QuestState; onToggle: () => void }) {
  const [hovered, setHovered] = useState(false);
  const palette = usePalette();
  const areaName = AREAS.find((row) => row.id === quest.area)?.name ?? quest.area;

  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: quest.done }}
      accessibilityLabel={quest.title}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      onPress={onToggle}
      style={[styles.row, hovered && styles.rowHover]}
    >
      <View style={[styles.box, quest.done && styles.boxDone]}>
        {quest.done ? (
          <Svg width={20} height={20} viewBox="0 0 20 20" accessibilityElementsHidden>
            <Path
              d="M4.5 10.6 L8.2 14.2 L15.6 5.8"
              stroke={palette.onAccent}
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          </Svg>
        ) : null}
      </View>
      <Text style={[styles.title, quest.done && styles.titleDone]} numberOfLines={1}>
        {quest.title}
      </Text>
      {quest.sub ? <Text style={styles.sub}>{quest.sub}</Text> : null}
      <View style={styles.chip}>
        <Text style={styles.chipText}>
          +{quest.bonusXp} {areaName}
        </Text>
      </View>
    </Pressable>
  );
}

/**
 * The daily quests (right column of the Today screen). Tapping a quest
 * toggles it in the source, which moves the XP numbers and the radar.
 */
export function QuestList() {
  const { snapshot, source } = useRpg();
  const done = snapshot.quests.filter((quest) => quest.done).length;

  return (
    <Panel>
      <View style={styles.header}>
        <Text style={styles.heading} accessibilityRole="header">QUESTS</Text>
        <Text style={styles.count}>
          {done}/{snapshot.quests.length}
        </Text>
      </View>
      <View style={styles.list}>
        {snapshot.quests.map((quest) => (
          <QuestRow
            key={quest.id}
            quest={quest}
            onToggle={() => source.toggleQuest?.(quest.id)}
          />
        ))}
      </View>
    </Panel>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  heading: {
    color: theme.dim,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  count: {
    color: theme.accentText,
    fontSize: 12,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  list: { gap: 4 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 44,
    paddingVertical: 9,
    paddingHorizontal: 8,
    borderRadius: 10,
  },
  rowHover: { backgroundColor: theme.cardSoft },
  box: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: theme.faint,
    alignItems: "center",
    justifyContent: "center",
  },
  boxDone: {
    backgroundColor: theme.accent,
    borderColor: theme.accent,
  },
  title: {
    flex: 1,
    color: theme.text,
    fontSize: 14,
    fontWeight: "500",
  },
  titleDone: {
    textDecorationLine: "line-through",
    color: theme.dim,
  },
  sub: {
    color: theme.dim,
    fontSize: 12.5,
    fontVariant: ["tabular-nums"],
  },
  chip: {
    borderWidth: 1,
    borderColor: theme.lineStrong,
    borderRadius: 999,
    paddingVertical: 1,
    paddingHorizontal: 9,
  },
  chipText: {
    color: theme.dim,
    fontSize: 12,
    fontWeight: "600",
  },
});
