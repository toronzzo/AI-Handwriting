import { useRef } from "react";
import { StyleSheet, View, type ViewStyle } from "react-native";
import Svg, { Circle, Defs, Pattern } from "react-native-svg";
import { withAlpha } from "../palette";
import { theme } from "../theme";
import { usePalette } from "../usePalette";

/**
 * The small riso print elements the Today cards draw with: a halftone disc
 * (blue print with paper-coloured dots and a thin ink ring) and the printed
 * XP bar (square track, 1.5 px ink rule, solid fill and ink tick marks).
 * Colours come from the live palette because SVG attributes and view
 * backgrounds cannot take CSS var() strings.
 */

let discSeq = 0;

/** A halftone print disc: solid blue, paper dots, 1.5 px ring. */
export function HalftoneDisc({
  size = 220,
  style,
}: {
  size?: number;
  style?: ViewStyle | ViewStyle[];
}) {
  const palette = usePalette();
  const patternId = useRef(`halftone-${discSeq++}`).current;
  return (
    <View
      style={[{ width: size, height: size }, style]}
      pointerEvents="none"
      accessibilityElementsHidden
    >
      <Svg width="100%" height="100%" viewBox="0 0 200 200">
        <Defs>
          <Pattern id={patternId} width={14} height={14} patternUnits="userSpaceOnUse">
            <Circle cx={7} cy={7} r={2.2} fill={palette.card} />
          </Pattern>
        </Defs>
        <Circle cx={100} cy={100} r={99} fill={palette.blue} />
        <Circle cx={100} cy={100} r={99} fill={`url(#${patternId})`} />
        <Circle cx={100} cy={100} r={99.25} stroke={palette.text} strokeWidth={1.5} fill="none" />
      </Svg>
    </View>
  );
}

/**
 * The printed progress bar: a square track with a 1.5 px ink rule, a solid
 * fill and vertical tick marks at the given fractions (defaults to the
 * quarters). Carries the progressbar role itself.
 */
export function PrintedBar({
  pct,
  min,
  max,
  now,
  label,
  style,
  ticks = [0.25, 0.5, 0.75],
}: {
  /** Fill fraction, 0..100. */
  pct: number;
  min: number;
  max: number;
  now: number;
  label: string;
  style?: ViewStyle | ViewStyle[];
  ticks?: number[];
}) {
  const palette = usePalette();
  const fillWidth = `${Math.min(100, Math.max(0, pct))}%` as const;
  return (
    <View
      style={[styles.bar, style]}
      accessibilityRole="progressbar"
      accessibilityValue={{ min, max, now }}
      accessibilityLabel={label}
    >
      <View style={[styles.fill, { width: fillWidth }]} />
      {ticks.map((tick) => (
        <View
          key={tick}
          style={[styles.tick, { left: `${tick * 100}%`, backgroundColor: withAlpha(palette.text, 0.4) }]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    height: 14,
    borderRadius: theme.radius.square,
    borderWidth: 1.5,
    borderColor: theme.text,
    backgroundColor: theme.track,
    overflow: "hidden",
  },
  fill: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: theme.accent,
  },
  tick: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: 1.5,
  },
});
