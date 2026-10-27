/** Shared SQLite DDL — companion (sql.js) and Expo (expo-sqlite). */
export const EMOTION_SCHEMA = `
CREATE TABLE IF NOT EXISTS emotion_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  mood TEXT NOT NULL,
  intensity REAL NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL,
  partner_name TEXT,
  active_id TEXT,
  bonds_json TEXT NOT NULL DEFAULT '{}',
  facts_json TEXT NOT NULL DEFAULT '[]',
  forms_json TEXT NOT NULL DEFAULT '{}'
);
`;

export type EmotionRow = {
  mood: string;
  intensity: number;
  updated_at: number;
  partner_name: string | null;
  active_id: string | null;
  bonds_json: string;
  facts_json: string;
  forms_json: string;
};
