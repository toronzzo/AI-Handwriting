/**
 * SoundLab: the dev-only dry run for the Tier-0 reaction sounds
 * (media plan A.3 phase 0) plus the preview control for the bundled set.
 *
 * It is rendered inside Settings only when __DEV__ is on, so a production
 * build never grows a preview screen. Every button plays the real bundled
 * cue through the same playCue() the app uses, and prints whether it played
 * or which rule skipped it, so the 3 s window, the switch and the reduced
 * motion cases are visible without a debugger.
 */
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { TIER0_CUES, type CueId } from "./cues.ts";
import { playCue, stopCue } from "./playCue.ts";
import { useSoundSettings } from "./useSoundSettings.ts";
import { Panel } from "../../ui/Panel.tsx";
import { theme } from "../../theme.ts";

/** "played" plus the cue, or the rule that skipped it. */
function describe(id: CueId): string {
  const result = playCue(id);
  return result.played ? `${id}: played` : `${id}: skipped (${result.reason})`;
}

export function SoundLab() {
  const [on] = useSoundSettings(stopCue);
  const [line, setLine] = useState("");

  return (
    <Panel padding={16}>
      <Text style={styles.heading} accessibilityRole="header">
        SOUND LAB
      </Text>
      <Text style={styles.dim}>
        Dev only. {TIER0_CUES.length} bundled cues. Sounds are {on ? "on" : "off"}.
      </Text>
      <View style={styles.grid}>
        {TIER0_CUES.map((cue) => (
          <Pressable
            key={cue.id}
            style={styles.button}
            onPress={() => setLine(describe(cue.id))}
            accessibilityRole="button"
            accessibilityLabel={`Preview the ${cue.label} sound`}
          >
            <Text style={styles.buttonText}>{cue.label}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.dim} accessibilityLiveRegion="polite">
        {line || "Tap a cue to try it."}
      </Text>
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
  grid: { flexDirection: "row", flexWrap: "wrap", gap: theme.space.sm, marginTop: 8, marginBottom: 4 },
  button: {
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    borderColor: theme.lineStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonText: { color: theme.text, fontSize: theme.type.body, fontWeight: "600" },
  dim: { color: theme.dim, fontSize: theme.type.caption, marginTop: 6 },
});
