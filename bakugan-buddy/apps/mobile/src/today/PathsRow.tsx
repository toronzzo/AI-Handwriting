import { StyleSheet, Text, useWindowDimensions, View } from "react-native";
import type { PathState } from "../rpg/types.ts";
import { theme } from "../theme";
import { ArtSlot } from "../ui/ArtSlot";
import { Panel } from "../ui/Panel";
import { SectionTitle } from "../ui/SectionTitle";
import { useRpg } from "./useRpg";

/** The picture each long path uses: the slot names are the path ids. */
const PATH_SLOTS = ["house", "car", "study", "bakugan-buddy", "studio"] as const;

/** Below this the five cards wrap to two columns, below the second to one. */
const TWO_COLUMN_MIN = 700;
const FIVE_COLUMN_MIN = 1100;

function columnsFor(width: number): number {
  if (width >= FIVE_COLUMN_MIN) return 5;
  if (width >= TWO_COLUMN_MIN) return 2;
  return 1;
}

/**
 * One path: its picture on top, the name, the percent and a thin bar. The
 * picture is editable, so the user can change it from here (slice 10b).
 */
function PathCard({ path }: { path: PathState }) {
  const pct = Math.max(0, Math.min(100, Math.round(path.pct)));
  return (
    <Panel padding={0} style={styles.card}>
      <View style={styles.picture}>
        <ArtSlot slot={path.id} aspectRatio={16 / 10} radius={0} editable />
      </View>
      <View style={styles.body}>
        <View style={styles.nameRow}>
          <Text style={styles.name} numberOfLines={1}>
            {path.name}
          </Text>
          <Text style={styles.pct}>{pct}%</Text>
        </View>
        <View
          style={styles.track}
          accessibilityRole="progressbar"
          accessibilityValue={{ min: 0, max: 100, now: pct }}
          accessibilityLabel={`${path.name}: ${pct} percent`}
        >
          <View style={[styles.fill, { width: `${pct}%` as const }]} />
        </View>
      </View>
    </Panel>
  );
}

/**
 * The PATHS row: the five long paths (house, car, study, bakugan-buddy, studio)
 * as small paper cards with the user's own picture at the top. Five across on a
 * wide Mac, two or one on a narrow window or a phone.
 */
export function PathsRow() {
  const { snapshot } = useRpg();
  const { width } = useWindowDimensions();
  const cols = columnsFor(width);
  const gap = 16;
  const basis = cols === 1 ? "100%" : cols === 2 ? "48%" : "18%";

  // The five slots in a fixed order, even if a source ever returns fewer rows.
  const byId = new Map(snapshot.paths.map((path) => [path.id, path]));
  const rows: PathState[] = PATH_SLOTS.map(
    (id) => byId.get(id) ?? { id, name: id === "bakugan-buddy" ? "Bakugan Buddy" : id, pct: 0 },
  );

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <SectionTitle>PATHS</SectionTitle>
      </View>
      <View style={[styles.row, { gap }]}>
        {rows.map((path) => (
          <View key={path.id} style={cols === 1 ? { width: "100%" } : { width: basis, minWidth: 220 }}>
            <PathCard path={path} />
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 20 },
  head: { alignItems: "flex-start", marginBottom: 12 },
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "stretch" },
  card: { overflow: "hidden", flex: 1 },
  picture: { width: "100%" },
  body: { paddingHorizontal: 14, paddingVertical: 12, gap: 8 },
  nameRow: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 8 },
  name: { color: theme.text, fontSize: 16, fontWeight: "700", flexShrink: 1 },
  pct: {
    color: theme.accentText,
    fontSize: 14,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  track: {
    height: 6,
    borderRadius: 99,
    backgroundColor: theme.track,
    overflow: "hidden",
  },
  fill: { height: "100%", backgroundColor: theme.accent, borderRadius: 99 },
});
