import { useEffect, useState } from "react";
import { getRpgSource } from "../rpg/source.ts";
import type { RpgSnapshot, RpgSource } from "../rpg/types.ts";

/**
 * The current RPG snapshot plus the source it came from. The source is the
 * app-wide singleton (created lazily in src/rpg/source.ts), and the hook
 * subscribes for the lifetime of the component so every panel repaints
 * together when XP moves.
 */
export function useRpg(): { snapshot: RpgSnapshot; source: RpgSource } {
  const [source] = useState<RpgSource>(() => getRpgSource());
  const [snapshot, setSnapshot] = useState<RpgSnapshot>(() => source.get());

  useEffect(() => {
    setSnapshot(source.get());
    return source.subscribe(setSnapshot);
  }, [source]);

  return { snapshot, source };
}
