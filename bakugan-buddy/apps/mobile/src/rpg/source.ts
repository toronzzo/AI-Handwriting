/**
 * The app-wide RPG source (slice 5).
 *
 * Later: eventLogSource reads the append-only JSONL event log through the
 * brain server. Screens only know RpgSource.
 */
import { createMockSource } from "./mockSource.ts";
import type { RpgSource } from "./types.ts";

let source: RpgSource | null = null;

/** The one source for the whole app, created lazily. */
export function getRpgSource(): RpgSource {
  if (!source) source = createMockSource();
  return source;
}
