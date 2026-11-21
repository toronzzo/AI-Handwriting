/**
 * CHANGELOG_PREYAS.md: short, friendly "I can now ..." lines, newest first.
 * The brain reads this file at startup so Preyas can answer "what's new?".
 */
import fs from "node:fs";

export const CHANGELOG_MAX_ITEMS = 5;

const ENTRY = /^\s*[-*]\s+(\d{4}-\d{2}-\d{2})\s+[—–-]\s+(I can now\b.+?)\s*$/i;
const PR = /\s*\(#(\d+)\)\s*$/;

/**
 * Parse the changelog. Any line that is not a dated "I can now ..." entry is
 * ignored, so the file can keep headings and a friendly introduction.
 */
export function parseChangelog(text) {
  const items = [];
  const seen = new Set();
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const match = line.match(ENTRY);
    if (!match) continue;
    let body = match[2].trim();
    let pr = null;
    const prMatch = body.match(PR);
    if (prMatch) {
      pr = Number(prMatch[1]);
      body = body.slice(0, prMatch.index).trim();
    }
    const date = match[1];
    const id = date + "|" + body;
    if (seen.has(id)) continue;
    seen.add(id);
    items.push({ id, date, text: body, pr });
  }
  return items;
}

/** The newest entries, in file order. */
export function latestChangelog(items, limit = CHANGELOG_MAX_ITEMS) {
  return (Array.isArray(items) ? items : []).slice(0, Math.max(0, limit));
}

/** Read and parse a changelog file; a missing or broken file is just empty. */
export function readChangelog(file, options = {}) {
  const { fsImpl = fs, limit = Infinity } = options;
  if (!file) return { items: [], error: null };
  try {
    if (!fsImpl.existsSync(file)) return { items: [], error: null };
    const text = fsImpl.readFileSync(file, "utf8");
    return { items: parseChangelog(text).slice(0, limit), error: null };
  } catch (error) {
    return { items: [], error: error instanceof Error ? error.message : String(error) };
  }
}
