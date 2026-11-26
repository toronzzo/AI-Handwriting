/**
 * Turning written things into a label and a few entity names.
 *
 * Rules run first and always. They are cheap, they never invent anything, and
 * on this machine they are honest about their limits: across 186 notes only
 * 18% match a usable pattern and rules name 0.37 entities per note. So the
 * local model is asked for the names too - and only for names. Every model
 * answer is a suggestion carrying CONFIDENCE.MODEL until the person confirms
 * it, and a model failure leaves the rules result untouched.
 *
 * The model call itself is injected (`chat`), never imported, so every rule in
 * this file is testable without a server and without a single token spent.
 */
import { createHash } from "node:crypto";
import { CONFIDENCE } from "./schema.mjs";

/** Verbs that add nothing once the note is on a plate. */
const LEAD_VERB =
  /^(?:use|switch to|switch|read(?: more)?(?: about)?|study|learn|teach|check|check timeline for|try|install|ask|send|call|finish|remember|note|keep|make|refactor|fix|add|write|calculate)[:,]?\s+/i;

/** Function words that leave a label dangling when a cut lands on them. */
const DANGLING =
  /\s+(?:based on|about|with|for|from|of|to|in|at|on|and|or|that|which|who|the|a|an|as|by|into|over|under)$/i;

const PROPER = /\b([A-Z][A-Za-z0-9]{2,}(?:\s[A-Z][A-Za-z0-9]{2,})*)\b/g;

const PHRASE =
  /\b(?:about|on|for|with|of|explain(?:ed|ing)?|discuss(?:ed|ing)?|understand(?:ing)?)\s+((?:[a-z][a-z0-9+#./-]*\s?){1,3})/gi;

// No trailing \b: a word boundary never exists after a Cyrillic letter, so
// "1500 сум" went unread until this used a lookahead instead.
const AMOUNT = /\b\d[\d.,]*\s*(?:сум|руб|₽|\$|usd|eur|so'm|sum)(?![A-Za-zА-Яа-яЁё])/gi;

const ISO_DATE = /\b20\d\d-\d\d-\d\d\b/g;

const WORD_DATE =
  /\b(?:today|tomorrow|tonight|next week|next month|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*)\b/gi;

const QUOTE = /["“]([^"”]{3,80})["”]/g;

const STOP_PHRASE = new Set([
  "the", "a", "an", "and", "or", "to", "of", "in", "on", "it", "that", "this",
  "my", "your", "his", "her", "them", "they", "me", "us", "how", "what", "why",
]);

function squash(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

function trimDangling(text) {
  let current = text;
  let previous;
  do {
    previous = current;
    current = current.replace(DANGLING, "").trim();
  } while (current !== previous);
  return current;
}

/**
 * The short label a plate shows. Never cuts inside a word, never leaves a
 * preposition hanging ("Calculate prices for deepseek based on" lost its tail).
 */
export function labelFromNote(text, { max = 52 } = {}) {
  const source = squash(text);
  let label = source.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
  label = label.replace(LEAD_VERB, "").trim();

  // Only a terminator that is followed by a space or the end of the note ends
  // the label: a dot inside "Qwen2.5-VL-3B" is part of a name, not a full stop.
  const terminator = label.search(/[.;:!?](?=\s|$)/);
  if (terminator > 0) label = label.slice(0, terminator).trim();
  label = trimDangling(label);

  if (!label) label = source;
  if (label.length > max) {
    let cutAt = label.lastIndexOf(" ", max);
    // One very long token: keep the token whole rather than start mid-word.
    if (cutAt < Math.floor(max / 2)) cutAt = max;
    label = trimDangling(label.slice(0, cutAt).trim());
  }
  if (!label) label = source.slice(0, max).trim();
  return label;
}

/**
 * Capitalised names, skipping the capital that only starts a sentence.
 *
 * The run pattern can begin on the sentence's first word ("Use Qwen3" is one
 * run), so a run that starts at index 0 drops its first word instead of being
 * thrown away - discarding the whole run lost "Qwen3" entirely.
 */
export function properNouns(text) {
  const source = String(text ?? "");
  const found = [];
  const pattern = new RegExp(PROPER.source, "g");
  let match;
  while ((match = pattern.exec(source))) {
    const at = match.index;
    if (/[.!?]\s$/.test(source.slice(Math.max(0, at - 2), at))) continue;
    const run = match[1].trim();
    if (at === 0) {
      if (!run.includes(" ")) continue;
      const rest = run.split(/\s+/).slice(1).join(" ");
      if (rest) found.push(rest);
      continue;
    }
    if (run) found.push(run);
  }
  return found;
}

/** A short noun phrase after a preposition or a "she explained" verb. */
export function phrases(text) {
  const source = String(text ?? "");
  const found = [];
  const pattern = new RegExp(PHRASE.source, "gi");
  let match;
  while ((match = pattern.exec(source))) {
    const words = match[1]
      .split(/\s+/)
      .filter((word) => word && !STOP_PHRASE.has(word.toLowerCase()));
    const phrase = words.join(" ").trim();
    if (phrase.length >= 2 && phrase.length <= 24) found.push(phrase);
  }
  return found;
}

export function amounts(text) {
  return [...String(text ?? "").matchAll(AMOUNT)].map((m) => squash(m[0]));
}

export function dates(text) {
  const source = String(text ?? "");
  return [
    ...[...source.matchAll(ISO_DATE)].map((m) => m[0]),
    ...[...source.matchAll(WORD_DATE)].map((m) => squash(m[0])),
  ];
}

export function quotes(text) {
  return [...String(text ?? "").matchAll(QUOTE)].map((m) => squash(m[1]));
}

/**
 * Every entity a rule can name, deduped case-insensitively and keeping the
 * first rule that found it. Order is stable so a plate never reshuffles.
 */
export function ruleEntities(text) {
  const seen = new Set();
  const out = [];
  const add = (surface, rule) => {
    const clean = squash(surface);
    if (!clean) return;
    const key = clean.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ surface: clean, rule });
  };

  for (const name of properNouns(text)) add(name, "proper");
  for (const phrase of phrases(text)) add(phrase, "phrase");
  for (const amount of amounts(text)) add(amount, "amount");
  for (const date of dates(text)) add(date, "date");
  for (const quote of quotes(text)) add(quote, "quote");
  return out;
}

export function ruleFacts(text) {
  return { amounts: amounts(text), dates: dates(text), quotes: quotes(text) };
}

export function hashText(text) {
  return createHash("sha1").update(String(text ?? "")).digest("hex");
}

/** The batched extraction prompt. `/no_think` is not decoration: without it
 *  the 8B spends the whole output budget on reasoning and returns nothing. */
export function extractionPrompt(notes) {
  const lines = notes
    .map((note, index) => `${index + 1}. ${squash(note)}`)
    .join("\n");
  return [
    "Extract the entities each note is about. Reply with one line per note, no preamble:",
    "1|entity;entity",
    "Entities are concrete nouns: tools, people, topics, projects, documents.",
    "Never repeat the note text, never explain, at most 3 per note.",
    "",
    lines,
    "",
    "/no_think",
  ].join("\n");
}

/**
 * Read a batched reply. Returns null unless every requested note has its own
 * index, which is what catches the real failures: a model that collapses all
 * notes onto one line, drops one, or answers "N|..." instead of numbering.
 */
export function parseBatchReply(text, expectedCount) {
  const count = Number(expectedCount);
  if (!Number.isInteger(count) || count < 1) return null;
  const rows = new Map();
  for (const line of String(text ?? "").split("\n")) {
    const match = line.trim().match(/^(\d+)\s*\|\s*(.*)$/);
    if (!match) continue;
    const index = Number(match[1]);
    if (!Number.isInteger(index) || index < 1) continue;
    const names = match[2]
      .split(/[;,]/)
      .map((name) => squash(name))
      .filter(Boolean);
    if (rows.has(index)) return null;
    rows.set(index, names);
  }
  if (rows.size !== count) return null;
  const out = [];
  for (let index = 1; index <= count; index++) {
    const names = rows.get(index);
    if (!names) return null;
    out.push(names);
  }
  return out;
}

/** Merge rule names and model names, never duplicating a surface. */
export function mergeCandidates(rules, modelNames = []) {
  const seen = new Set();
  const out = [];
  const push = (surface, why, confidence) => {
    const clean = squash(surface);
    if (!clean) return;
    const key = clean.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ surface: clean, why, confidence });
  };
  for (const rule of rules) push(rule.surface, `rule:${rule.rule}`, CONFIDENCE.RULE);
  for (const name of modelNames) push(name, "model", CONFIDENCE.MODEL);
  return out;
}

/**
 * One note to entities. Rules first; the model is asked only when the rules
 * came up short, and only through the injected `chat`.
 */
export async function extractEntities({ text, chat, cache, minRuleEntities = 1 } = {}) {
  const hash = hashText(text);
  if (cache && typeof cache.has === "function" && cache.has(hash)) {
    return { entities: cache.get(hash), from: "cache", hash };
  }

  const rules = ruleEntities(text);
  const ruly = mergeCandidates(rules);
  if (!chat || ruly.length >= minRuleEntities) {
    if (cache && typeof cache.set === "function") cache.set(hash, ruly);
    return { entities: ruly, from: "rules", hash };
  }

  let names = [];
  let from = "rules";
  try {
    const reply = await chat(extractionPrompt([text]));
    const parsed = parseBatchReply(reply, 1);
    if (parsed) {
      names = parsed[0];
      from = names.length ? "model" : "rules";
    }
  } catch {
    // A model failure is not an error state: the rules result already stands.
  }

  const entities = mergeCandidates(rules, names);
  if (cache && typeof cache.set === "function") cache.set(hash, entities);
  return { entities, from, hash };
}

/**
 * Many notes to entities in batches of 8. A batch reply that fails validation
 * falls back to one call per note rather than dropping the whole batch.
 */
export async function extractBatch({ texts = [], chat, cache, batchSize = 8, minRuleEntities = 1 } = {}) {
  const size = Math.max(1, Number(batchSize) || 8);
  const out = [];
  for (let start = 0; start < texts.length; start += size) {
    const slice = texts.slice(start, start + size);
    let parsed = null;
    if (chat) {
      try {
        parsed = parseBatchReply(await chat(extractionPrompt(slice)), slice.length);
      } catch {
        parsed = null;
      }
    }
    for (let index = 0; index < slice.length; index++) {
      if (!parsed) {
        out.push(await extractEntities({ text: slice[index], chat, cache, minRuleEntities }));
        continue;
      }
      const rules = ruleEntities(slice[index]);
      const entities = mergeCandidates(rules, parsed[index]);
      const hash = hashText(slice[index]);
      if (cache && typeof cache.set === "function") cache.set(hash, entities);
      out.push({ entities, from: "batch", hash });
    }
  }
  return out;
}
