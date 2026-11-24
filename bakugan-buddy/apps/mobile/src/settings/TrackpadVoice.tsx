/**
 * Settings > Trackpad voice. Preyas speaks through the MacBook's haptic motor
 * (github.com/os6/nospeaker): the motor moves the glass, the glass is the
 * speaker. It is quiet, and a muted Mac still talks.
 *
 * The switch is saved on the drive by the brain (memory/trackpad.json), not in
 * this browser, because the sound comes from the Mac: the phone and the Mac
 * share one switch. The row hides itself when the Mac has no nospeaker, so
 * nobody is offered a switch that cannot do anything.
 */
import { useEffect, useState } from "react";
import { StyleSheet, Switch, Text, View } from "react-native";
import { currentBrainUrl } from "../room/brain/brainLink";
import { brainFetch } from "../room/brain/token";
import { Panel } from "../ui/Panel.tsx";
import { theme } from "../theme.ts";
import { rememberTrackpadVoice } from "../voice/trackpadVoice";

type TrackpadState = { available: boolean; enabled: boolean; speaking: boolean };

function asState(raw: Partial<TrackpadState> | null): TrackpadState {
  return {
    available: Boolean(raw && raw.available),
    enabled: !raw || raw.enabled !== false,
    speaking: Boolean(raw && raw.speaking),
  };
}

export function TrackpadVoice() {
  const [state, setState] = useState<TrackpadState | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await brainFetch(`${currentBrainUrl()}/v1/trackpad`);
        const next = asState((await res.json()) as Partial<TrackpadState>);
        rememberTrackpadVoice(next.available && next.enabled);
        if (alive) setState(next);
      } catch {
        if (alive) setState(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  async function toggle(on: boolean) {
    setError("");
    setState((current) => (current ? { ...current, enabled: on } : current));
    try {
      const res = await brainFetch(`${currentBrainUrl()}/v1/trackpad`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: on }),
      });
      const next = asState((await res.json()) as Partial<TrackpadState>);
      rememberTrackpadVoice(next.available && next.enabled);
      setState(next);
    } catch {
      setError("The Mac did not answer; the switch will try again next time.");
    }
  }

  // Nothing to show on a Mac without the program: no dead switches.
  if (!state || !state.available) return null;

  return (
    <Panel padding={16}>
      <Text style={styles.heading} accessibilityRole="header">
        TRACKPAD
      </Text>
      <View style={styles.row}>
        <Text style={styles.label}>Trackpad voice</Text>
        <Switch
          value={state.enabled}
          onValueChange={(on) => void toggle(on)}
          accessibilityLabel="Trackpad voice"
          accessibilityHint="Preyas also speaks through the Mac's haptic trackpad, quietly."
        />
      </View>
      <Text style={styles.dim}>
        Preyas says each line through the Mac's trackpad motor as well. Quiet on purpose; mute the Mac and it still talks.
      </Text>
      {error ? <Text style={styles.dim}>{error}</Text> : null}
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
