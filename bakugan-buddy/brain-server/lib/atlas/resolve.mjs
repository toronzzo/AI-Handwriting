/**
 * Deciding that two names mean the same thing.
 *
 * Three rules keep this honest:
 *
 *  1. Plural folding is an allowlist of common nouns, and it never touches a
 *     capitalised surface. An earlier pass folded every trailing "s" and
 *     turned "Preyas" into "preya" - a name is not a plural.
 *  2. A merge never deletes a node. It returns the survivor plus an audit row
 *     naming both sides, so the history of a mistaken merge stays readable.
 *  3. Fuzzy matching only runs on keys of five characters or more, and only
 *     within two edits, so "NASA" and "NADA" stay different things.
 */

const PLURAL_SINGULARS = new Set([
  "answer", "book", "card", "color", "deck", "decision", "document", "emoji",
  "file", "flashcard", "goal", "habit", "idea", "image", "lesson", "memory",
  "model", "moment", "note", "person", "photo", "planet", "project", "promise",
  "question", "quiz", "story", "task", "thing", "thread", "trick", "word",
]);

export const FUZZY_MIN_LENGTH = 5;
export const FUZZY_MAX_DISTANCE = 2;

export function normalizeSurface(surface) {
  return String(surface ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["'“”([]+/, "")
    .replace(/["'“”),.;:!\]]+$/, "")
    .trim();
}

/**
 * Fold a plural only when the word is lowercase, long enough, not already
 * ending in "ss", and its singular is a known common noun.
 */
export function foldPlural(word) {
  const value = String(word ?? "");
  if (!value) return value;
  if (value !== value.toLowerCase()) return value;
  if (PLURAL_SINGULARS.has(value)) return value;
  if (!value.endsWith("s") || value.endsWith("ss") || value.length < 5) return value;
  const singular = value.slice(0, -1);
  return PLURAL_SINGULARS.has(singular) ? singular : value;
}

/** The comparison key. Display text is never derived from this. */
export function aliasKey(surface) {
  return foldPlural(normalizeSurface(surface).toLowerCase());
}

/** Bounded edit distance: bails out as soon as it cannot come in under `max`. */
export function editDistance(a, b, max = Infinity) {
  const left = String(a ?? "");
  const right = String(b ?? "");
  if (left === right) return 0;
  if (Math.abs(left.length - right.length) > max) return max + 1;
  if (!left.length) return right.length;
  if (!right.length) return left.length;

  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i++) {
    const current = [i];
    let best = current[0];
    for (let j = 1; j <= right.length; j++) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      const value = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
      current.push(value);
      if (value < best) best = value;
    }
    if (best > max) return max + 1;
    previous = current;
  }
  return previous[right.length];
}

function keysOf(node) {
  const keys = new Set();
  const label = normalizeSurface(node?.label);
  if (label) keys.add(aliasKey(label));
  for (const alias of node?.aliases ?? []) {
    const clean = normalizeSurface(alias);
    if (clean) keys.add(aliasKey(clean));
  }
  return [...keys];
}

/**
 * Find the node a surface belongs to. Exact alias first, then fuzzy for long
 * enough keys. Returns null when nothing is close, which is the common case
 * and not a failure.
 */
export function findEntity(nodes = [], surface, { maxDistance = FUZZY_MAX_DISTANCE } = {}) {
  const key = aliasKey(surface);
  if (!key) return null;

  for (const node of nodes) {
    if (keysOf(node).includes(key)) return { node, match: "exact", distance: 0, key };
  }

  if (key.length < FUZZY_MIN_LENGTH) return null;
  let best = null;
  for (const node of nodes) {
    for (const candidate of keysOf(node)) {
      if (candidate.length < FUZZY_MIN_LENGTH) continue;
      const distance = editDistance(key, candidate, maxDistance);
      if (distance > maxDistance) continue;
      if (!best || distance < best.distance) best = { node, match: "fuzzy", distance, key };
    }
  }
  return best;
}

/**
 * Merge two nodes into one. The survivor is the older one, so a merge never
 * rewrites when something was first seen. Both ids go into the audit row and
 * nothing is deleted here - the caller decides what the store does with it.
 */
export function mergeNodes(a, b, at = 0) {
  if (!a || !b) throw new TypeError("mergeNodes needs two nodes");
  const [keep, drop] = Number(a.at) <= Number(b.at) ? [a, b] : [b, a];
  const aliases = [
    ...new Set(
      [...(keep.aliases ?? []), keep.label, ...(drop.aliases ?? []), drop.label]
        .map(normalizeSurface)
        .filter(Boolean),
    ),
  ];
  const node = {
    ...keep,
    aliases,
    at: Math.min(Number(keep.at) || 0, Number(drop.at) || 0),
    confidence: Math.max(Number(keep.confidence) || 0, Number(drop.confidence) || 0),
    props: { ...(drop.props ?? {}), ...(keep.props ?? {}) },
  };
  return {
    node,
    merged: [keep.id, drop.id],
    audit: {
      op: "merge",
      keep: keep.id,
      drop: drop.id,
      at,
      why: `alias collision on "${aliasKey(keep.label) || keep.id}"`,
    },
  };
}
