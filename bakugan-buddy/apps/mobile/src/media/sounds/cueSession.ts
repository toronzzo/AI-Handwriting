/**
 * The rules every cue goes through, as pure code (media plan A.2, §13.3).
 *
 * playCue.ts (web) and playCue.native.ts (iPhone and Android) differ only in
 * how they hand a WAV to expo-audio; the decisions below are the same on both
 * and are tested once, under plain node.
 *
 * A cue is skipped, never thrown, when:
 *   enabled   false           the "Sounds" switch is off;
 *   available false           no audio backend on this platform;
 *   hidden    true            the page is hidden or the app is in the background;
 *   reduce    true            the platform asks for reduced motion;
 *   unknown id                it is not one of the Tier-0 cues;
 *   too soon                  another cue started inside CUE_WINDOW_MS.
 */
import { CUE_MAX_MS, CUE_VOLUME, CUE_WINDOW_MS, cueById, type Cue } from "./cues.ts";

/** Exactly the two expo-audio calls the cues need, so a test can fake them. */
export type CuePlayer = {
  play: () => void;
  stop: () => void;
};

export type CueDeps = {
  /** The "Sounds" switch (soundSettings.ts). */
  enabled: () => boolean;
  /** False when this platform has no audio, or the asset could not load. */
  available: () => boolean;
  /** True while the page is hidden (usePageVisible.ts inverted). */
  hidden: () => boolean;
  /** True while the platform asks for reduced motion (useReducedMotion.ts). */
  reduce: () => boolean;
  /** Start one bundled WAV; null means it could not start. */
  open: (cue: Cue) => CuePlayer | null;
  now?: () => number;
  /** The handled cue has ended, been stopped or failed; used to free it. */
  onEnded?: (cue: Cue) => void;
};

export type CueResult =
  | { played: true; id: Cue["id"] }
  | { played: false; reason: "unknown" | "disabled" | "unavailable" | "hidden" | "reduced-motion" | "window" | "failed" };

export type CueSession = {
  /** Try to play one cue. Never throws. */
  play: (id: unknown) => CueResult;
  /** Stop the cue that is playing, if any. Safe to call at any time. */
  stop: () => void;
  /** The cue still playing, or null. */
  current: () => Cue["id"] | null;
};

/** The cue session: one cue at a time, inside a 3 s window, always quiet. */
export function createCueSession(deps: CueDeps): CueSession {
  const now = deps.now ?? (() => Date.now());
  let active: { cue: Cue; player: CuePlayer | null; timer: ReturnType<typeof setTimeout> | null } | null = null;
  let lastStarted: { at: number } | null = null;

  const finish = (session: NonNullable<typeof active>) => {
    if (session.timer !== null) clearTimeout(session.timer);
    session.timer = null;
    deps.onEnded?.(session.cue);
  };

  const stop = () => {
    if (!active) return;
    const session = active;
    active = null;
    finish(session);
    try {
      session.player?.stop();
    } catch {
      /* a UI sound never raises */
    }
  };

  const play = (id: unknown): CueResult => {
    const cue = cueById(id);
    if (!cue) return { played: false, reason: "unknown" };
    try {
      if (!deps.enabled()) return { played: false, reason: "disabled" };
      if (!deps.available()) return { played: false, reason: "unavailable" };
      if (deps.hidden()) return { played: false, reason: "hidden" };
      if (deps.reduce()) return { played: false, reason: "reduced-motion" };
      const at = now();
      if (lastStarted !== null && at - lastStarted.at < CUE_WINDOW_MS) {
        return { played: false, reason: "window" };
      }
      // One at a time: the new cue takes the speaker from the old one.
      stop();
      const player = deps.open(cue);
      // Only a cue that really started opens the window. A failed one must
      // not block the next attempt for three seconds (a browser that refused
      // autoplay once would otherwise swallow the cue after the first tap).
      if (!player) return { played: false, reason: "failed" };
      lastStarted = { at };
      active = { cue, player, timer: null };
      const session = active;
      active.timer = setTimeout(() => {
        if (active === session) stop();
      }, CUE_MAX_MS);
      // A short effect must never keep node or the app alive on its own.
      (active.timer as { unref?: () => void }).unref?.();
      player.play();
      return { played: true, id: cue.id };
    } catch {
      stop();
      return { played: false, reason: "failed" };
    }
  };

  return {
    play,
    stop,
    current: () => active?.cue.id ?? null,
  };
}

/** The default volume for a cue: quiet, and clamped to a safe range. */
export const DEFAULT_CUE_VOLUME = CUE_VOLUME;
