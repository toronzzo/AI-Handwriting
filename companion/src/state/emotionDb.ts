import {
  EMOTION_SCHEMA,
  MemorySqlDb,
  loadPersisted,
  savePersisted,
  touchMood,
  type PersistedCompanion,
} from "../../../bakugan-buddy/packages/emotion-state/src/index.ts";
import { loadMemory, type PartnerMemory } from "../memory";
import type { Emotion } from "../bakugans";

const LS_KEY = "bakugan-emotion-sqlite-v1";

/** Web stand-in for SQLite: same row shape, durable in localStorage. */
export class WebEmotionDb extends MemorySqlDb {
  constructor() {
    super();
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const row = JSON.parse(raw);
        this.run(
          `INSERT INTO emotion_state (
            id, mood, intensity, updated_at, partner_name, active_id, bonds_json, facts_json, forms_json
          ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET mood=excluded.mood`,
          [
            row.mood,
            row.intensity,
            row.updated_at,
            row.partner_name,
            row.active_id,
            row.bonds_json,
            row.facts_json,
            row.forms_json,
          ],
        );
      }
    } catch {
      /* fresh */
    }
    this.run(EMOTION_SCHEMA);
  }

  override run(sql: string, params: unknown[] = []): void {
    super.run(sql, params);
    const row = this.get("SELECT * FROM emotion_state WHERE id = 1");
    if (row) localStorage.setItem(LS_KEY, JSON.stringify(row));
  }
}

let db: WebEmotionDb | null = null;

export function emotionDb(): WebEmotionDb {
  if (!db) db = new WebEmotionDb();
  return db;
}

export function memoryFromPersisted(p: PersistedCompanion): PartnerMemory {
  return {
    partnerName: p.partnerName,
    facts: p.facts,
    activeId: (p.activeId as PartnerMemory["activeId"]) || "preyas",
    bonds: {
      preyas: p.bonds.preyas ?? 8,
      pyrax: p.bonds.pyrax ?? 8,
      vexar: p.bonds.vexar ?? 8,
    },
    forms: {
      preyas: (p.forms.preyas as PartnerMemory["forms"]["preyas"]) || "sphere",
      pyrax: (p.forms.pyrax as PartnerMemory["forms"]["pyrax"]) || "sphere",
      vexar: (p.forms.vexar as PartnerMemory["forms"]["vexar"]) || "sphere",
    },
  };
}

export function persistedFromMemory(
  mem: PartnerMemory,
  emotion: { mood: Emotion; intensity: number; updatedAt: number },
): PersistedCompanion {
  return {
    emotion: {
      mood: emotion.mood,
      intensity: emotion.intensity,
      updatedAt: emotion.updatedAt,
    },
    partnerName: mem.partnerName,
    activeId: mem.activeId,
    bonds: mem.bonds,
    facts: mem.facts,
    forms: mem.forms,
  };
}

export async function bootEmotionState(): Promise<{
  mem: PartnerMemory;
  mood: Emotion;
  intensity: number;
}> {
  const store = emotionDb();
  const p = await loadPersisted(store);
  // If empty first run, try migrate legacy localStorage memory
  if (!store.get("SELECT * FROM emotion_state WHERE id = 1")) {
    try {
      const legacy = loadMemory();
      await savePersisted(
        store,
        persistedFromMemory(legacy, {
          mood: "neutral",
          intensity: 0.35,
          updatedAt: Date.now(),
        }),
      );
      const again = await loadPersisted(store);
      return {
        mem: memoryFromPersisted(again),
        mood: again.emotion.mood,
        intensity: again.emotion.intensity,
      };
    } catch {
      /* ignore */
    }
  }
  return {
    mem: memoryFromPersisted(p),
    mood: p.emotion.mood,
    intensity: p.emotion.intensity,
  };
}

export async function persistTurn(
  mem: PartnerMemory,
  mood: Emotion,
  intensity = 1,
): Promise<void> {
  const now = Date.now();
  await savePersisted(
    emotionDb(),
    touchMood(persistedFromMemory(mem, { mood, intensity, updatedAt: now }), mood, intensity, now),
  );
}
