import { useEffect, useState } from "react";
import { getRpgSource } from "../rpg/source.ts";
import type { RpgSnapshot, RpgSource } from "../rpg/types.ts";

/**
 * A tiny module-level notice bus so any panel can drop one short line into
 * the LevelCard bubble area. It lives outside React state on purpose: every
 * panel calls useRpg on its own, and only a shared bus can make a line posted
 * by the Focus quest panel appear in the LevelCard.
 */
type NoticeListener = (text: string) => void;
const noticeListeners = new Set<NoticeListener>();

/** Post one short line to every subscribed panel's bubble area. */
export function postNotice(text: string): void {
  for (const listener of noticeListeners) listener(text);
}

/** How long a posted notice stays up before the bubble area clears itself. */
const NOTICE_MS = 8000;

/**
 * The current RPG snapshot plus the source it came from. The source is the
 * app-wide singleton (created lazily in src/rpg/source.ts), and the hook
 * subscribes for the lifetime of the component so every panel repaints
 * together when XP moves.
 *
 * The optional `message` slot shows one short notice (like "Quest complete!")
 * in the LevelCard bubble area; post with `postNotice`. It clears itself
 * after a few seconds so the demo hint comes back.
 */
export function useRpg(): {
  snapshot: RpgSnapshot;
  source: RpgSource;
  message: string | null;
  postNotice: (text: string) => void;
} {
  const [source] = useState<RpgSource>(() => getRpgSource());
  const [snapshot, setSnapshot] = useState<RpgSnapshot>(() => source.get());
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setSnapshot(source.get());
    return source.subscribe(setSnapshot);
  }, [source]);

  useEffect(() => {
    const listener = (text: string) => setMessage(text);
    noticeListeners.add(listener);
    return () => {
      noticeListeners.delete(listener);
    };
  }, []);

  useEffect(() => {
    if (message === null) return;
    const timer = setTimeout(() => setMessage(null), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [message]);

  return { snapshot, source, message, postNotice };
}
