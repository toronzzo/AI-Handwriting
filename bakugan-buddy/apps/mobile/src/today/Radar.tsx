import { useEffect, useRef, useState } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";
import Svg, { Circle, G, Line, Polygon, Text as SvgText } from "react-native-svg";
import { AREAS, type AreaId } from "../rpg/types.ts";
import { theme } from "../theme";
import { Panel } from "../ui/Panel";
import { useReducedMotion } from "../ui/useReducedMotion";
import { usePalette } from "../usePalette";
import { radarAxisDirection, radarPoints, type RadarPoint } from "./radarGeometry.ts";
import { useRpg } from "./useRpg";

/** The square SVG viewBox. */
const VIEW = 400;
const CX = VIEW / 2;
const CY = VIEW / 2;
/** Outer ring radius, leaving room for the labels inside the viewBox. */
const RADIUS = 128;
/** How far the label block sits beyond the outer ring. */
const LABEL_GAP = 34;

/** Turn a palette hex into the same colour with a different alpha, for the
 *  SVG grid and polygon fills (CSS var() strings do not work in SVG). */
function withAlpha(hex: string, alpha: number): string {
  const value = hex.replace("#", "");
  const n = parseInt(value, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

/**
 * The ring pulse that shows on a dot whose area just gained XP: the stroke
 * circle grows from r 6 to r 20 while fading over 900 ms. Nothing is shown
 * when the user prefers reduced motion.
 */
function Pulse({ x, y, colour }: { x: number; y: number; colour: string }) {
  const anim = useRef(new Animated.Value(0)).current;
  const [t, setT] = useState(0);

  useEffect(() => {
    const id = anim.addListener(({ value }) => setT(value));
    return () => anim.removeListener(id);
  }, [anim]);

  useEffect(() => {
    anim.setValue(0);
    // JS driver: the web app has no native animated module, and these are tiny.
    Animated.timing(anim, { toValue: 1, duration: 900, useNativeDriver: false }).start();
  }, [anim]);

  const r = 6 + (20 - 6) * t;
  return (
    <Circle cx={x} cy={y} r={r} stroke={colour} strokeWidth={2} fill="none" opacity={1 - t} />
  );
}

/**
 * The 6-axis radar (centre column of the Today screen): Body, Mind, Money,
 * Spirit, Craft and Goal, starting at the top and going clockwise. When an
 * area gains XP the polygon morphs to its new shape over 600 ms and a ring
 * pulse marks the dot; both are skipped with reduced motion.
 */
export function Radar() {
  const { snapshot } = useRpg();
  const palette = usePalette();
  const reduce = useReducedMotion();

  const values = AREAS.map((area) => snapshot.areaValue[area.id]);

  const prevValues = useRef<number[]>(values);
  const fromRef = useRef<RadarPoint[] | null>(null);
  const morph = useRef(new Animated.Value(1)).current;
  const [morphT, setMorphT] = useState(1);
  const pulseId = useRef(0);
  const [pulses, setPulses] = useState<{ id: number; area: AreaId }[]>([]);

  useEffect(() => {
    const id = morph.addListener(({ value }) => setMorphT(value));
    return () => morph.removeListener(id);
  }, [morph]);

  useEffect(() => {
    const before = prevValues.current;
    prevValues.current = values;

    const gains: AreaId[] = [];
    AREAS.forEach((area, i) => {
      if (values[i] > (before[i] ?? 0)) gains.push(area.id);
    });
    if (!gains.length) return;

    if (reduce) {
      fromRef.current = null;
      morph.setValue(1);
      return;
    }

    fromRef.current = radarPoints(before, CX, CY, RADIUS);
    morph.setValue(0);
    // JS driver: the web app has no native animated module, and these are tiny.
    Animated.timing(morph, { toValue: 1, duration: 600, useNativeDriver: false }).start();

    const added = gains.map((area) => ({ id: pulseId.current++, area }));
    setPulses((list) => [...list, ...added]);
    const timer = setTimeout(() => {
      setPulses((list) => list.filter((pulse) => !added.some((row) => row.id === pulse.id)));
    }, 900);
    return () => clearTimeout(timer);
  }, [values, reduce, morph]);

  const target = radarPoints(values, CX, CY, RADIUS);
  const from = fromRef.current;
  const points: RadarPoint[] =
    from && morphT < 1
      ? target.map((point, i) => ({
          x: from[i].x + (point.x - from[i].x) * morphT,
          y: from[i].y + (point.y - from[i].y) * morphT,
        }))
      : target;

  const polygon = points.map((point) => `${point.x},${point.y}`).join(" ");
  const gridStroke = withAlpha(palette.text, 0.18);
  const label = `Radar. ${AREAS.map(
    (area) => `${area.name} ${Math.floor(snapshot.areaValue[area.id])}`,
  ).join(", ")}`;

  return (
    <Panel>
      <View style={styles.header}>
        <Text style={styles.heading} accessibilityRole="header">RADAR</Text>
      </View>
      <View accessible accessibilityLabel={label}>
        <Svg
          viewBox={`0 0 ${VIEW} ${VIEW}`}
          style={styles.chart}
          accessibilityElementsHidden
        >
          {[2.5, 5, 7.5, 10].map((ring) => (
            <Circle
              key={ring}
              cx={CX}
              cy={CY}
              r={(RADIUS * ring) / 10}
              stroke={gridStroke}
              strokeWidth={1}
              fill="none"
            />
          ))}
          {AREAS.map((area, i) => {
            const dir = radarAxisDirection(i);
            return (
              <Line
                key={area.id}
                x1={CX}
                y1={CY}
                x2={CX + dir.x * RADIUS}
                y2={CY + dir.y * RADIUS}
                stroke={gridStroke}
                strokeWidth={1}
              />
            );
          })}
          <Polygon
            points={polygon}
            fill={withAlpha(palette.accent, 0.2)}
            stroke={palette.accent}
            strokeWidth={2.5}
            strokeLinejoin="round"
          />
          {points.map((point, i) => (
            <Circle
              key={AREAS[i].id}
              cx={point.x}
              cy={point.y}
              r={5}
              fill={palette.accent}
              stroke={palette.card}
              strokeWidth={3}
            />
          ))}
          {!reduce &&
            pulses.map((pulse) => {
              const i = AREAS.findIndex((area) => area.id === pulse.area);
              return <Pulse key={pulse.id} x={target[i].x} y={target[i].y} colour={palette.accent} />;
            })}
          {AREAS.map((area, i) => {
            const dir = radarAxisDirection(i);
            const x = CX + dir.x * (RADIUS + LABEL_GAP);
            const y = CY + dir.y * (RADIUS + LABEL_GAP);
            return (
              <G key={area.id}>
                <SvgText x={x} y={y} textAnchor="middle" fontSize={14} fontWeight="600" fill={palette.text}>
                  {area.name}
                </SvgText>
                <SvgText x={x} y={y + 15} textAnchor="middle" fontSize={12} fontWeight="500" fill={palette.dim}>
                  Lv {Math.floor(snapshot.areaValue[area.id])}
                </SvgText>
              </G>
            );
          })}
        </Svg>
      </View>
    </Panel>
  );
}

const styles = StyleSheet.create({
  header: { marginBottom: 8 },
  heading: {
    color: theme.dim,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  chart: {
    width: "100%",
    maxHeight: 400,
    aspectRatio: 1,
  },
});
