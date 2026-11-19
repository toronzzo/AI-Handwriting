import { Pressable, StyleSheet, Text, View } from "react-native";
import { theme } from "../theme";
import { ComputerPanel } from "../computer/ComputerPanel";
import { CoachVoice } from "./CoachVoice";
import { ExampleButton } from "./ExampleButton";
import type { CoachSkill, CoachState } from "./useCoach";

type ChipProps = {
  state: CoachState | null;
  compact?: boolean;
  onPress: () => void;
};

type PanelProps = {
  state: CoachState | null;
  skills: CoachSkill[];
  onClose: () => void;
  onStop: () => void;
  onHint: (text: string) => void;
};

function label(state: CoachState | null, compact: boolean): string {
  if (!state || state.mode === "off") return "Coach";
  if (state.mode === "skill" && state.skillName) {
    return compact ? `Coach ${state.step}/${state.of}` : `Coach: ${state.skillName} ${state.step}/${state.of}`;
  }
  if (state.mode === "pending") return "Coach: confirm?";
  return "Coach: lesson";
}

/** Small chip in the chat header. Theme tokens only. */
export function CoachChip({ state, compact, onPress }: ChipProps) {
  return (
    <Pressable style={styles.chip} onPress={onPress} accessibilityLabel="Coach" accessibilityRole="button">
      <Text style={styles.chipText}>{label(state, Boolean(compact))}</Text>
    </Pressable>
  );
}

/** Paper popover for the chip; the screen renders it at root level. */
export function CoachPanel({ state, skills, onClose, onStop, onHint }: PanelProps) {
  const active = (state?.mode ?? "off") !== "off";
  const learned = skills.filter((skill) => skill.learned);
  return (
    <View style={styles.panelWrap}>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="Close coach panel" />
      <View style={styles.panel}>
        <Text style={styles.title}>COACH</Text>
        <Text style={styles.body}>
          {active && state
            ? `Now: ${state.skillName ? `${state.skillName} step ${state.step} of ${state.of}` : state.mode}. Paste your result in the chat, or say stop.`
            : "Coach walks you through a skill one step at a time. It never runs commands itself — you do the steps."}
        </Text>
        {learned.length ? (
          <Text style={styles.body}>Skills learned ({learned.length}): {learned.map((skill) => skill.name).join(", ")}.</Text>
        ) : null}
        {!learned.length && skills.length ? (
          <Text style={styles.body}>Known skills: {skills.map((skill) => skill.name).join(", ")}.</Text>
        ) : null}
        {active ? (
          <Pressable style={styles.button} onPress={onStop} accessibilityLabel="Stop coach">
            <Text style={styles.buttonText}>Stop coach</Text>
          </Pressable>
        ) : (
          <Pressable
            style={styles.button}
            onPress={() => onHint('Say "coach <topic>" in the chat, for example: coach merge the PR.')}
            accessibilityLabel="Start coach"
          >
            <Text style={styles.buttonText}>Start coach</Text>
          </Pressable>
        )}
        <CoachVoice />
        <ComputerPanel />
        <ExampleButton />
        <Pressable style={styles.ghostButton} onPress={onClose} accessibilityLabel="Close">
          <Text style={styles.ghostText}>Close</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    minHeight: 36,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 18,
    backgroundColor: theme.accentSoft,
    borderWidth: 1,
    borderColor: theme.accentLine,
    justifyContent: "center",
    marginLeft: 8,
  },
  chipText: {
    color: theme.accentText,
    fontSize: 12,
    fontWeight: "700",
  },
  panelWrap: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 40,
    backgroundColor: theme.scrim,
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  scrim: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  panel: {
    width: "100%",
    maxWidth: 360,
    backgroundColor: theme.card,
    borderColor: theme.accentLine,
    borderWidth: 1,
    borderRadius: 16,
    padding: 20,
  },
  title: {
    color: theme.text,
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginBottom: 8,
  },
  body: {
    color: theme.text,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 8,
  },
  button: {
    minHeight: 44,
    borderRadius: 10,
    backgroundColor: theme.accent,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    marginTop: 6,
  },
  buttonText: {
    color: theme.onAccent,
    fontSize: 13,
    fontWeight: "700",
  },
  ghostButton: {
    minHeight: 36,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.accentLine,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    marginTop: 6,
  },
  ghostText: {
    color: theme.text,
    fontSize: 13,
  },
});
