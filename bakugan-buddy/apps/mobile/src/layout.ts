/**
 * Pure layout decisions for the shell and the chat screen.
 * Kept free of React so the phone and Mac cases can be tested.
 */
import { theme } from "./theme.ts";

/** Width from which the Mac layout (icon rail + chats list) is used. */
export const WIDE_MIN = 900;

export function isWide(width: number): boolean {
  return width >= WIDE_MIN;
}

/** True on a phone, including an iPhone in landscape. */
export function isPhone(width: number, height: number): boolean {
  return !isWide(width) && Math.min(width, height) < 600;
}

/** Chat column: full width up to the reading cap, then centred. */
export function chatColumn(width: number): { maxWidth: number; width: "100%" } {
  return { maxWidth: Math.min(theme.size.maxChat, Math.max(0, width)), width: "100%" };
}

/** Width of the chats list on a Mac; it disappears once the thread gets tight. */
export function listWidth(width: number, open: boolean): number {
  if (!isWide(width)) return 0;
  const room = width - theme.size.nav;
  return open && room >= theme.size.list + theme.size.maxChat / 2 ? theme.size.list : 0;
}

/** Narrow: the 3 tabs and the gear share the bottom bar evenly. */
export const BAR_ITEMS = 4;
