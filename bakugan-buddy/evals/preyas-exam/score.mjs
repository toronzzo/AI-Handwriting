/**
 * Scoring for the Preyas Exam.
 *
 * Pure functions: the runner hands over an answer and the item's expectations,
 * this decides what was recalled, what contradicts the notes, and what numbers
 * were invented. Nothing here talks to the model, so it is testable on its own.
 */

/**
 * Markdown and typography off, case and whitespace flat. Matching should be
 * about words, not about whether the model used ** or an en dash.
 */
export function normalize(text) {
  return String(text ?? "")
    .normalize("NFKC")
    .replace(/[*_`~]/g, "")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * The same text with separators gone. "Qwen3 14B" and
 * "Huihui-Qwen3-14B-abliterated-v2.gguf" are the same model, so a spaced
 * requirement has to accept the hyphenated filename the model actually writes.
 */
function loose(text) {
  return normalize(text).replace(/[\s\-_./·]/g, "");
}

/** Numbers as canonical tokens, so "17" can never satisfy a request for "7". */
export function numbersIn(text) {
  const found = new Set();
  for (const match of normalize(text).matchAll(/(?<![\d.])(\d+(?:\.\d+)?)(?![\d])/g)) {
    found.add(String(Number(match[1])));
  }
  return found;
}

function hasPhrase(answer, phrase) {
  const wanted = normalize(phrase);
  if (!wanted) return false;
  if (/^\d+(\.\d+)?$/.test(wanted)) return numbersIn(answer).has(String(Number(wanted)));
  if (normalize(answer).includes(wanted)) return true;
  const flat = loose(wanted);
  return flat.length >= 3 && loose(answer).includes(flat);
}

/**
 * Score one answer against one item.
 *
 * - `must`: phrases that all have to appear.
 * - `any`: groups of alternatives; one phrase from each group has to appear.
 * - `mustNot`: phrases that would make the answer wrong.
 * - `known`: every number that appears somewhere in the user's own notes.
 *
 * Numbers in the answer are compared against the ones this item expects, the
 * ones it explicitly allows, and every number anywhere in the notes. A number
 * outside all of those was invented, not recalled. `known` stays empty when
 * the caller has no note data, which falls back to per-item strictness.
 */
export function scoreAnswer({ answer, must = [], any = [], mustNot = [], allow = [], source = "", known = [] }) {
  const text = String(answer ?? "");
  const missing = must.filter((phrase) => !hasPhrase(text, phrase));
  const groups = any.map((group) => {
    const hit = group.find((phrase) => hasPhrase(text, phrase));
    return { group, hit: hit ?? null };
  });
  const found = must.length - missing.length + groups.filter((g) => g.hit).length;
  const total = must.length + any.length;
  const contradictions = mustNot.filter((phrase) => hasPhrase(text, phrase));
  const allowedNumbers = new Set([
    ...numbersIn(must.join(" ")),
    ...numbersIn(any.flat().join(" ")),
    ...numbersIn(allow.join(" ")),
    ...numbersIn(source),
    ...known,
  ]);
  const fabricated = [...numbersIn(text)].filter((n) => !allowedNumbers.has(n));
  return {
    facts: { found, total, score: total === 0 ? 1 : found / total, missing, groups },
    contradictions,
    fabricated,
    pass: missing.length === 0 && groups.every((g) => g.hit) && contradictions.length === 0,
  };
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const at = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[at];
}

/** Roll rows up into the numbers a model or prompt change is judged by. */
export function summarize(rows) {
  const done = rows.filter((row) => row && !row.error);
  const seconds = done.map((r) => r.seconds).sort((a, b) => a - b);
  const tokens = done.map((r) => r.tokens);
  const mean = (list) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : 0);
  const facts = mean(done.map((r) => r.facts.score));
  return {
    count: done.length,
    errors: rows.length - done.length,
    factScore: facts,
    passRate: done.length ? done.filter((r) => r.pass).length / done.length : 0,
    itemsWithContradiction: done.filter((r) => r.contradictions.length).length,
    itemsWithFabricatedNumber: done.filter((r) => r.fabricated.length).length,
    meanSeconds: mean(seconds),
    p95Seconds: percentile(seconds, 95),
    meanTokens: mean(tokens),
  };
}

/** Per-kind summaries, so a regression in decisions is not hidden by facts. */
export function byKind(rows) {
  const kinds = [...new Set(rows.map((r) => r.kind))].sort();
  return kinds.map((kind) => ({
    kind,
    ...summarize(rows.filter((r) => r.kind === kind)),
  }));
}
