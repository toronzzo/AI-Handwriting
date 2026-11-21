/**
 * Settings > Sounds (media plan A.6): one paper row next to 8-bit look.
 *
 * A label, a switch and one line of explanation. The switch is saved locally
 * (soundSettings.ts, under "preyas.sounds") and takes effect at once; turning
 * it off stops any cue that is still playing. OFF by default, like the other
 * small switches in this app.
 *
 * Tokens only, no red, no stripe.
 */
import { useEffect } from "react";
import { StyleSheet, Switch, Text, View } from "react-native";
import { ensureCueAudioMode } from "../media/sounds/audioMode.ts";
import { stopCue, warmCues } from "../media/sounds/playCue.ts";
import { useCuesFollowVisibility } from "../media/sounds/useCuesFollowVisibility.ts";
import { useSoundSettings } from "../media/sounds/useSoundSettings.ts";
import { Panel } from "../ui/Panel.tsx";
import { theme } from "../theme.ts";

export function SoundToggle() {
  const [on, setOn] = useSoundSettings(stopCue);
  useCuesFollowVisibility(ensureCueAudioMode);

  // Switching on prepares the mixing call; switching off has already stopped
  // the cue inside useSoundSettings.
  useEffect(() => {
    if (on) void warmCues();
  }, [on]);

  return (
    <Panel padding={16}>
      <Text style={styles.heading} accessibilityRole="header">
        SOUNDS
      </Text>
      <View style={styles.row}>
        <Text style={styles.label}>Sounds</Text>
        <Switch
          value={on}
          onValueChange={setOn}
          accessibilityLabel="Sounds"
          accessibilityHint="Short reaction sounds from Preyas. Off keeps the phone quiet."
        />
      </View>
      <Text style={styles.dim}>Short, quiet reaction sounds. Off by default.</Text>
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
