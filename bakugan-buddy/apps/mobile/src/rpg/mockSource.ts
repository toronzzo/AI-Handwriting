/**
 * Mock RPG source (slice 5): demo data only, clearly flagged isDemo.
 *
 * State lives in memory only — no storage, no timers, no network, and
 * nothing here may move money or send anything. The real source later reads
 * the append-only JSONL event log through the brain server.
 */
import { freshQuests } from "./quests.ts";
import { areaValue as areaValueOf, levelOf, rankOf } from "./rpgMath.ts";
import type { AreaId, PathState, QuestState, RpgSnapshot, RpgSource } from "./types.ts";

const START_AREA_XP: Record<AreaId, number> = {
  body: 300,
  intel: 250,
  money: 150,
  spirit: 180,
  craft: 90,
  goal: 50,
};

const START_TODAY_XP = 20;
const DAILY_GOAL = 50;

const START_PATHS: PathState[] = [
  { id: "house", name: "House", pct: 12.4 },
  { id: "car", name: "Car", pct: 7.8 },
  { id: "study", name: "Study", pct: 41.5 },
  { id: "bakugan-buddy", name: "Bakugan Buddy", pct: 23 },
  { id: "studio", name: "Studio", pct: 9 },
];

/** A fresh, in-memory demo source. `now` is kept for the future log source. */
export function createMockSource(now: () => number = Date.now): RpgSource {
  void now; // no timers in the demo; the real source will use the clock

  const areaXp: Record<AreaId, number> = { ...START_AREA_XP };
  const quests: QuestState[] = freshQuests();
  const paths: PathState[] = START_PATHS.map((path) => ({ ...path }));
  const todayXp = START_TODAY_XP;
  const subscribers = new Set<(s: RpgSnapshot) => void>();

  function build(): RpgSnapshot {
    const totalXp = (Object.keys(areaXp) as AreaId[]).reduce(
      (sum, area) => sum + areaXp[area],
      0,
    );
    const { L, into, need } = levelOf(totalXp);
    const rank = rankOf(L);
    const areaValue = {} as Record<AreaId, number>;
    for (const area of Object.keys(areaXp) as AreaId[]) {
      areaValue[area] = areaValueOf(areaXp[area]);
    }
    return {
      isDemo: true,
      totalXp,
      level: L,
      levelInto: into,
      levelNeed: need,
      rank,
      areaXp: { ...areaXp },
      areaValue,
      todayXp,
      dailyGoal: DAILY_GOAL,
      quests: quests.map((quest) => ({ ...quest })),
      paths: paths.map((path) => ({ ...path })),
    };
  }

  function notify(): void {
    const snapshot = build();
    for (const fn of subscribers) fn(snapshot);
  }

  return {
    get(): RpgSnapshot {
      return build();
    },

    subscribe(fn: (s: RpgSnapshot) => void): () => void {
      subscribers.add(fn);
      return () => {
        subscribers.delete(fn);
      };
    },

    /**
     * Toggle a daily quest: done gives its one-time +5 XP bonus in its area,
     * toggling off removes it. Never loses progress beyond that bonus.
     */
    toggleQuest(id: string): void {
      const quest = quests.find((candidate) => candidate.id === id);
      if (!quest) return;
      if (quest.done) {
        quest.done = false;
        areaXp[quest.area] -= quest.bonusXp;
      } else {
        quest.done = true;
        areaXp[quest.area] += quest.bonusXp;
      }
      notify();
    },

    addDemoXp(area: AreaId, xp: number): void {
      areaXp[area] += xp;
      notify();
    },

    /** A focus session: at least 2 Mind XP, plus 1 per 5 minutes. */
    addFocus(minutes: number): void {
      areaXp.intel += Math.max(2, Math.round(minutes / 5));
      notify();
    },
  };
}
