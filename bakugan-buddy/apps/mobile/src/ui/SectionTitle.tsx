import type { ReactNode } from "react";
import { StyleSheet, Text, type TextStyle } from "react-native";
import { theme } from "../theme";

/**
 * A section heading drawn on its own card chip: Oswald display, weight 700 at
 * the section size, uppercase with wide tracking. Same soft shadow as Panel
 * so headings read as part of the paper family, not as text on the sky.
 */
export function SectionTitle({
  children,
  style,
}: {
  children: ReactNode;
  style?: TextStyle | TextStyle[];
}) {
  return <Text style={[styles.title, style]}>{children}</Text>;
}

const styles = StyleSheet.create({
  title: {
    fontFamily: theme.font.display,
    fontWeight: "700",
    fontSize: theme.type.display.section,
    textTransform: "uppercase",
    letterSpacing: 0.78,
    backgroundColor: theme.card,
    borderRadius: 10,
    paddingHorizontal: 18,
    paddingVertical: 10,
    overflow: "hidden",
    shadowColor: theme.shadow,
    shadowOpacity: 1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
});
