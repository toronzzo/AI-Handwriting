import { useState } from "react";
import { ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import Svg, { Circle, G, Line, Text as SvgText } from "react-native-svg";
import { isWide } from "../layout";
import { theme } from "../theme";
import { Panel } from "../ui/Panel";
import { Stripe } from "../ui/Stripe";
import { usePalette } from "../usePalette";
import { withAlpha } from "../palette.ts";
import { brainSourceLine } from "./liveBrain.ts";
import {
  BRAIN_CX,
  BRAIN_CY,
  BRAIN_VIEW,
  brainRingPoints,
  STATUS_LABEL,
  STATUS_TOKEN,
  type StatusToken,
} from "./brainGeometry.ts";
import type { BrainDataMode, BrainNode } from "./types.ts";
import { useIdlePulse } from "./useIdlePulse.ts";
import { useLiveBrainMap } from "./useLiveBrainMap.ts";

/** The little circle that marks one node's status. */
function statusColour(palette: Record<string, string>, token: StatusToken): string {
  return palette[token] ?? palette.accent;
}

/**
 * The source badge: live, demo, checking, or the last good reading.
 * All four use existing theme tokens; none uses the danger colour.
 */
function badgeFor(mode: BrainDataMode): { label: string; background: string; colour: string } {
  switch (mode) {
    case "live":
      return { label: "LIVE", background: theme.accent, colour: theme.onAccent };
    case "stale":
      return { label: "LAST CHECK", background: theme.track, colour: theme.text };
    case "offline":
      return { label: "OFFLINE · DEMO", background: theme.track, colour: theme.text };
    case "loading":
      return { label: "CHECKING", background: theme.track, colour: theme.text };
    default:
      return { label: "DEMO DATA", background: theme.accent, colour: theme.onAccent };
  }
}

/**
 * The Brain view: a central Preyas node with the six connected brains around
 * it. Read-only — tapping a node opens a short description. The local model
 * and router show real status when the Mac answers; otherwise the map keeps
 * the static descriptions and says plainly that it is demo data. The map
 * breathes faintly while visible, and sits still under reduced motion or a
 * hidden tab.
 */
export function BrainScreen() {
  const map = useLiveBrainMap();
  const palette = usePalette();
  const { width } = useWindowDimensions();
  const wide = isWide(width);
  const pulse = useIdlePulse();
  const [selectedId, setSelectedId] = useState<string>(map.core.id);

  const all: BrainNode[] = [map.core, ...map.nodes];
  const selected = all.find((node) => node.id === selectedId) ?? map.core;

  const ring = brainRingPoints(map.nodes.length);
  // The faint breathing: the core ring swells a little and the links dim, a
  // single slow wave across the whole map. ~ +/-3px, never a flash.
  const breathe = 1 + pulse * 0.06;
  const coreR = 34 * breathe;
  const linkPulse = 1 - pulse * 0.35;

  const badge = badgeFor(map.mode);
  const mapSummary =
    map.mode === "live" ? "Live status" : map.mode === "stale" ? "Last known status" : "Demo status";

  const mapPanel = (
    <Panel style={styles.mapPanel}>
      <View style={styles.headerRow}>
        <Text style={styles.heading} accessibilityRole="header">BRAIN</Text>
        <View
          style={[styles.badge, { backgroundColor: badge.background }]}
          accessible
          accessibilityLabel={`Data source: ${badge.label}`}
        >
          <Text style={[styles.badgeText, { color: badge.colour }]}>{badge.label}</Text>
        </View>
      </View>
      <Text style={styles.subtitle}>
        Preyas's brains at a glance — tap a node to see what it does.
      </Text>
      <Text style={styles.mapNote}>{map.note}</Text>
      <View accessible accessibilityLabel={`${mapSummary}. Brain map. ${map.core.name} at the centre, ${map.nodes.length} connected brains.`}>
        <Svg viewBox={`0 0 ${BRAIN_VIEW} ${BRAIN_VIEW}`} style={styles.chart} accessibilityElementsHidden>
          {/* link back to the core, drawn first so the dots paint over it */}
          {map.nodes.map((node, i) => {
            const p = ring[i];
            return (
              <Line
                key={node.id}
                x1={BRAIN_CX}
                y1={BRAIN_CY}
                x2={p.x}
                y2={p.y}
                stroke={withAlpha(palette.text, 0.18 * linkPulse)}
                strokeWidth={1.5}
              />
            );
          })}

          {/* the faint outer breathing ring around the core */}
          <Circle
            cx={BRAIN_CX}
            cy={BRAIN_CY}
            r={coreR + 14}
            stroke={withAlpha(palette.accent, 0.16)}
            strokeWidth={1.5}
            fill="none"
          />

          {/* core node */}
          <G onPress={() => setSelectedId(map.core.id)}>
            <Circle cx={BRAIN_CX} cy={BRAIN_CY} r={coreR} fill={palette.accent} />
            <Circle cx={BRAIN_CX} cy={BRAIN_CY} r={coreR} stroke={palette.card} strokeWidth={4} fill="none" />
            <SvgText x={BRAIN_CX} y={BRAIN_CY + 4} textAnchor="middle" fontSize={13} fontWeight="700" fill={palette.onAccent}>
              {map.core.name}
            </SvgText>
          </G>

          {/* connected nodes */}
          {map.nodes.map((node, i) => {
            const p = ring[i];
            const colour = statusColour(palette, STATUS_TOKEN[node.status]);
            const on = node.id === selectedId;
            return (
              <G key={node.id} onPress={() => setSelectedId(node.id)}>
                {on ? (
                  <Circle cx={p.x} cy={p.y} r={20} stroke={palette.accent} strokeWidth={2.5} fill="none" />
                ) : null}
                <Circle cx={p.x} cy={p.y} r={13} fill={colour} stroke={palette.card} strokeWidth={3} />
                <SvgText
                  x={p.x}
                  y={p.y + 32}
                  textAnchor="middle"
                  fontSize={12}
                  fontWeight="600"
                  fill={palette.text}
                >
                  {node.name}
                </SvgText>
              </G>
            );
          })}
        </Svg>
      </View>
    </Panel>
  );

  const detail = (
    <Panel style={styles.detailPanel}>
      <View style={styles.detailHead}>
        <View style={[styles.dot, { backgroundColor: statusColour(palette, STATUS_TOKEN[selected.status]) }]} />
        <Text style={styles.detailName}>{selected.name}</Text>
      </View>
      <Text style={styles.detailStatus}>{STATUS_LABEL[selected.status]}</Text>
      {selected.statusNote ? <Text style={styles.detailNote}>{selected.statusNote}</Text> : null}
      <Text style={styles.detailBody}>{selected.description}</Text>
      <Text style={styles.detailSource}>{brainSourceLine(map, selected)}</Text>
      <View style={styles.detailStripe}>
        <Stripe height={4} width={56} />
      </View>
    </Panel>
  );

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.pad}>
      <View style={styles.header}>
        <View style={styles.brandChip}>
          <Text style={styles.brandText}>PREYAS</Text>
        </View>
        <Text style={styles.brandNote}>Brain · read-only view</Text>
      </View>

      {wide ? (
        <View style={styles.row}>
          <View style={styles.mapCol}>{mapPanel}</View>
          <View style={styles.detailCol}>{detail}</View>
        </View>
      ) : (
        <View style={styles.stacked}>
          {mapPanel}
          {detail}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  pad: { padding: 24, paddingBottom: 24 },

  header: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 20 },
  brandChip: {
    backgroundColor: theme.card,
    borderRadius: 10,
    paddingVertical: 6,
    paddingHorizontal: 14,
  },
  brandText: {
    fontFamily: theme.font.display,
    fontWeight: "700",
    fontSize: 24,
    textTransform: "uppercase",
    letterSpacing: 0.64,
    color: theme.text,
  },
  brandNote: { color: theme.dim, fontSize: theme.type.caption, fontWeight: "600" },

  row: { flexDirection: "row", alignItems: "flex-start", gap: 20 },
  stacked: { gap: 20 },

  mapCol: { flex: 1, minWidth: 0 },
  detailCol: { width: 300, flexShrink: 0 },

  mapPanel: {},
  detailPanel: {},

  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 },
  heading: {
    color: theme.dim,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  subtitle: { color: theme.dim, fontSize: theme.type.caption, marginBottom: 4 },
  mapNote: { color: theme.faint, fontSize: 11, lineHeight: 16, marginBottom: 8 },

  badge: {
    borderRadius: 5,
    paddingVertical: 2,
    paddingHorizontal: 8,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.1,
    textTransform: "uppercase",
  },

  chart: { width: "100%", maxHeight: 420, aspectRatio: 1 },

  detailHead: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 4 },
  dot: { width: 12, height: 12, borderRadius: 6, borderWidth: 1, borderColor: theme.accentLine },
  detailName: {
    fontFamily: theme.font.display,
    fontWeight: "700",
    fontSize: theme.type.display.section,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    color: theme.text,
  },
  detailStatus: { color: theme.accent, fontSize: theme.type.caption, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 8 },
  detailNote: { color: theme.text, fontSize: theme.type.body, lineHeight: theme.lead, marginBottom: 10 },
  detailBody: { color: theme.dim, fontSize: theme.type.body, lineHeight: theme.lead },
  detailSource: { color: theme.faint, fontSize: 11, lineHeight: 15, marginTop: 12 },
  detailStripe: { marginTop: 14 },
});
