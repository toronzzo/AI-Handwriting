/**
 * Pure layout decisions for the shell and the chat screen.
 * Kept free of React so the phone and Mac cases can be tested.
 */
import { theme } from "./theme.ts";

/**
 * The CSS the browser shell needs so the page is exactly the window tall.
 *
 * The shell row and the stage are flex children, and a flex item defaults to
 * `min-height: auto`, which means "never be shorter than my content". A long
 * Memory list therefore grew the page past the window and pushed Settings in
 * the rail below the fold. `min-height: 0` lets each one shrink to its slot,
 * and `overflow: hidden` clips whatever the inner ScrollView has not shown.
 *
 * The root element also carries a minimum of a full viewport (a plain
 * `min-height: 100vh` on the page, or React Native Web's own styling of it).
 * Since the root is a column flex parent, that minimum is also the floor for
 * its only child, which would push the page to the content height again, so
 * the root's minimum is lowered to the larger of its height and the window.
 */
export const WEB_SHELL_CSS = `#root { min-height: auto; }
html, body, #root { height: 100%; overflow: hidden; }
[data-root] { min-height: max(100%, 100vh); }
[data-shell], [data-stage] { min-height: 0; overflow: hidden; }`;

/** Root attribute that marks the shell row (see App.tsx). */
export const SHELL_ATTR = "data-shell";
/** Root attribute that marks the stage beside the rail (see App.tsx). */
export const STAGE_ATTR = "data-stage";
/** Root attribute that marks the wrapper for the browser floor rule. */
export const ROOT_ATTR = "data-root";

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

/** Narrow: the 4 tabs and the gear share the bottom bar evenly. */
export const BAR_ITEMS = 5;

/** Today dashboard columns: 3 from 1100px, 2 from 700px, 1 below. */
export function todayColumns(width: number): 1 | 2 | 3 {
  if (width >= 1100) return 3;
  if (width >= 700) return 2;
  return 1;
}
