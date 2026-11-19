/**
 * RPG data layer types (slice 5).
 *
 * Pure logic, no UI: this folder must run under `node --experimental-strip-types`
 * with no enums and no react-native imports, so screens and the future event
 * log source can share one vocabulary.
 */

/** The six areas of a Preyas OS life. */
export type AreaId = "body" | "intel" | "money" | "spirit" | "craft" | "goal";

/** One row per area, in display order. */
export const AREAS: { id: AreaId; name: string; tip: string }[] = [
  { id: "body", name: "Body", tip: "Sleep, food, water" },
  { id: "intel", name: "Mind", tip: "Study and focus" },
  { id: "money", name: "Money", tip: "Spending and saving" },
  { id: "spirit", name: "Spirit", tip: "Mood and calm" },
  { id: "craft", name: "Craft", tip: "Coding and creating" },
  { id: "goal", name: "Goal", tip: "House and car path" },
];

/** One line in the life event log. */
export type LifeEvent = {
  id: string;
  /** ms since epoch */
  t: number;
  type: string;
  xp: Partial<Record<AreaId, number>>;
  text?: string;
  src: "mock" | "log" | "mission" | "focus";
};

/** A daily quest with its one-time +5 XP bonus. */
export type QuestState = {
  id: string;
  title: string;
  area: AreaId;
  done: boolean;
  /** Progress hint like "3/6", when the quest is countable. */
  sub?: string;
  bonusXp: number;
};

/** A long path (house, car, study, …) shown as a percent of the way. */
export type PathState = {
  id: "house" | "car" | "study" | "bakugan-buddy" | "studio";
  name: string;
  /** 0..100 */
  pct: number;
};

/** Everything a screen needs to draw the Today dashboard, in one object. */
export type RpgSnapshot = {
  isDemo: boolean;
  totalXp: number;
  level: number;
  levelInto: number;
  levelNeed: number;
  rank: { letter: string; name: string };
  areaXp: Record<AreaId, number>;
  /** 0..10 */
  areaValue: Record<AreaId, number>;
  todayXp: number;
  dailyGoal: number;
  quests: QuestState[];
  paths: PathState[];
};

/**
 * The one interface screens know. The real event log source plugs in later
 * behind the same shape, so no screen changes when demo data goes away.
 */
export interface RpgSource {
  get(): RpgSnapshot;
  subscribe(fn: (s: RpgSnapshot) => void): () => void;
  toggleQuest?(id: string): void;
  addDemoXp?(area: AreaId, xp: number): void;
  addFocus?(minutes: number): void;
  /** Log one glass of water (real event log source only). */
  addWater?(glasses: number): void;
  /** Log a mood score 1..5 (real event log source only). */
  addMood?(score: number): void;
}
