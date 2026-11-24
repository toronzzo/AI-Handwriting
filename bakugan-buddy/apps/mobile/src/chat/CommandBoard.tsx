/**
 * The slash-command palette above the composer.
 *
 * It appears the moment the message box starts with "/" and narrows as the
 * user types. Picking a row fills the box with "/name " so the argument can be
 * finished by hand; nothing runs until Send.
 */
import { Pressable, StyleSheet, Text, View } from "react-native";
import { theme } from "../theme.ts";
import { matchingCommands, type ChatCommandName } from "./commands.ts";

export function CommandBoard({ draft, onPick }: { draft: string; onPick: (name: ChatCommandName) => void }) {
  const options = matchingCommands(draft);
  if (!options.length) return null;
  return (
    <View style={styles.board} accessibilityRole="menu">
      {options.map((command) => (
        <Pressable
          key={command.name}
          style={styles.row}
          onPress={() => onPick(command.name)}
          accessibilityRole="button"
          accessibilityLabel={"/" + command.name + ": " + command.hint}
        >
          <Text style={styles.name}>/{command.name}</Text>
          <Text style={styles.hint}>{command.hint}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  board: {
    backgroundColor: theme.card,
    borderWidth: 1,
    borderColor: theme.accentLine,
    borderRadius: theme.radius.sm,
    paddingHorizontal: theme.space.sm,
    paddingVertical: theme.space.xs,
    gap: theme.space.xs / 2,
  },
  row: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: theme.space.sm,
    minHeight: 30,
    paddingVertical: theme.space.xs / 2,
  },
  name: { color: theme.accentText, fontSize: theme.type.body, fontWeight: "700" },
  hint: { color: theme.dim, fontSize: theme.type.caption, flex: 1 },
});
