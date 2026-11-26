/**
 * One shape for the small buttons under a reply (Copy, Regenerate): the same
 * padding, the same label size and the same quiet colour, so the row reads as
 * one thing. The row itself lives in ChatScreen; only the button is shared.
 */
import { StyleSheet } from "react-native";
import { theme } from "../theme.ts";

/** 32px tall plus this slop on every side is a 48px touch target. */
export const ACTION_HIT_SLOP = 8;

export const actionStyles = StyleSheet.create({
  button: {
    minHeight: 32,
    paddingHorizontal: theme.space.sm,
    borderRadius: theme.radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  label: { color: theme.faint, fontSize: theme.type.label, fontWeight: "600" },
});
