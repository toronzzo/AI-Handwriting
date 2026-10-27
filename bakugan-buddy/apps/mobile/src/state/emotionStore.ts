/**
 * Expo SQLite emotion + partner persistence with soft decay on load.
 * Body animation must never await this — call from effects / after turns.
 */
import * as SQLite from "expo-sqlite";
import {
  EMOTION_SCHEMA,
  decayEmotion,
  defaultEmotion,
  loadPersisted,
  savePersisted,
  touchMood,
  type PersistedCompanion,
  type SqlLike,
} from "../../../../packages/emotion-state/src/index.ts";

type ExpoDb = SQLite.SQLiteDatabase;

class ExpoSqlLike implements SqlLike {
  constructor(private db: ExpoDb) {}

  run(sql: string, params: unknown[] = []): void {
    this.db.runSync(sql, params as SQLite.SQLiteBindValue[]);
  }

  get(sql: string, params: unknown[] = []) {
    return this.db.getFirstSync(sql, params as SQLite.SQLiteBindValue[]) as
      | import("../../../../packages/emotion-state/src/schema.ts").EmotionRow
      | undefined;
  }
}

let cached: ExpoSqlLike | null = null;

export function openEmotionDb(): SqlLike {
  if (cached) return cached;
  const db = SQLite.openDatabaseSync("bakugan-buddy.db");
  db.execSync(EMOTION_SCHEMA);
  cached = new ExpoSqlLike(db);
  return cached;
}

export async function loadCompanionState(now = Date.now()): Promise<PersistedCompanion> {
  return loadPersisted(openEmotionDb(), now);
}

export async function saveCompanionState(state: PersistedCompanion): Promise<void> {
  await savePersisted(openEmotionDb(), state);
}

export async function applyMood(mood: string, intensity = 1): Promise<PersistedCompanion> {
  const cur = await loadCompanionState();
  const next = touchMood(cur, mood, intensity);
  await saveCompanionState(next);
  return next;
}

/** Preview decay without writing — for UI thread / body sync. */
export function previewDecayedMood(state: PersistedCompanion, now = Date.now()) {
  return decayEmotion(state.emotion, now);
}

export { defaultEmotion };
