export { AliveController, type AliveOptions } from "./controller.ts";
export { pickSkill, skillWants } from "./skills.ts";
export { SKILL_LIST } from "./data/skills.ts";
export { EXPLORE_POINTS, type ExplorePoint } from "./data/room.ts";
export {
  BALL_MOODS,
  CANONICAL_TO_BALL,
  IDLE_SETS,
  type BallMood,
  type IdleSet,
} from "./data/moodIdles.ts";
export { BARKS, BARK_SITUATIONS, type BarkSituation } from "./data/barks.ts";
export { scoreRing, stepToward, hurryFor, turnToward, type Spot, type StepOut } from "./follow.ts";
export { tickNotice, makeSlot, resetSlot, type NoticeSlot, type NoticeResult } from "./perception.ts";
export { EventLog, exportMemory, exportMemoryJson, loadMemoryJson, emptyFacts, type MemoryFile } from "./memory.ts";
export {
  pickBark,
  activeSituation,
  BarkMemory,
  DEFAULT_BARK_TUNING,
  BARK_LINE_COUNT,
  type BarkTuning,
  type SituationFlags,
} from "./barks.ts";
export { sampleIdle, clipFor, type PoseSample } from "./pose.ts";
export {
  ADVICE_TTL_MS,
  MockMindAdvisor,
  advisorPrompt,
  chainAdvisors,
  createStudioAdvisor,
  isSkillId,
  mockSuggest,
  parseAdvisorReply,
  type AdvisorInput,
  type AdvisorSuggestion,
  type MindAdvisor,
} from "./advisor.ts";
export {
  BRAIN_MIN_INTERVAL_MS,
  BRAIN_TIMEOUT_MS,
  PREYAS_SYSTEM_PROMPT,
  brainReplyToSuggestion,
  brainUserPrompt,
  createBrainAdvisor,
  parseBrainReply,
  type BrainAdvisorOptions,
  type BrainReply,
  type MoodDelta,
} from "./brain.ts";
export type { Mood } from "../../mood/src/index.ts";
export type {
  AliveFrame,
  AliveInput,
  ClipName,
  MemoryEvent,
  MemoryFacts,
  SkillContext,
  SkillId,
  SkillRecord,
} from "./types.ts";
export {
  COMFORT_DISTANCE,
  FOLLOW_RING_RADIUS,
  HURRY_DISTANCE,
  HURRY_SPEED,
  MAX_DT,
  NOTICE_MS,
  POSE_LIMITS,
  WALK_SPEED,
} from "./tuning.ts";
