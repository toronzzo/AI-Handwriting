import { decayEmotion, defaultEmotion, setEmotionSnap, type EmotionSnapshot } from "./decay.ts";
import type { EmotionRow } from "./schema.ts";

export type PersistedCompanion = {
  emotion: EmotionSnapshot;
  partnerName: string | null;
  activeId: string;
  bonds: Record<string, number>;
  facts: string[];
  forms: Record<string, string>;
};

export type SqlLike = {
  run(sql: string, params?: unknown[]): void | Promise<void>;
  get(sql: string, params?: unknown[]): EmotionRow | undefined | Promise<EmotionRow | undefined>;
};

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  try {
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function rowToState(row: EmotionRow | undefined, now = Date.now()): PersistedCompanion {
  if (!row) {
    return {
      emotion: defaultEmotion(now),
      partnerName: null,
      activeId: "preyas",
      bonds: { preyas: 8, pyrax: 8, vexar: 8 },
      facts: [],
      forms: { preyas: "sphere", pyrax: "sphere", vexar: "sphere" },
    };
  }
  const emotion = decayEmotion(
    {
      mood: row.mood as EmotionSnapshot["mood"],
      intensity: row.intensity,
      updatedAt: row.updated_at,
    },
    now,
  );
  return {
    emotion,
    partnerName: row.partner_name,
    activeId: row.active_id || "preyas",
    bonds: parseJson(row.bonds_json, { preyas: 8, pyrax: 8, vexar: 8 }),
    facts: parseJson(row.facts_json, [] as string[]),
    forms: parseJson(row.forms_json, {
      preyas: "sphere",
      pyrax: "sphere",
      vexar: "sphere",
    }),
  };
}

export async function loadPersisted(
  db: SqlLike,
  now = Date.now(),
): Promise<PersistedCompanion> {
  const row = await Promise.resolve(
    db.get("SELECT * FROM emotion_state WHERE id = 1"),
  );
  return rowToState(row, now);
}

export async function savePersisted(db: SqlLike, state: PersistedCompanion): Promise<void> {
  const e = state.emotion;
  await Promise.resolve(
    db.run(
      `INSERT INTO emotion_state (
        id, mood, intensity, updated_at, partner_name, active_id, bonds_json, facts_json, forms_json
      ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        mood=excluded.mood,
        intensity=excluded.intensity,
        updated_at=excluded.updated_at,
        partner_name=excluded.partner_name,
        active_id=excluded.active_id,
        bonds_json=excluded.bonds_json,
        facts_json=excluded.facts_json,
        forms_json=excluded.forms_json`,
      [
        e.mood,
        e.intensity,
        e.updatedAt,
        state.partnerName,
        state.activeId,
        JSON.stringify(state.bonds),
        JSON.stringify(state.facts.slice(-40)),
        JSON.stringify(state.forms),
      ],
    ),
  );
}

export function touchMood(
  state: PersistedCompanion,
  mood: string,
  intensity = 1,
  now = Date.now(),
): PersistedCompanion {
  return { ...state, emotion: setEmotionSnap(mood, intensity, now) };
}
