/**
 * Real RPG source (slice R1): the Today dashboard reads the brain's
 * GET /v1/rpg/today, which derives everything from the append-only life event
 * log. No demo numbers, no addDemoXp.
 *
 * The source refreshes on start, every 60 s while the page is visible, on
 * becoming visible again, and right after any action. A failed fetch keeps
 * the last good snapshot. Only when the brain cannot be reached on the first
 * load does the caller's demo fallback show (isDemo: true) until the brain
 * answers.
 */
import { currentBrainUrl } from "../room/brain/brainLink.ts";
import { brainFetch } from "../room/brain/token.ts";
import { DAILY_QUESTS } from "./quests.ts";
import { areaValue, levelOf, rankOf } from "./rpgMath.ts";
import type { AreaId, PathState, QuestState, RpgSnapshot, RpgSource } from "./types.ts";

/** The daily goal shown next to today's XP (same number the demo used). */
export const DAILY_GOAL = 50;

/** The /v1/rpg/today reply, as the brain sends it. */
export type TodayReply = {
  areaXp: Partial<Record<AreaId, number>>;
  todayXp: number;
  quests: { id: string; done: boolean; sub?: string }[];
  paths: { id: string; pct: number }[];
};

/** Display names for the five long paths. */
const PATH_NAMES: Record<string, string> = {
  house: "House",
  car: "Car",
  study: "Study",
  "bakugan-buddy": "Bakugan Buddy",
  studio: "Studio",
};

/** The five path ids in display order, matching PathsRow and the brain. */
const PATH_IDS = ["house", "car", "study", "bakugan-buddy", "studio"] as const;

const ZERO_AREA_XP: Record<AreaId, number> = {
  body: 0,
  intel: 0,
  money: 0,
  spirit: 0,
  craft: 0,
  goal: 0,
};

/** A reply that has the fields the snapshot builder needs. */
function isTodayReply(value: unknown): value is TodayReply {
  if (!value || typeof value !== "object") return false;
  const reply = value as Partial<TodayReply>;
  return (
    typeof reply.todayXp === "number" &&
    reply.areaXp !== null &&
    typeof reply.areaXp === "object" &&
    Array.isArray(reply.quests) &&
    Array.isArray(reply.paths)
  );
}

/**
 * Builds the one snapshot object the screens know from a brain reply, using
 * the existing rpgMath functions and the quest titles from quests.ts.
 * Pure, so tests can feed it a sample reply.
 */
export function buildSnapshot(reply: TodayReply): RpgSnapshot {
  const areaXp = { ...ZERO_AREA_XP };
  for (const area of Object.keys(ZERO_AREA_XP) as AreaId[]) {
    const xp = Number(reply.areaXp?.[area]);
    if (Number.isFinite(xp)) areaXp[area] = xp;
  }
  const totalXp = (Object.keys(areaXp) as AreaId[]).reduce((sum, area) => sum + areaXp[area], 0);
  const { L, into, need } = levelOf(totalXp);
  const rank = rankOf(L);
  const areaValueMap = {} as Record<AreaId, number>;
  for (const area of Object.keys(areaXp) as AreaId[]) {
    areaValueMap[area] = areaValue(areaXp[area]);
  }

  const byId = new Map(reply.quests.map((quest) => [quest.id, quest]));
  const quests: QuestState[] = DAILY_QUESTS.map((def) => {
    const fromServer = byId.get(def.id);
    return {
      ...def,
      done: fromServer?.done === true,
      sub: fromServer?.sub ?? def.sub,
    };
  });

  const pathsByServer = new Map(reply.paths.map((path) => [path.id, path]));
  const paths: PathState[] = PATH_IDS.map((id) => {
    const pct = Number(pathsByServer.get(id)?.pct);
    return {
      id,
      name: PATH_NAMES[id],
      pct: Number.isFinite(pct) ? Math.max(0, Math.min(100, pct)) : 0,
    };
  });

  return {
    isDemo: false,
    totalXp,
    level: L,
    levelInto: into,
    levelNeed: need,
    rank,
    areaXp,
    areaValue: areaValueMap,
    todayXp: Number.isFinite(Number(reply.todayXp)) ? Number(reply.todayXp) : 0,
    dailyGoal: DAILY_GOAL,
    quests,
    paths,
  };
}

export interface LogSourceOptions {
  /** Brain base URL; defaults to the host that served the page. */
  brain?: string;
  /** fetch that carries the pairing token; defaults to brainFetch. */
  fetchImpl?: typeof fetch;
  /** Refresh interval while visible; default 60 s. */
  refreshMs?: number;
  /** Set false in tests to keep timers out of the runner. */
  autoRefresh?: boolean;
  /** Demo snapshot to show until the brain answers the first time. */
  demoFallback?: () => RpgSnapshot;
}

/** The concrete source with awaitable actions, used by tests. */
export type LogSource = Omit<RpgSource, "toggleQuest" | "addFocus" | "addWater" | "addMood"> & {
  toggleQuest(id: string): Promise<void>;
  addFocus(minutes: number): Promise<void>;
  addWater(glasses: number): Promise<void>;
  addMood(score: number): Promise<void>;
  /** Ask the brain now; a failed fetch keeps the last good snapshot. */
  refreshNow(): Promise<void>;
};

/** Whether the page is actually on screen. */
let nativeActive = true;

function pageVisible(): boolean {
  if (typeof document !== "undefined") return document.visibilityState === "visible";
  return nativeActive;
}

/** Catch-up refresh when the page comes back, and AppState on the iPhone. */
function trackVisibility(refresh: () => void): void {
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") refresh();
    });
    return;
  }
  if (typeof navigator === "undefined" || navigator.product !== "ReactNative") return;
  void import("react-native")
    .then((rn) => {
      nativeActive = rn.AppState.currentState === "active";
      rn.AppState.addEventListener("change", (state) => {
        nativeActive = state === "active";
        if (nativeActive) refresh();
      });
    })
    .catch(() => {
      /* no AppState: the source just always counts the page as visible */
    });
}

/**
 * The real source, one per app (created lazily in source.ts). State is only
 * the last good brain reply; nothing is stored or written on the client.
 */
export function createLogSource(options: LogSourceOptions = {}): LogSource {
  const brain = String(options.brain ?? currentBrainUrl()).replace(/\/+$/, "");
  const fetchImpl = options.fetchImpl ?? brainFetch;
  const refreshMs = options.refreshMs ?? 60_000;
  const autoRefresh = options.autoRefresh ?? true;

  let reply: TodayReply | null = null;
  const subscribers = new Set<(snapshot: RpgSnapshot) => void>();

  function current(): RpgSnapshot {
    if (reply) return buildSnapshot(reply);
    // The demo fallback hands out a fresh snapshot per call, like the mock.
    if (options.demoFallback) return options.demoFallback();
    // No fallback provided (tests): a zeroed real snapshot.
    return buildSnapshot({ areaXp: {}, todayXp: 0, quests: [], paths: [] });
  }

  function notify(): void {
    if (!reply) return;
    const snapshot = buildSnapshot(reply);
    for (const fn of subscribers) fn(snapshot);
  }

  async function refreshNow(): Promise<void> {
    try {
      const res = await fetchImpl(`${brain}/v1/rpg/today`);
      if (!res.ok) return; // keep the last good snapshot
      const body: unknown = await res.json().catch(() => null);
      if (!isTodayReply(body)) return;
      reply = body;
      notify();
    } catch {
      /* the Mac did not answer: keep the last good snapshot */
    }
  }

  async function post(pathname: string, body: unknown): Promise<void> {
    try {
      const res = await fetchImpl(`${brain}${pathname}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) return; // keep the last good snapshot
      const fresh: unknown = await res.json().catch(() => null);
      if (!isTodayReply(fresh)) return;
      reply = fresh;
      notify();
    } catch {
      /* keep the last good snapshot */
    }
  }

  if (autoRefresh) {
    void refreshNow();
    setInterval(() => {
      if (pageVisible()) void refreshNow();
    }, refreshMs);
    trackVisibility(() => void refreshNow());
  }

  return {
    get: current,

    subscribe(fn: (snapshot: RpgSnapshot) => void): () => void {
      subscribers.add(fn);
      return () => {
        subscribers.delete(fn);
      };
    },

    toggleQuest(id: string): Promise<void> {
      const quest = current().quests.find((candidate) => candidate.id === id);
      return post("/v1/rpg/quest", { questId: id, done: !(quest?.done === true) });
    },

    addFocus(minutes: number): Promise<void> {
      return post("/v1/rpg/focus", { minutes, area: "intel" });
    },

    addWater(glasses: number): Promise<void> {
      return post("/v1/rpg/water", { glasses });
    },

    addMood(score: number): Promise<void> {
      return post("/v1/rpg/mood", { score });
    },

    refreshNow,
  };
}
