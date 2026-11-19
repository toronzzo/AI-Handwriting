/**
 * Settings > 8-bit look (slice 8A). One paper row next to Daily limit: a
 * label, a switch and one line of explanation. The switch is saved locally
 * (see bits/useBitMode.ts) and takes effect at once: the 3D ball is replaced
 * by the pixel Preyas everywhere.
 *
 * Tokens only, no red, no stripe.
 */
import { StyleSheet, Switch, Text, View } from "react-native";
import { useBitMode } from "../bits/useBitMode";
import { Panel } from "../ui/Panel";
import { theme } from "../theme";

export function BitModeSetting() {
  const [bit, setBit] = useBitMode();
  return (
    <Panel padding={16}>
      <Text style={styles.heading} accessibilityRole="header">
        8-BIT LOOK
      </Text>
      <View style={styles.row}>
        <Text style={styles.label}>8-bit look</Text>
        <Switch
          value={bit}
          onValueChange={setBit}
          accessibilityLabel="8-bit look"
          accessibilityHint="Replaces the 3D Preyas with the pixel Preyas."
        />
      </View>
      <Text style={styles.dim}>Retro pixel Preyas. Lighter on memory.</Text>
    </Panel>
  );
}

const styles = StyleSheet.create({
  heading: {
    fontFamily: theme.font.display,
    color: theme.text,
    fontWeight: "700",
    fontSize: theme.type.display.timer,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 4,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 44,
    gap: theme.space.sm,
  },
  label: { color: theme.text, fontSize: theme.type.body, fontWeight: "600" },
  dim: { color: theme.dim, fontSize: theme.type.caption, marginTop: 4 },
});
