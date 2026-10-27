/**
 * In-memory SQLite-shaped store for unit tests / Node without native bindings.
 * Same SQL surface the real adapters use for the emotion_state row.
 */
import { EMOTION_SCHEMA, type EmotionRow } from "./schema.ts";
import type { SqlLike } from "./store.ts";

export class MemorySqlDb implements SqlLike {
  #row: EmotionRow | undefined;

  constructor() {
    // schema is documentation — single-row store
    void EMOTION_SCHEMA;
  }

  run(sql: string, params: unknown[] = []): void {
    const s = sql.replace(/\s+/g, " ").trim().toUpperCase();
    if (s.startsWith("CREATE")) return;
    if (s.includes("INSERT INTO EMOTION_STATE") || s.includes("ON CONFLICT")) {
      const [
        mood,
        intensity,
        updated_at,
        partner_name,
        active_id,
        bonds_json,
        facts_json,
        forms_json,
      ] = params as [
        string,
        number,
        number,
        string | null,
        string | null,
        string,
        string,
        string,
      ];
      this.#row = {
        mood,
        intensity,
        updated_at,
        partner_name,
        active_id,
        bonds_json,
        facts_json,
        forms_json,
      };
    }
  }

  get(sql: string): EmotionRow | undefined {
    if (/SELECT \* FROM emotion_state/i.test(sql)) return this.#row;
    return undefined;
  }
}
