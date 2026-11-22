/**
 * Settings > Appearance. Light, Dark, or Auto.
 *
 * Auto follows this device. A second switch, only while Auto is selected,
 * also uses the dark theme from 20:00 to 07:00. The choice is saved locally
 * and takes effect at once on the web (the phone reloads when the scheme
 * actually changes, because native styles are captured at launch).
 *
 * Tokens only, no red, no stripe.
 */
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { Panel } from "../ui/Panel";
import { theme } from "../theme";
import {
  commitThemePrefs,
  DEFAULT_THEME_PREFS,
  readThemePrefs,
  subscribeThemePrefs,
  type ThemeChoice,
  type ThemePrefs,
} from "../themePrefs.ts";

const CHOICES: readonly { id: ThemeChoice; label: string }[] = [
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
  { id: "auto", label: "Auto" },
];

function useThemePrefs(): [ThemePrefs, (patch: Partial<ThemePrefs>) => void] {
  const [prefs, setPrefs] = useState<ThemePrefs>(() => readThemePrefs());
  useEffect(() => subscribeThemePrefs(setPrefs), []);
  const update = (patch: Partial<ThemePrefs>) => {
    const next = { ...readThemePrefs(), ...patch };
    setPrefs(commitThemePrefs(next));
  };
  return [prefs, update];
}

export function AppearanceSetting() {
  const [prefs, update] = useThemePrefs();
  const start = prefs.nightStart || DEFAULT_THEME_PREFS.nightStart;
  const end = prefs.nightEnd || DEFAULT_THEME_PREFS.nightEnd;
  return (
    <Panel padding={16}>
      <Text style={styles.heading} accessibilityRole="header">
        APPEARANCE
      </Text>
      <View style={styles.choices} accessibilityRole="radiogroup">
        {CHOICES.map((choice) => {
          const on = prefs.choice === choice.id;
          return (
            <Pressable
              key={choice.id}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              accessibilityLabel={choice.label}
              onPress={() => update({ choice: choice.id })}
              style={[styles.choice, on && styles.choiceOn]}
            >
              <Text style={[styles.choiceText, on && styles.choiceTextOn]}>{choice.label}</Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.dim}>
        {prefs.choice === "light"
          ? "Always the light theme."
          : prefs.choice === "dark"
            ? "Always the dark theme."
            : "Follows this device."}
      </Text>
      {prefs.choice === "auto" ? (
        <View style={styles.row}>
          <Text style={styles.label}>
            Dark from {start} to {end}
          </Text>
          <Switch
            value={prefs.nightByClock}
            onValueChange={(nightByClock) => update({ nightByClock })}
            trackColor={{ false: theme.track, true: theme.accent }}
            thumbColor={theme.onAccent}
            accessibilityLabel={`Dark from ${start} to ${end}`}
            accessibilityHint="Uses the dark theme during those hours, as well as when this device is dark."
          />
        </View>
      ) : null}
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
  choices: { flexDirection: "row", gap: theme.space.sm, marginTop: theme.space.xs },
  choice: {
    flex: 1,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: theme.lineStrong,
    borderRadius: theme.radius.sm,
    paddingHorizontal: theme.space.sm,
  },
  choiceOn: { backgroundColor: theme.accent, borderColor: theme.accent },
  choiceText: { color: theme.text, fontSize: theme.type.body, fontWeight: "700" },
  choiceTextOn: { color: theme.onAccent },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 44,
    gap: theme.space.sm,
    marginTop: theme.space.sm,
  },
  label: { color: theme.text, fontSize: theme.type.body, fontWeight: "600", flex: 1 },
  dim: { color: theme.dim, fontSize: theme.type.caption, marginTop: 4 },
});
