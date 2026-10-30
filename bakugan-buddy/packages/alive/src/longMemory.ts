/**
 * Small local memory. A handful of lasting facts, not a transcript.
 * The system prompt stays untouched so the Mac prompt cache can reuse it.
 * Facts are ranked into the user message.
 */

export const MEMORY_CAP = 40;
export const MEMORY_FACT_MAX = 120;
export const MEMORY_RECALL = 4;

export type FactKind = "user" | "event";

export type MemoryFact = {
  text: string;
  kind: FactKind;
  /** Optional unit vector. Used when sqlite-vec (or a caller) supplies one. */
  vec?: number[];
};

const EXTRACT_SHAPE = '{"facts":[{"text":"short lasting fact","kind":"user|event"}]}';

/** Separate from Preyas's system prompt so slot 0's cache prefix stays stable. */
export const FACT_EXTRACT_PROMPT = [
  "You extract lasting memory for Preyas, a Bakugan who lives with his partner.",
  "Keep at most 3 facts. Each fact is one short sentence about the partner or a real event.",
  "Skip jokes, moods, and anything that will not matter tomorrow.",
  "Reply with one JSON object and nothing else.",
  EXTRACT_SHAPE,
].join("\n");

function cleanText(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, MEMORY_FACT_MAX);
}

export function parseExtractedFacts(raw: string): MemoryFact[] {
  let text = String(raw ?? "");
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, "");
  text = text.replace(/```(?:json)?/gi, "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return [];
  let data: unknown;
  try {
    data = JSON.parse(text.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!data || typeof data !== "object") return [];
  const list = (data as { facts?: unknown }).facts;
  if (!Array.isArray(list)) return [];
  const out: MemoryFact[] = [];
  for (let i = 0; i < list.length && out.length < 3; i++) {
    const item = list[i];
    if (!item || typeof item !== "object") continue;
    const rec = item as { text?: unknown; kind?: unknown };
    if (typeof rec.text !== "string") continue;
    const fact = cleanText(rec.text);
    if (fact.length < 3) continue;
    const kind: FactKind = rec.kind === "event" ? "event" : "user";
    out.push({ text: fact, kind });
  }
  return out;
}

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2);
}

export function cosine(a: number[], b: number[]): number {
  const n = a.length < b.length ? a.length : b.length;
  if (n === 0) return 0;
  let dot = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    aa += x * x;
    bb += y * y;
  }
  if (aa === 0 || bb === 0) return 0;
  return dot / Math.sqrt(aa * bb);
}

export function scoreFact(fact: MemoryFact, query: string, queryVec?: number[]): number {
  if (queryVec && fact.vec && queryVec.length > 0 && fact.vec.length > 0) {
    return cosine(queryVec, fact.vec);
  }
  const q = new Set(tokens(query));
  if (q.size === 0) return 0;
  const words = tokens(fact.text);
  let hit = 0;
  for (let i = 0; i < words.length; i++) if (q.has(words[i]!)) hit += 1;
  return hit / q.size;
}

/** Highest score first. Ties keep the earlier fact. */
export function rankFacts(facts: readonly MemoryFact[], query: string, limit = MEMORY_RECALL, queryVec?: number[]): MemoryFact[] {
  const scored = facts.map((fact, index) => ({ fact, index, score: scoreFact(fact, query, queryVec) }));
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  const take = limit < scored.length ? limit : scored.length;
  const out: MemoryFact[] = [];
  for (let i = 0; i < take; i++) {
    if (scored[i]!.score <= 0 && query.trim()) continue;
    out.push(scored[i]!.fact);
  }
  return out;
}

/** Dedupe by text, append, then drop the oldest past the cap. */
export function mergeFacts(existing: readonly MemoryFact[], incoming: readonly MemoryFact[], cap = MEMORY_CAP): MemoryFact[] {
  const seen = new Set<string>();
  const out: MemoryFact[] = [];
  const all = [...existing, ...incoming];
  for (let i = 0; i < all.length; i++) {
    const fact = all[i]!;
    const key = fact.text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ text: fact.text, kind: fact.kind, vec: fact.vec });
  }
  if (out.length <= cap) return out;
  return out.slice(out.length - cap);
}
