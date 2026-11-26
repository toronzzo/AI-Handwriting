import type { ReactNode } from "react";
import { StyleSheet, Text, View, type TextStyle } from "react-native";
import { theme } from "../theme";

/**
 * A riso section heading: Oswald display, weight 700 at the section size,
 * uppercase with wide tracking, printed on the page with a 2 px vermilion
 * duplicate offset behind the ink text. No chip, no shadow — it reads as a
 * letterpress headline, not as a card.
 */
export function SectionTitle({
  children,
  style,
}: {
  children: ReactNode;
  style?: TextStyle | TextStyle[];
}) {
  return (
    <View style={styles.wrap} accessibilityRole="header">
      <Text style={[styles.title, styles.offset, style]} accessible={false} aria-hidden={true}>
        {children}
      </Text>
      <Text style={[styles.title, styles.front, style]}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignSelf: "flex-start" },
  title: {
    fontFamily: theme.font.display,
    fontWeight: "700",
    fontSize: theme.type.display.section,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  offset: {
    position: "absolute",
    left: 2,
    top: 2,
    color: theme.vermilion,
  },
  front: {
    position: "relative",
    color: theme.text,
  },
});
