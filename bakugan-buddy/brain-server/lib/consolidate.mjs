/**
 * The nightly consolidation pass.
 *
 * Notes only ever grew: 186 rows, several saying the same thing twice, and no
 * path from "written down" to "part of what I know". Once a night this pass
 * does four small things, all rules, no model:
 *
 *  1. merge near-duplicate notes, using the same isDuplicate rule the store
 *     already applies on insert, so a merge cannot surprise the store;
 *  2. decay notes nobody has touched for STALE_DAYS into
 *     memory/notes-archive.jsonl - filing, not forgetting, because the text is
 *     kept and can be restored;
 *  3. lift every remaining note into the Atlas graph as a record node with
 *     `mentions` edges to the entities a rule could name;
 *  4. write one short digest, so the night's work is a paragraph and not a diff.
 *
 * Deadlines and decisions never decay: a promise does not expire just because
 * it has been quiet. Every file the pass writes is derived from
 * memory/notes.jsonl, so a bad night can always be re-run.
 */
import fs from "node:fs";
import path from "node:path";
import { isDuplicate, noteWords } from "../../packages/alive/src/notes.ts";
import { loadNotes, notesDir, saveNotes } from "./notes.mjs";
import { writeTextAtomic } from "./history.mjs";
import { CONFIDENCE, typeForNoteKind, entityNode, recordNode, validateEdge } from "./atlas/schema.mjs";
import { mergeCandidates, ruleEntities } from "./atlas/extract.mjs";
import { findEntity, normalizeSurface } from "./atlas/resolve.mjs";

export const DAY_MS = 86_400_000;
/** Quiet for this long, and a note is filed away. */
export const STALE_DAYS = 90;
/** Only a promise or a decision outlives a quarter of silence. */
export const DURABLE_KINDS = new Set(["deadline", "decision"]);
/** The pass owns the small hours; the briefing gets the morning. */
export const CONSOLIDATE_HOUR = 3;
/** A note can name a lot; a plate and a map cannot show all of it. */
export const MAX_ENTITIES_PER_NOTE = 6;
/** Two notes of one kind merge at this much word overlap... */
export const SAME_KIND_COVERAGE = 0.75;
/** ...and notes of different kinds only when they are the same sentence. */
export const CROSS_KIND_COVERAGE = 0.9;
/** Fewer than this many shared words is a shared topic, not a duplicate. */
export const MERGE_MIN_SHARED = 4;
/** Both notes have to be mostly accounted for, so one stray word cannot win. */
export const MERGE_LONG_COVERAGE = 0.6;
/** "I like X" and "I do not like X" are opposites, not duplicates. */
const NEGATION = /\b(?:not|no|never|without|cannot|can't|don't|doesn't|isn't|aren't|won't)\b/i;

export function digestDir(root) {
  return path.join(notesDir(root), "digest");
}

export function digestPath(root, day) {
  return path.join(digestDir(root), `${day}.md`);
}

export function archivePath(root) {
  return path.join(notesDir(root), "notes-archive.jsonl");
}

export function atlasPath(root) {
  return path.join(notesDir(root), "atlas.json");
}

export function statePath(root) {
  return path.join(notesDir(root), "consolidation.json");
}

/** YYYY-MM-DD in Europe/Warsaw, the same day the briefing uses. */
export function dayKey(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Warsaw",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now instanceof Date ? now : new Date(now));
}

/**
 * Word overlap, measured both ways. Coverage alone merged "prefers
 * straightforward communication" into "prefers minimal emojis", because the
 * shared words outnumbered the one word that made them different; requiring
 * the longer note to be largely covered too keeps that word visible.
 */
export function similarity(a, b) {
  const left = new Set(noteWords(a));
  const right = new Set(noteWords(b));
  if (!left.size || !right.size) return { shared: 0, coverage: 0, overlap: 0, min: 0 };
  const shared = [...left].filter((word) => right.has(word)).length;
  const min = Math.min(left.size, right.size);
  const max = Math.max(left.size, right.size);
  return { shared, min, coverage: shared / min, overlap: shared / max };
}

/** True when two notes are the same item written twice. */
export function nearDuplicate(a, b) {
  if (!a || !b) return false;
  const textA = String(a.text ?? "");
  const textB = String(b.text ?? "");
  if (isDuplicate(textA, textB)) return true;
  if (NEGATION.test(textA) !== NEGATION.test(textB)) return false;
  const { shared, min, coverage, overlap } = similarity(textA, textB);
  if (shared < 2) return false;
  // Two or three content words: identical is a duplicate, anything less is not.
  if (min <= 3) return coverage === 1;
  if (shared < MERGE_MIN_SHARED || overlap < MERGE_LONG_COVERAGE) return false;
  return coverage >= (a.kind === b.kind ? SAME_KIND_COVERAGE : CROSS_KIND_COVERAGE);
}

/**
 * Merge notes that say the same thing. The oldest note survives (a reference
 * to it stays valid), adopts the longer text (a merge must not lose detail),
 * and keeps the latest touch so a merge is not mistaken for silence.
 */
export function mergeDuplicates(notes = []) {
  const rows = [...notes]
    .sort((left, right) => (left.created || 0) - (right.created || 0))
    .map((note) => ({ ...note }));
  const kept = [];
  const pairs = [];
  for (const note of rows) {
    const same = kept.find((existing) => nearDuplicate(existing, note));
    if (!same) {
      kept.push(note);
      continue;
    }
    if (String(note.text).length > String(same.text).length) same.text = note.text;
    same.created = Math.min(same.created || 0, note.created || 0);
    same.updated = Math.max(same.updated || 0, note.updated || 0);
    same.sourceChatId = same.sourceChatId || note.sourceChatId || "";
    pairs.push({ keep: same.id, drop: note.id, text: note.text });
  }
  return { notes: kept, pairs };
}

/** True when nothing has touched this note for `staleDays`. */
export function isStale(note, { now = Date.now(), staleDays = STALE_DAYS } = {}) {
  if (!note || DURABLE_KINDS.has(note.kind)) return false;
  const touched = Number(note.updated) || Number(note.created) || 0;
  return Number(now) - touched >= Number(staleDays) * DAY_MS;
}

/** Split the notes into what stays and what is filed away. */
export function decayNotes(notes = [], options = {}) {
  const kept = [];
  const decayed = [];
  for (const note of notes) (isStale(note, options) ? decayed : kept).push(note);
  return { kept, decayed };
}

function entityId(surface) {
  const slug = normalizeSurface(surface)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `entity:${slug || "unnamed"}`;
}

/**
 * Every note becomes a record, every name a rule can see becomes an entity,
 * and the record points at it. Entities are shared: the second note that
 * mentions "Preyas" joins the node the first one made, which is the whole
 * reason the entity layer exists.
 */
export function liftToAtlas(notes = [], { now = Date.now() } = {}) {
  const nodes = [];
  const edges = [];
  const entities = [];
  for (const note of notes) {
    const at = Number(note.updated) || Number(note.created) || Number(now);
    const record = recordNode({
      id: `note:${note.id}`,
      type: "note",
      text: note.text,
      at,
      source: { kind: "note", id: note.id },
    });
    nodes.push(record);
    const candidates = mergeCandidates(ruleEntities(note.text)).slice(0, MAX_ENTITIES_PER_NOTE);
    for (const candidate of candidates) {
      const hit = findEntity(entities, candidate.surface);
      let entity;
      if (hit) {
        entity = hit.node;
        if (!entity.aliases.some((alias) => alias.toLowerCase() === candidate.surface.toLowerCase())) {
          entity.aliases.push(candidate.surface);
        }
      } else {
        entity = entityNode({
          id: entityId(candidate.surface),
          type: typeForNoteKind(note.kind),
          label: candidate.surface,
          at,
          source: { kind: "note", id: note.id },
          confidence: candidate.confidence ?? CONFIDENCE.RULE,
          aliases: [candidate.surface],
        });
        entities.push(entity);
        nodes.push(entity);
      }
      edges.push(
        validateEdge({
          from: record.id,
          to: entity.id,
          relation: "mentions",
          why: candidate.why || "rule:name",
          source: { kind: "note", id: note.id },
          at,
          confidence: candidate.confidence ?? CONFIDENCE.RULE,
        }),
      );
    }
  }
  return { nodes, edges };
}

export function saveAtlas(root, graph, now = Date.now()) {
  fs.mkdirSync(notesDir(root), { recursive: true });
  const body = { version: 1, at: Number(now), nodes: graph.nodes, edges: graph.edges };
  writeTextAtomic(atlasPath(root), `${JSON.stringify(body, null, 1)}\n`);
  return body;
}

export function loadAtlas(root) {
  const file = atlasPath(root);
  if (!fs.existsSync(file)) return { version: 1, at: 0, nodes: [], edges: [] };
  try {
    const body = JSON.parse(fs.readFileSync(file, "utf8"));
    return {
      version: Number(body?.version) || 1,
      at: Number(body?.at) || 0,
      nodes: Array.isArray(body?.nodes) ? body.nodes : [],
      edges: Array.isArray(body?.edges) ? body.edges : [],
    };
  } catch {
    return { version: 1, at: 0, nodes: [], edges: [] };
  }
}

/** Append decayed notes, skipping any that were filed on an earlier night. */
export function appendArchive(root, notes = [], now = Date.now()) {
  if (!notes.length) return 0;
  const file = archivePath(root);
  const seen = new Set();
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        seen.add(String(JSON.parse(line).id));
      } catch {
        /* a torn line is not a reason to lose today's rows */
      }
    }
  }
  const rows = notes.filter((note) => !seen.has(String(note.id))).map((note) => ({ ...note, archivedAt: Number(now) }));
  if (!rows.length) return 0;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, rows.map((row) => `${JSON.stringify(row)}\n`).join(""));
  return rows.length;
}

/** The digest: four short facts about last night, never a diff. */
export function digestText(summary) {
  const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;
  const merged = summary.merged
    ? `${plural(summary.merged, "near-duplicate note was", "near-duplicate notes were")} merged.`
    : "No near-duplicates to merge.";
  const lifted = `${plural(summary.after, "note sits", "notes sit")} on ${plural(summary.entities, "entity", "entities")} with ${plural(summary.links, "mention", "mentions")}.`;
  const decayed = summary.decayed
    ? `${plural(summary.decayed, "stale note was", "stale notes were")} filed to notes-archive.jsonl.`
    : "Nothing was stale enough to file away.";
  return [`# Consolidation - ${summary.day}`, "", merged, "", lifted, "", decayed, ""].join("\n");
}

export function writeDigest(root, summary) {
  fs.mkdirSync(digestDir(root), { recursive: true });
  const file = digestPath(root, summary.day);
  writeTextAtomic(file, digestText(summary));
  return file;
}

export function readState(root) {
  const file = statePath(root);
  if (!fs.existsSync(file)) return { day: "", at: 0 };
  try {
    const body = JSON.parse(fs.readFileSync(file, "utf8"));
    return { day: String(body?.day || ""), at: Number(body?.at) || 0, summary: body?.summary ?? null };
  } catch {
    return { day: "", at: 0 };
  }
}

function writeState(root, summary) {
  fs.mkdirSync(notesDir(root), { recursive: true });
  const body = {
    day: summary.day,
    at: summary.at,
    summary: { before: summary.before, after: summary.after, merged: summary.merged, decayed: summary.decayed },
  };
  writeTextAtomic(statePath(root), `${JSON.stringify(body, null, 1)}\n`);
}

/**
 * One night's pass. `dryRun` computes everything and writes nothing, which is
 * how a first look at 186 notes stays read-only.
 */
export function runConsolidation(root, { now = Date.now(), dryRun = false } = {}) {
  if (!root) throw new TypeError("runConsolidation needs a data root");
  const before = loadNotes(root);
  const merged = mergeDuplicates(before);
  const { kept, decayed } = decayNotes(merged.notes, { now });
  const graph = liftToAtlas(kept, { now });
  const summary = {
    at: Number(now),
    day: dayKey(now),
    before: before.length,
    after: kept.length,
    merged: merged.pairs.length,
    mergedPairs: merged.pairs,
    decayed: decayed.length,
    decayedIds: decayed.map((note) => note.id),
    entities: graph.nodes.filter((node) => node.kind === "entity").length,
    links: graph.edges.length,
  };
  if (dryRun) return summary;

  if (merged.pairs.length || decayed.length) saveNotes(root, kept);
  else fs.mkdirSync(notesDir(root), { recursive: true });
  appendArchive(root, decayed, now);
  saveAtlas(root, graph, now);
  writeDigest(root, summary);
  writeState(root, summary);
  return summary;
}

/**
 * The hourly-ish check the reminder loop makes: run once, after
 * CONSOLIDATE_HOUR, never twice on the same day. Returns null when it is not
 * time yet, so the caller can stay a one-liner.
 */
export function maybeConsolidate(root, now = new Date()) {
  if (!root) return null;
  const day = dayKey(now);
  if (readState(root).day === day) return null;
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Warsaw", hour: "2-digit", hour12: false }).format(now),
  );
  if (!(hour >= CONSOLIDATE_HOUR)) return null;
  return runConsolidation(root, { now: now.getTime() });
}
