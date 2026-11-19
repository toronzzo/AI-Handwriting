/**
 * Gold examples: the user's best Preyas answers, ranked into the prompt as
 * style guides. Pure TypeScript, no enums, no network — the client picks
 * them (the :4000 gateway route bypasses the proxy) through the B1 seam.
 */
import { scoreNotes } from "./notes.ts";

export type Example = {
  id: string;
  q: string;
  a: string;
  lang: "ru" | "en";
};

export const EXAMPLE_LIMIT = 2;
export const MIN_QUERY_CHARS = 8;
/** Tuned on the fixture questions: unrelated questions score 0 or very low. */
export const EXAMPLE_MIN_SCORE = 0.5;
export const PAIR_MAX_CHARS = 480;
export const BLOCK_MAX_CHARS = 1000;
/** First 200 chars of the answer join the index, at about 1/3 of the question's weight. */
const ANSWER_INDEX_CHARS = 200;

const COMMAND_LIKE =
  /^(\/|coach\b|коуч\b|search my vault|what did i write|save this|remember\b|forget\b|what did i say about|remind\b|stop coach|where am i|где я|what have i learned|save lesson|запомни урок|👍)/iu;

export function exampleIndexText(example: Example): string {
  const q = String(example.q ?? "");
  const a = String(example.a ?? "").slice(0, ANSWER_INDEX_CHARS);
  // Question weight 1, answer weight ~0.3: repeat the question three times.
  return `${q} ${q} ${q} ${a}`;
}

/** Short text, coach/vault/note commands and "/" commands never pick examples. */
export function isCommandLike(text: string): boolean {
  return COMMAND_LIKE.test(String(text ?? ""));
}

/**
 * pickExamples(items, userText, {limit, minScore}) -> at most `limit` examples
 * ranked with scoreNotes (BM25, Cyrillic-safe). Nothing when the user text is
 * shorter than 8 characters, looks like a command, or the best score is below
 * the threshold.
 */
export function pickExamples(
  items: readonly Example[],
  userText: string,
  { limit = EXAMPLE_LIMIT, minScore = EXAMPLE_MIN_SCORE }: { limit?: number; minScore?: number } = {},
): Example[] {
  const text = String(userText ?? "").trim();
  if (text.length < MIN_QUERY_CHARS || isCommandLike(text)) return [];
  if (!items.length) return [];
  const rows = scoreNotes(
    items.map((item) => ({ text: exampleIndexText(item), item })),
    text,
    limit,
  );
  if (!rows.length || rows[0].score < minScore) return [];
  return rows.map((row) => row.item.item);
}

/** Trims to a word boundary: never cuts inside a word. */
function trimAtWord(text: string, max: number): string {
  const value = String(text ?? "").replace(/\s+/g, " ").trim();
  if (value.length <= max) return value;
  const cut = value.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > max / 2 ? cut.slice(0, lastSpace) : cut).trimEnd();
}

/**
 * formatExamples(picked) -> the prompt block, or "" when nothing was picked.
 * Each Q/A pair is trimmed to 480 characters, the whole block to 1000.
 */
export function formatExamples(picked: readonly Example[]): string {
  const rows = picked.filter((example) => example && example.q && example.a);
  if (!rows.length) return "";
  const parts = ["Examples of good answers (copy the style, not the facts):"];
  for (const example of rows) {
    const pair = `Q: ${trimAtWord(example.q, 220)}\nA: ${trimAtWord(example.a, 220)}`;
    parts.push(trimAtWord(pair, PAIR_MAX_CHARS));
  }
  let block = parts.join("\n\n");
  if (block.length > BLOCK_MAX_CHARS) {
    block = trimAtWord(block, BLOCK_MAX_CHARS);
  }
  return block;
}
