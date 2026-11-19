/**
 * The app-wide RPG source (slice 5, now real data).
 *
 * The real source reads the append-only JSONL event log through the brain
 * server. Only when the brain cannot be reached on the first load does the
 * demo take over (isDemo: true, so the existing demo hint shows); the app
 * switches to real data as soon as the brain answers.
 */
import { createLogSource } from "./logSource.ts";
import { createMockSource } from "./mockSource.ts";
import type { RpgSource } from "./types.ts";

let source: RpgSource | null = null;

/** The one source for the whole app, created lazily. */
export function getRpgSource(): RpgSource {
  if (!source) {
    const mock = createMockSource();
    source = createLogSource({ demoFallback: () => mock.get() });
  }
  return source;
}
