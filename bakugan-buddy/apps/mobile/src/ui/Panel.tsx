import type { ReactNode } from "react";
import { StyleSheet, View, type ViewStyle } from "react-native";
import { theme } from "../theme";

/**
 * A paper panel: the surface every bit of text sits on, never directly on the
 * sky. card background, a hairline accentLine border, 16px radius and a soft
 * drop shadow by default; the padding can be overridden.
 */
export function Panel({
  children,
  style,
  padding = 20,
}: {
  children?: ReactNode;
  style?: ViewStyle | ViewStyle[];
  padding?: number;
}) {
  return <View style={[styles.panel, { padding }, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: theme.card,
    borderWidth: 1,
    borderColor: theme.accentLine,
    borderRadius: 16,
    shadowColor: theme.shadow,
    shadowOpacity: 1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
});
