import type { ReactNode } from "react";
import { StyleSheet, Text, View, type ViewStyle } from "react-native";
import { theme } from "../theme";

/**
 * A riso paper panel: the surface every bit of text sits on, never directly
 * on the page. paperDeep card, a 1.5 px ink rule, square 2 px corners and no
 * shadow. An optional `plate` prints a small plate number in the top-right
 * corner, like a field-journal plate. The padding can be overridden.
 */
export function Panel({
  children,
  style,
  padding = 20,
  plate,
}: {
  children?: ReactNode;
  style?: ViewStyle | ViewStyle[];
  padding?: number;
  /** Small plate number printed top-right, e.g. "PL. 01". */
  plate?: string;
}) {
  return (
    <View style={[styles.panel, { padding }, style]}>
      {children}
      {plate ? (
        <Text
          style={styles.plate}
          accessible={false}
          aria-hidden={true}
          importantForAccessibility="no-hide-descendants"
        >
          {plate}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: theme.card,
    borderWidth: 1.5,
    borderColor: theme.text,
    borderRadius: theme.radius.square,
  },
  plate: {
    position: "absolute",
    top: 8,
    right: 10,
    fontFamily: theme.font.display,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    color: theme.dim,
  },
});
