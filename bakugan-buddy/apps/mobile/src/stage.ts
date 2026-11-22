/**
 * Which main pane is on screen.
 *
 * Chat stays mounted when Today or Brain is showing. A reply that is still
 * streaming has to land somewhere, and unmounting the screen used to drop it.
 */
import type { Section } from "./nav.ts";

export function chatSectionFor(section: Section): Section {
  if (section === "today" || section === "brain") return "chat";
  return section;
}

/** True when the chat UI should be the thing the person is looking at. */
export function chatPaneVisible(section: Section, advanced: boolean): boolean {
  if (advanced) return false;
  return section !== "today" && section !== "brain";
}

/** Chat is kept alive across Today and Brain so an in-flight reply can finish. */
export function chatStaysMounted(section: Section, advanced: boolean): boolean {
  void section;
  void advanced;
  return true;
}
