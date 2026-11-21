import { useCallback, useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
} from "react-native";
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
  type Point,
  type StatusToken,
} from "./brainGeometry.ts";
import type { BrainDataMode, BrainNode } from "./types.ts";
import { useIdlePulse } from "./useIdlePulse.ts";
import { useLiveBrainMap } from "./useLiveBrainMap.ts";
import {
  activeNeuronIds,
  activitySummary,
  neuronToNode,
  nodeActivity,
  type MapNodeId,
  type NeuronFeed,
  type NeuronSignal,
} from "./neuronActivity.ts";
import { useNeuronFeed } from "./useNeuronFeed.ts";
import { useBrainPower } from "./useBrainPower.ts";
import { ramCheckedLine, ramRows } from "./brainPower.ts";
import type { BrainPower } from "./useBrainPower.ts";

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

type MapSize = { width: number; height: number };

/** ViewBox coordinates to the actual square the SVG was laid out in. */
function toPixels(point: Point, size: MapSize): Point {
  const edge = Math.min(size.width, size.height);
  const left = (size.width - edge) / 2;
  const top = (size.height - edge) / 2;
  return {
    x: left + (point.x / BRAIN_VIEW) * edge,
    y: top + (point.y / BRAIN_VIEW) * edge,
  };
}

function pointForNode(nodeId: MapNodeId, nodes: BrainNode[], ring: Point[]): Point {
  if (nodeId === "core") return { x: BRAIN_CX, y: BRAIN_CY };
  const index = nodes.findIndex((node) => node.id === nodeId);
  return index >= 0 ? ring[index] : { x: BRAIN_CX, y: BRAIN_CY };
}

function endpointsFor(signal: NeuronSignal, nodes: BrainNode[], ring: Point[]): { from: Point; to: Point } {
  const from =
    signal.from === "core"
      ? { x: BRAIN_CX, y: BRAIN_CY }
      : pointForNode(neuronToNode(signal.from), nodes, ring);
  const to = pointForNode(neuronToNode(signal.to), nodes, ring);
  return { from, to };
}

function samePoint(a: Point, b: Point): boolean {
  return Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) < 0.01;
}

/**
 * One soft halo made of three stacked translucent circles. The opacity and
 * scale are Animated values, so this never asks React to render a frame.
 * Active neurons switch to the faster pulse and a brighter multiplier; a
 * finished neuron keeps a gentle after-glow for a moment.
 */
function Halo({
  x,
  y,
  size,
  active,
  warm,
  core,
  palette,
  breath,
  activePulse,
}: {
  x: number;
  y: number;
  size: MapSize;
  active: boolean;
  warm: boolean;
  core?: boolean;
  palette: Record<string, string>;
  breath: Animated.Value;
  activePulse: Animated.Value;
}) {
  const pulse = active ? activePulse : breath;
  const strength = active ? 2.1 : warm ? 1.35 : 0.55;
  const base = core ? 1.55 : 1;
  const scale = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: active ? [1, 1.12] : [0.94, 1.04],
  });
  const centre = toPixels({ x, y }, size);
  const layers = [
    { size: 78 * base, low: 0.03, high: 0.08 },
    { size: 50 * base, low: 0.06, high: 0.14 },
    { size: 28 * base, low: 0.1, high: 0.22 },
  ];

  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        left: centre.x - 45 * base,
        top: centre.y - 45 * base,
        width: 90 * base,
        height: 90 * base,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {layers.map((layer, index) => (
        <Animated.View
          key={index}
          style={{
            position: "absolute",
            width: layer.size,
            height: layer.size,
            borderRadius: layer.size / 2,
            backgroundColor: palette.accent,
            opacity: pulse.interpolate({
              inputRange: [0, 1],
              outputRange: [layer.low * strength, layer.high * strength],
            }),
            transform: [{ scale }],
          }}
        />
      ))}
    </View>
  );
}

function GlowLayer({
  size,
  nodes,
  ring,
  feed,
  now,
  palette,
  breath,
  activePulse,
}: {
  size: MapSize;
  nodes: BrainNode[];
  ring: Point[];
  feed: NeuronFeed;
  now: number;
  palette: Record<string, string>;
  breath: Animated.Value;
  activePulse: Animated.Value;
}) {
  const anyActive = activeNeuronIds(feed).length > 0;
  const core = nodeActivity(feed, "core", now);

  return (
    <View pointerEvents="none" style={styles.fill}>
      {nodes.map((node, index) => {
        const activity = nodeActivity(feed, node.id as MapNodeId, now);
        return (
          <Halo
            key={node.id}
            x={ring[index].x}
            y={ring[index].y}
            size={size}
            active={activity.active}
            warm={activity.warm}
            palette={palette}
            breath={breath}
            activePulse={activePulse}
          />
        );
      })}
      <Halo
        x={BRAIN_CX}
        y={BRAIN_CY}
        size={size}
        active={anyActive || core.active}
        warm={core.warm}
        core
        palette={palette}
        breath={breath}
        activePulse={activePulse}
      />
    </View>
  );
}

const SIGNAL_MS = 1_150;

/**
 * One signal dot travelling from the neuron that was busy to the one that
 * just started. translateX/translateY keep it on the native driver; the dot
 * removes itself when its single 1.15 s journey ends.
 */
function SignalDot({
  from,
  to,
  colour,
  onDone,
}: {
  from: Point;
  to: Point;
  colour: string;
  onDone: () => void;
}) {
  const progress = useRef(new Animated.Value(0)).current;
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    const native = Platform.OS !== "web";
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: SIGNAL_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: native,
    });
    animation.start(({ finished }) => {
      if (finished) done.current();
    });
    return () => animation.stop();
  }, [progress]);

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.signalDot,
        {
          backgroundColor: colour,
          shadowColor: colour,
          opacity: progress.interpolate({
            inputRange: [0, 0.12, 0.82, 1],
            outputRange: [0, 1, 1, 0],
          }),
          transform: [
            {
              translateX: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [from.x, to.x],
              }),
            },
            {
              translateY: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [from.y, to.y],
              }),
            },
            {
              scale: progress.interpolate({
                inputRange: [0, 0.2, 1],
                outputRange: [0.6, 1.1, 0.7],
              }),
            },
          ],
        },
      ]}
    />
  );
}

/**
 * The small RAM readout under the map. It is the controller's real
 * /v1/power/status, never a guessed figure: stopped services say "stopped",
 * and a failed read keeps the last real numbers with a note.
 */
function PowerRam({ power }: { power: BrainPower }) {
  const rows = ramRows(power.status);
  const checked = ramCheckedLine(power.status);
  const source = checked || "from the Mac";

  return (
    <View style={styles.powerBlock}>
      <View style={styles.powerHead}>
        <Text style={styles.powerTitle}>RAM BY SERVICE</Text>
        <Text style={styles.powerSource}>{source}</Text>
      </View>
      {rows.length > 0 ? (
        <View style={styles.ramGrid}>
          {rows.map((row) => (
            <View
              key={row.name}
              style={styles.ramChip}
              accessible
              accessibilityLabel={row.label + ": " + row.value}
            >
              <View style={styles.ramTop}>
                <View
                  style={[
                    styles.ramDot,
                    { backgroundColor: row.running ? theme.good : theme.off },
                  ]}
                />
                <Text style={styles.ramName} numberOfLines={1}>
                  {row.label}
                </Text>
              </View>
              <Text style={styles.ramValue}>{row.value}</Text>
            </View>
          ))}
        </View>
      ) : (
        <Text style={styles.powerDim}>
          {power.error || (power.loading ? "Asking the Mac for RAM…" : "No RAM figures were reported.")}
        </Text>
      )}
      {rows.length > 0 && power.error ? <Text style={styles.powerNote}>{power.error}</Text> : null}
    </View>
  );
}

/**
 * The Brain view: a central Preyas node with the connected brains around it.
 * Read-only — tapping a node opens a short description. The local model,
 * router and cloud slots still show the live health status; the same map now
 * also carries the brain's live neuron feed: a soft breath when idle, a
 * brighter pulse for neurons in use, and one travelling signal when a new
 * neuron starts. Reduced motion stops every pulse and every journey at a
 * still, readable glow.
 */
export function BrainScreen() {
  const map = useLiveBrainMap();
  const palette = usePalette();
  const { width } = useWindowDimensions();
  const wide = isWide(width);
  const { feed, error: feedError } = useNeuronFeed();
  const power = useBrainPower();
  const { breath, activePulse, reduce } = useIdlePulse();
  const [selectedId, setSelectedId] = useState<string>(map.core.id);
  const [size, setSize] = useState<MapSize | null>(null);
  const [signals, setSignals] = useState<NeuronSignal[]>([]);
  const seenSignals = useRef(new Set<string>());

  const all: BrainNode[] = [map.core, ...map.nodes];
  const selected = all.find((node) => node.id === selectedId) ?? map.core;
  const ring = brainRingPoints(map.nodes.length);
  const now = Date.now();
  const active = activeNeuronIds(feed);
  const summary = activitySummary(feed, now);
  const activityLine = feedError ? summary + " · " + feedError : summary;
  const mapSummary =
    map.mode === "live" ? "Live status" : map.mode === "stale" ? "Last known status" : "Demo status";
  const mapNote = reduce
    ? map.note + " Reduced motion is on, so the glows stay still."
    : map.note;

  const selectedActivity =
    selected.id === map.core.id
      ? nodeActivity(feed, "core", now)
      : nodeActivity(feed, selected.id as MapNodeId, now);

  // Feed signals are folded into a tiny local queue so a parent re-render
  // never replays the same dot. Old signals are ignored after a tab switch.
  useEffect(() => {
    const fresh = feed.signals.filter(
      (signal) => !seenSignals.current.has(signal.id) && signal.at > Date.now() - 2_500,
    );
    if (fresh.length === 0) return;
    for (const signal of fresh) seenSignals.current.add(signal.id);
    setSignals((previous) => [...previous, ...fresh].slice(-4));
  }, [feed.signals]);

  useEffect(() => {
    if (reduce) setSignals([]);
  }, [reduce]);

  const finishSignal = useCallback((id: string) => {
    setSignals((previous) => previous.filter((signal) => signal.id !== id));
  }, []);

  const onMapLayout = (event: LayoutChangeEvent) => {
    const { width: layoutWidth, height: layoutHeight } = event.nativeEvent.layout;
    setSize((previous) =>
      previous &&
      Math.abs(previous.width - layoutWidth) < 1 &&
      Math.abs(previous.height - layoutHeight) < 1
        ? previous
        : { width: layoutWidth, height: layoutHeight },
    );
  };

  const visibleSignals = reduce
    ? []
    : signals.filter((signal) => {
        const points = endpointsFor(signal, map.nodes, ring);
        return !samePoint(points.from, points.to);
      });

  const badge = badgeFor(map.mode);

  const mapPanel = (
    <Panel style={styles.mapPanel}>
      <View style={styles.headerRow}>
        <Text style={styles.heading} accessibilityRole="header">
          BRAIN
        </Text>
        <View
          style={[styles.badge, { backgroundColor: badge.background }]}
          accessible
          accessibilityLabel={"Data source: " + badge.label}
        >
          <Text style={[styles.badgeText, { color: badge.colour }]}>{badge.label}</Text>
        </View>
      </View>
      <Text style={styles.subtitle}>
        Preyas's brains at a glance — tap a node to see what it does.
      </Text>
      <Text style={styles.mapNote}>{mapNote}</Text>

      <View
        accessible
        accessibilityLabel={
          mapSummary +
          ". Brain map. " +
          map.core.name +
          " at the centre, " +
          map.nodes.length +
          " connected brains. " +
          activityLine
        }
      >
        <View style={styles.mapShell} onLayout={onMapLayout}>
          <Svg
            viewBox={"0 0 " + BRAIN_VIEW + " " + BRAIN_VIEW}
            style={styles.chartSvg}
            accessibilityElementsHidden
          >
            {map.nodes.map((node, index) => {
              const p = ring[index];
              const activity = nodeActivity(feed, node.id as MapNodeId, now);
              return (
                <Line
                  key={node.id}
                  x1={BRAIN_CX}
                  y1={BRAIN_CY}
                  x2={p.x}
                  y2={p.y}
                  stroke={withAlpha(palette.text, activity.active ? 0.3 : 0.16)}
                  strokeWidth={activity.active ? 2 : 1.5}
                />
              );
            })}

            {visibleSignals.map((signal) => {
              const points = endpointsFor(signal, map.nodes, ring);
              return (
                <Line
                  key={signal.id}
                  x1={points.from.x}
                  y1={points.from.y}
                  x2={points.to.x}
                  y2={points.to.y}
                  stroke={withAlpha(palette.accent, 0.5)}
                  strokeWidth={1.6}
                  strokeDasharray="4 5"
                />
              );
            })}

            <Circle
              cx={BRAIN_CX}
              cy={BRAIN_CY}
              r={48}
              stroke={withAlpha(palette.accent, 0.16)}
              strokeWidth={1.5}
              fill="none"
            />

            <G onPress={() => setSelectedId(map.core.id)}>
              <Circle cx={BRAIN_CX} cy={BRAIN_CY} r={34} fill={palette.accent} />
              <Circle
                cx={BRAIN_CX}
                cy={BRAIN_CY}
                r={34}
                stroke={palette.card}
                strokeWidth={4}
                fill="none"
              />
              <SvgText
                x={BRAIN_CX}
                y={BRAIN_CY + 4}
                textAnchor="middle"
                fontSize={13}
                fontWeight="700"
                fill={palette.onAccent}
              >
                {map.core.name}
              </SvgText>
            </G>

            {map.nodes.map((node, index) => {
              const p = ring[index];
              const colour = statusColour(palette, STATUS_TOKEN[node.status]);
              const activity = nodeActivity(feed, node.id as MapNodeId, now);
              const on = node.id === selectedId;
              return (
                <G key={node.id} onPress={() => setSelectedId(node.id)}>
                  {on ? (
                    <Circle
                      cx={p.x}
                      cy={p.y}
                      r={20}
                      stroke={palette.accent}
                      strokeWidth={2.5}
                      fill="none"
                    />
                  ) : null}
                  <Circle cx={p.x} cy={p.y} r={13} fill={colour} stroke={palette.card} strokeWidth={3} />
                  <SvgText
                    x={p.x}
                    y={p.y + 32}
                    textAnchor="middle"
                    fontSize={12}
                    fontWeight={activity.active ? "700" : "600"}
                    fill={activity.active ? palette.accent : palette.text}
                  >
                    {node.name}
                  </SvgText>
                </G>
              );
            })}
          </Svg>

          {size ? (
            <GlowLayer
              size={size}
              nodes={map.nodes}
              ring={ring}
              feed={feed}
              now={now}
              palette={palette}
              breath={breath}
              activePulse={activePulse}
            />
          ) : null}

          {size && !reduce
            ? visibleSignals.map((signal) => {
                const points = endpointsFor(signal, map.nodes, ring);
                return (
                  <SignalDot
                    key={signal.id}
                    from={toPixels(points.from, size)}
                    to={toPixels(points.to, size)}
                    colour={palette.accent}
                    onDone={() => finishSignal(signal.id)}
                  />
                );
              })
            : null}
        </View>
      </View>

      <View
        style={styles.activityRow}
        accessible
        accessibilityLabel={"Neuron activity: " + activityLine}
      >
        <View
          style={[
            styles.activityDot,
            { backgroundColor: active.length > 0 ? palette.accent : theme.off },
          ]}
        />
        <Text style={styles.activityText} numberOfLines={2}>
          {activityLine}
        </Text>
      </View>

      <PowerRam power={power} />
    </Panel>
  );

  const detail = (
    <Panel style={styles.detailPanel}>
      <View style={styles.detailHead}>
        <View
          style={[
            styles.dot,
            { backgroundColor: statusColour(palette, STATUS_TOKEN[selected.status]) },
          ]}
        />
        <Text style={styles.detailName}>{selected.name}</Text>
      </View>
      <Text style={styles.detailStatus}>{STATUS_LABEL[selected.status]}</Text>
      {selectedActivity.active ? (
        <Text style={styles.detailActive}>
          Active now — {selectedActivity.labels.join(" · ")}
        </Text>
      ) : null}
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

  fill: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, zIndex: 0 },

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

  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
  },
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

  mapShell: {
    width: "100%",
    maxWidth: 480,
    aspectRatio: 1,
    alignSelf: "center",
    position: "relative",
  },
  chartSvg: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, zIndex: 1 },

  signalDot: {
    position: "absolute",
    left: 0,
    top: 0,
    width: 10,
    height: 10,
    marginLeft: -5,
    marginTop: -5,
    borderRadius: 5,
    zIndex: 2,
    shadowOpacity: 0.8,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
    elevation: 4,
  },

  activityRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 8,
    marginBottom: 2,
  },
  activityDot: { width: 8, height: 8, borderRadius: 4 },
  activityText: {
    color: theme.dim,
    fontSize: theme.type.caption,
    fontWeight: "600",
    flex: 1,
  },

  powerBlock: {
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: theme.accentLine,
  },
  powerHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  powerTitle: {
    color: theme.dim,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.1,
  },
  powerSource: { color: theme.faint, fontSize: 11 },
  ramGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  ramChip: {
    flexBasis: 132,
    flexGrow: 1,
    minWidth: 128,
    backgroundColor: theme.cardSoft,
    borderRadius: 8,
    paddingVertical: 7,
    paddingHorizontal: 10,
    gap: 2,
  },
  ramTop: { flexDirection: "row", alignItems: "center", gap: 6 },
  ramDot: { width: 7, height: 7, borderRadius: 4 },
  ramName: { color: theme.dim, fontSize: 11, flexShrink: 1 },
  ramValue: { color: theme.text, fontSize: 13, fontWeight: "700" },
  powerDim: { color: theme.dim, fontSize: theme.type.caption, lineHeight: 18, marginTop: 8 },
  powerNote: { color: theme.note, fontSize: 11, lineHeight: 16, marginTop: 6 },

  detailHead: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 4 },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: theme.accentLine,
  },
  detailName: {
    fontFamily: theme.font.display,
    fontWeight: "700",
    fontSize: theme.type.display.section,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    color: theme.text,
  },
  detailStatus: {
    color: theme.accent,
    fontSize: theme.type.caption,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 8,
  },
  detailActive: {
    color: theme.accent,
    fontSize: theme.type.caption,
    fontWeight: "700",
    marginBottom: 8,
  },
  detailNote: { color: theme.text, fontSize: theme.type.body, lineHeight: theme.lead, marginBottom: 10 },
  detailBody: { color: theme.dim, fontSize: theme.type.body, lineHeight: theme.lead },
  detailSource: { color: theme.faint, fontSize: 11, lineHeight: 15, marginTop: 12 },
  detailStripe: { marginTop: 14 },
});
