import type { Mood } from "../../mood/src/index.ts";

/** Priority skills for the first build. Idle-roll is the always-valid fallback. */
export type SkillId = "sleep" | "explore" | "follow" | "idle-roll";

export type SkillRecord = {
  id: SkillId;
  /** Higher priority wins when several skills want the frame. */
  priority: number;
  /** The list must contain one skill that always wants to run. */
  fallback: boolean;
};

/**
 * Plain numbers the picker reads. Built once per frame into a reused object.
 * Nothing here is a promise.
 */
export type SkillContext = {
  noticedPlayer: boolean;
  playerVisible: boolean;
  distance: number;
  playerMoving: boolean;
  summon: boolean;
  sleepRequested: boolean;
  settled: boolean;
  explorePoints: number;
  /** Hint from the mind. Ignored unless that skill also wants to run. */
  adviceGoal: SkillId | null;
};

export type ClipName = "idle" | "happy" | "closed";

export type MemoryEvent = {
  /** Device timestamp in milliseconds. */
  t: number;
  /** Stable event name: noticed, skill, mood, bark, explore, sleep, wake, advice. */
  name: string;
  detail: string;
};

export type MemoryFacts = {
  playerX: number;
  playerZ: number;
  playerAt: number;
  partnerName: string;
  lastPlace: string;
  lastPlaceAt: number;
};

/** One frame of body output. The controller reuses this object. */
export type AliveFrame = {
  rev: number;
  skill: SkillId;
  mood: Mood;
  x: number;
  y: number;
  z: number;
  yaw: number;
  bob: number;
  hop: number;
  roll: number;
  flap: number;
  headTilt: number;
  look: number;
  eye: number;
  hurry: boolean;
  scanning: boolean;
  /** Set only on the frame a line is chosen. Otherwise null. */
  bark: string | null;
  noticedPlayer: boolean;
  notice01: number;
  adviceGoal: SkillId | null;
  adviceMood: Mood | null;
  clip: ClipName;
  logCount: number;
};

export type AliveInput = {
  nowMs: number;
  /** Seconds since the previous frame. Clamped inside the tick. */
  dt: number;
  playerX: number;
  playerZ: number;
  playerVisible: boolean;
  /** Camera look direction on the floor, not required to be unit length. */
  camForwardX: number;
  camForwardZ: number;
  sleepRequested: boolean;
  summon: boolean;
  /** Canonical mood from a button or the demo reel. Null lets the sim decide. */
  moodOverride: Mood | null;
};
