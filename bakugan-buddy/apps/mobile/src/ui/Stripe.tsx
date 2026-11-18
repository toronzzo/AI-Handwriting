import { StyleSheet, View } from "react-native";
import { theme } from "../theme";

/**
 * The little Preyas stripe: three thin bars stacked with a 2px gap, in the
 * yellow → orange → red brand order. This is the ONLY place the stripe
 * colours are used, so every stripe in the app (the rail logo, headings, …)
 * renders through here.
 */
export function Stripe({ height = 3, width }: { height?: number; width: number }) {
  return (
    <View style={[styles.stripes, { width }]}>
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
