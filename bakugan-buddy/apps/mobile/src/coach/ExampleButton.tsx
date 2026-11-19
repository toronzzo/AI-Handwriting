import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { theme } from "../theme";
import { brainFetch } from "../room/brain/token";
import { currentBrainUrl } from "../room/brain/brainLink";
import { refreshExamples } from "../examples/installExamples";

/** "👍 Save last answer" in the coach popover: saves the newest chat's last model pair. */
export function ExampleButton() {
  const [line, setLine] = useState<string>("");
  const [busy, setBusy] = useState<boolean>(false);

  async function save() {
    if (busy) return;
    setBusy(true);
    setLine("");
    try {
      const res = await brainFetch(`${currentBrainUrl()}/v1/examples`, { method: "POST" });
      const body = await res.json();
      setLine(body && body.saved ? `Saved as example #${body.active}.` : `Not saved: ${body.reason || "unknown reason"}.`);
      if (body && body.saved) refreshExamples();
    } catch {
      setLine("Not saved: the brain is offline.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.wrap}>
      <Pressable style={styles.button} onPress={() => void save()} accessibilityLabel="Save last answer" accessibilityRole="button">
        <Text style={styles.buttonText}>{busy ? "Saving…" : "👍 Save last answer"}</Text>
      </Pressable>
      {line ? <Text style={styles.line}>{line}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 6 },
  button: {
    minHeight: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.accentLine,
    backgroundColor: theme.cardSoft,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  buttonText: { color: theme.accentText, fontSize: 13, fontWeight: "700" },
  line: { color: theme.dim, fontSize: 12, lineHeight: 17, marginTop: 6 },
});
