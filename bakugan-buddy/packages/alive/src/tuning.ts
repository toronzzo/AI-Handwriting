/** Shared numbers. The frame loop only reads these; it does not allocate. */

export const NOTICE_MS = 1100;
export const SETTLED_MS = 2800;
export const SCAN_MS = 1400;
export const MAX_DT = 0.05;

/** Inside this distance follow is satisfied once the partner is still. */
export const COMFORT_DISTANCE = 1.5;
/** Beyond this he comes back even if the partner has been still. */
export const LEASH_DISTANCE = 4.2;
/** Ring radius around the partner. Kept inside the comfort distance. */
export const FOLLOW_RING_RADIUS = 1.2;
export const HURRY_DISTANCE = 2.7;
export const HURRY_HYSTERESIS = 0.45;

export const WALK_SPEED = 0.9;
export const HURRY_SPEED = 1.75;
export const MOVE_DEADZONE = 0.16;
export const PLAYER_MOVE_SPEED = 0.18;
export const TURN_RATE = 2.4;
export const IDLE_SPIN = 0.7;

export const ROOM_MIN = -5.2;
export const ROOM_MAX = 5.2;

/** Procedural bone/body offsets stay inside the clip-tested poses. */
export const POSE_LIMITS = {
  bobMax: 0.04,
  hopMax: 0.07,
  /** Radians added on top of the playing clip. Small on purpose. */
  flapMax: 0.07,
  headTiltMax: 0.1,
  rollMax: 0.16,
  lookMax: 0.22,
} as const;

export const SPOT_COUNT = 8;

export const BARK_LINE_MS = 120_000;
export const BARK_GLOBAL_MS = 4500;
export const BARK_RECENT = 6;

export const ADVICE_HOLD_MS = 7000;
export const NOTICE_MOOD_MS = 1600;
