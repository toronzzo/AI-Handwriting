/**
 * SQLite fact book on the external drive.
 * sqlite-vec is optional. Without it, recall is token overlap in JS.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { MEMORY_CAP, mergeFacts, parseExtractedFacts, rankFacts } from "../../packages/alive/src/longMemory.ts";

const require = createRequire(import.meta.url);

export { parseExtractedFacts };

export function openMemory(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS facts (
      id INTEGER PRIMARY KEY,
      text TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL,
      t INTEGER NOT NULL,
      vec TEXT
    );
  `);
  let vec = false;
  try {
    const sqliteVec = require("sqlite-vec");
    if (typeof db.loadExtension === "function" && typeof sqliteVec.getLoadablePath === "function") {
      db.loadExtension(sqliteVec.getLoadablePath());
      db.exec(
        "CREATE VIRTUAL TABLE IF NOT EXISTS facts_vec USING vec0(fact_id INTEGER PRIMARY KEY, embedding float[32])",
      );
      vec = true;
    }
  } catch {
    vec = false;
  }
  return { db, vec };
}

export function loadFacts(book) {
  const rows = book.db.prepare("SELECT text, kind, vec FROM facts ORDER BY t ASC, id ASC").all();
  return rows.map((row) => ({
    text: row.text,
    kind: row.kind === "event" ? "event" : "user",
    vec: row.vec ? JSON.parse(row.vec) : undefined,
  }));
}

export function rememberFacts(book, incoming) {
  const merged = mergeFacts(loadFacts(book), incoming, MEMORY_CAP);
  const insert = book.db.prepare(
    "INSERT INTO facts (text, kind, t, vec) VALUES (?, ?, ?, ?) ON CONFLICT(text) DO UPDATE SET kind = excluded.kind, t = excluded.t",
  );
  const now = Date.now();
  book.db.exec("BEGIN");
  try {
    for (let i = 0; i < merged.length; i++) {
      const fact = merged[i];
      insert.run(fact.text, fact.kind, now + i, fact.vec ? JSON.stringify(fact.vec) : null);
    }
    const extras = book.db.prepare("SELECT id, text FROM facts").all();
    const keep = new Set(merged.map((fact) => fact.text.toLowerCase()));
    const drop = book.db.prepare("DELETE FROM facts WHERE id = ?");
    for (const row of extras) {
      if (!keep.has(String(row.text).toLowerCase())) drop.run(row.id);
    }
    book.db.exec("COMMIT");
  } catch (error) {
    book.db.exec("ROLLBACK");
    throw error;
  }
  return merged.length;
}

export function relevantFacts(book, query, limit = 4) {
  return rankFacts(loadFacts(book), query, limit).map((fact) => fact.text);
}
