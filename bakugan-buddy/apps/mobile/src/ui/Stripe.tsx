import { StyleSheet, View } from "react-native";
import { theme } from "../theme";

/**
 * The little Preyas stripe: three thin bars stacked in the yellow → orange →
 * red brand order, with a 2px gap by default. This is the ONLY place the
 * stripe colours are used, so every stripe in the app (the rail logo,
 * headings, the Focus quest panel edge, …) renders through here.
 */
export function Stripe({
  height = 3,
  width = "100%",
  gap = 2,
}: {
  height?: number;
  width?: number | string;
  /** Gap between the bars; the Focus quest panel edge uses 0. */
  gap?: number;
}) {
  return (
    <View style={[styles.stripes, { width, gap }]}>
      <View style={[styles.bar, { height, backgroundColor: theme.stripeYellow }]} />
      <View style={[styles.bar, { height, backgroundColor: theme.stripeOrange }]} />
      <View style={[styles.bar, { height, backgroundColor: theme.stripeRed }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  stripes: { gap: 2 },
  bar: { width: "100%" as const, borderRadius: 1 },
});
