/**
 * Skia body port scaffold (M1.5).
 * Motion math comes from @bakugan-buddy/body-core; draw calls map canvas → Skia.
 * M1 ships BodyWebView for pixel-identical body.html; enable Skia when native
 * build is available (`npx expo run:android`).
 */
import { StyleSheet, Text, View } from "react-native";
import type { Mood } from "../../../../packages/body-core/src";

type Props = {
  emotion?: Mood;
};

export function BodySkia({ emotion = "idle" }: Props) {
  return (
    <View style={styles.box}>
      <Text style={styles.t}>Skia body port</Text>
      <Text style={styles.s}>
        Emotion: {emotion}. Use BodyWebView for M1 60fps. This module will call
        Canvas/Circle/Path from @shopify/react-native-skia using motionTargets()
        from body-core.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    backgroundColor: "#121212",
  },
  t: { color: "#f2f2f2", fontSize: 18, fontWeight: "700", marginBottom: 8 },
  s: { color: "#b0b0b0", textAlign: "center", lineHeight: 20 },
});
