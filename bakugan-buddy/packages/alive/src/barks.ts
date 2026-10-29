import type { Mood } from "../../mood/src/index.ts";
import { BARKS, BARK_SITUATIONS, type BarkSituation } from "./data/barks.ts";
import { CANONICAL_TO_BALL } from "./data/moodIdles.ts";
import type { SkillId } from "./types.ts";
import { BARK_GLOBAL_MS, BARK_LINE_MS, BARK_RECENT } from "./tuning.ts";

const SITUATION_MS: Record<BarkSituation, number> = {
  idle: 22000,
  follow: 14000,
  hurry: 16000,
  explore: 16000,
  scan: 18000,
  sleep: 40000,
  wake: 20000,
  noticed: 25000,
  happy: 18000,
  sad: 20000,
  angry: 18000,
  excited: 16000,
};

const LINE_OFFSET: Record<BarkSituation, number> = {
  idle: 0,
  follow: 0,
  hurry: 0,
  explore: 0,
  scan: 0,
  sleep: 0,
  wake: 0,
  noticed: 0,
  happy: 0,
  sad: 0,
  angry: 0,
  excited: 0,
};

let lineCount = 0;
for (let i = 0; i < BARK_SITUATIONS.length; i++) {
  const id = BARK_SITUATIONS[i]!;
  LINE_OFFSET[id] = lineCount;
  lineCount += BARKS[id].length;
}

export const BARK_LINE_COUNT = lineCount;

export type BarkTuning = {
  lineMs: number;
  globalMs: number;
  /** When set, replaces the per-situation table. Tests use a short gap. */
  situationMs: number;
};

export const DEFAULT_BARK_TUNING: BarkTuning = {
  lineMs: BARK_LINE_MS,
  globalMs: BARK_GLOBAL_MS,
  situationMs: 0,
};

export class BarkMemory {
  readonly situationReadyAt = new Float64Array(BARK_SITUATIONS.length);
  readonly lineReadyAt: Float64Array;
  readonly recent: Int16Array;
  recentCount = 0;
  recentCursor = 0;
  globalReadyAt = 0;

  constructor(recent = BARK_RECENT) {
    this.lineReadyAt = new Float64Array(BARK_LINE_COUNT);
    this.recent = new Int16Array(recent);
    this.recent.fill(-1);
  }
}

function recentlyUsed(state: BarkMemory, lineIndex: number): boolean {
  const n = state.recentCount;
  for (let i = 0; i < n; i++) {
    if (state.recent[i] === lineIndex) return true;
  }
  return false;
}

function remember(state: BarkMemory, lineIndex: number): void {
  if (state.recentCount < state.recent.length) {
    state.recent[state.recentCount] = lineIndex;
    state.recentCount += 1;
    return;
  }
  state.recent[state.recentCursor] = lineIndex;
  state.recentCursor = (state.recentCursor + 1) % state.recent.length;
}

/**
 * Picks a line for a situation that is true right now.
 * Pass null when nothing is true — he stays quiet.
 * A line on cooldown, or one of the last few, is skipped. If every line
 * is spent, returns null instead of repeating.
 */
export function pickBark(
  situation: BarkSituation | null,
  now: number,
  state: BarkMemory,
  rng: () => number,
  tuning: BarkTuning = DEFAULT_BARK_TUNING,
): string | null {
  if (!situation) return null;
  if (now < state.globalReadyAt) return null;
  const sitIndex = BARK_SITUATIONS.indexOf(situation);
  if (sitIndex < 0) return null;
  if (now < state.situationReadyAt[sitIndex]!) return null;
  const lines = BARKS[situation];
  const n = lines.length;
  const offset = LINE_OFFSET[situation];
  let start = Math.floor(rng() * n);
  if (start >= n) start = n - 1;
  if (start < 0) start = 0;
  for (let k = 0; k < n; k++) {
    const i = (start + k) % n;
    const lineIndex = offset + i;
    if (now < state.lineReadyAt[lineIndex]!) continue;
    if (recentlyUsed(state, lineIndex)) continue;
    const sitMs = tuning.situationMs > 0 ? tuning.situationMs : SITUATION_MS[situation];
    state.lineReadyAt[lineIndex] = now + tuning.lineMs;
    state.situationReadyAt[sitIndex] = now + sitMs;
    state.globalReadyAt = now + tuning.globalMs;
    remember(state, lineIndex);
    return lines[i]!;
  }
  return null;
}

export type SituationFlags = {
  skill: SkillId;
  hurry: boolean;
  scanning: boolean;
  justNoticed: boolean;
  woke: boolean;
  fellAsleep: boolean;
  mood: Mood;
  moodJustChanged: boolean;
};

/** The situation that is actually happening. Sleep lines only fire on the way down. */
export function activeSituation(flags: SituationFlags): BarkSituation | null {
  if (flags.justNoticed) return "noticed";
  if (flags.woke) return "wake";
  if (flags.fellAsleep) return "sleep";
  if (flags.skill === "follow" && flags.hurry) return "hurry";
  if (flags.skill === "follow") return "follow";
  if (flags.skill === "explore" && flags.scanning) return "scan";
  if (flags.skill === "explore") return "explore";
  if (flags.skill === "sleep") return null;
  if (flags.moodJustChanged) {
    const ball = CANONICAL_TO_BALL[flags.mood];
    if (ball === "happy" || ball === "sad" || ball === "angry" || ball === "excited") return ball;
  }
  if (flags.skill === "idle-roll") return "idle";
  return null;
}
