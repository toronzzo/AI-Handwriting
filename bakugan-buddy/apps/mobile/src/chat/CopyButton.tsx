/**
 * "Copy" under a reply.
 *
 * The browser clipboard is all this needs: the chat lives in the Mac's browser
 * and on the phone's, and both have navigator.clipboard. Where it is missing
 * (a native shell), the button hides itself instead of pretending.
 */
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import { theme } from "../theme.ts";
import { ACTION_HIT_SLOP, actionStyles } from "./actionRow.ts";

export function canCopy(): boolean {
  try {
    return typeof navigator !== "undefined" && Boolean(navigator.clipboard && navigator.clipboard.writeText);
  } catch {
    return false;
  }
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const id = setTimeout(() => setDone(false), 1400);
    return () => clearTimeout(id);
  }, [done]);
  if (!canCopy()) return null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={done ? "Copied" : "Copy reply"}
      style={actionStyles.button}
      hitSlop={ACTION_HIT_SLOP}
      onPress={() => {
        void copyText(text).then((ok) => {
          if (ok) setDone(true);
        });
      }}
    >
      <Text style={[actionStyles.label, done && styles.done]}>{done ? "Copied" : "Copy"}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  done: { color: theme.good },
});
