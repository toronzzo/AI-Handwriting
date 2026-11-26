import { StyleSheet, View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { usePalette } from "../usePalette";

/**
 * The fine riso grain for the phone: the web draws the same texture with the
 * CSS noise in skyCss.ts, so this component is mounted by App.tsx on native
 * only. A deterministic scatter of tiny ink dots (seeded, no Math.random at
 * render) laid over the whole page at 5.5% opacity, pointer-events none, so
 * it reads as paper tooth, never as dirt.
 */

const DOTS = (() => {
  let seed = 987654321;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const dots: { cx: number; cy: number; r: number }[] = [];
  for (let i = 0; i < 240; i++) {
    dots.push({
      cx: Math.round(rnd() * 400),
      cy: Math.round(rnd() * 640),
      r: 0.6 + rnd() * 1.2,
    });
  }
  return dots;
})();

export function Grain() {
  const palette = usePalette();
  return (
    <View style={styles.wrap} pointerEvents="none" accessibilityElementsHidden>
      <Svg width="100%" height="100%" viewBox="0 0 400 640" preserveAspectRatio="none" accessibilityElementsHidden>
        {DOTS.map((dot, index) => (
          <Circle key={index} cx={dot.cx} cy={dot.cy} r={dot.r} fill={palette.text} />
        ))}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, opacity: 0.055 },
});
