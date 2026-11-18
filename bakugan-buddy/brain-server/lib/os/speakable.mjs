/**
 * What a coach reply is worth reading aloud. Commands are never spoken: every
 * Command line and anything inside backticks is dropped, URLs and placeholders
 * become short spoken words, and the result is capped at 3 sentences and 420
 * characters (cut at a sentence end).
 */

const SENTENCE_END = /(?<=[.!?])\s+/;
const CYRILLIC = /[а-яё]/gi;
const MAX_SENTENCES = 3;
const MAX_CHARS = 420;

/** { text, lang } — lang is "ru" when more than 30% of the letters are Cyrillic. */
export function speakableStep(rawText) {
  const text = String(rawText ?? "");
  const parts = [];
  let hadCommand = false;
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^Command:/i.test(trimmed)) {
      hadCommand = true;
      continue;
    }
    const cleaned = trimmed
      .replace(/`[^`]*`/g, "the command")
      .replace(/https?:\/\/[^\s<>]*/gi, "the link on screen")
      .replace(/<[a-z0-9-]+>/gi, "the number")
      .trim();
    if (cleaned) parts.push(cleaned);
  }

  let joined = parts.join(" ");
  if (!joined) {
    joined = hadCommand ? "The command is on screen." : "";
  }

  const sentences = joined.split(SENTENCE_END).map((sentence) => sentence.trim()).filter(Boolean);
  let kept = sentences.slice(0, MAX_SENTENCES);
  joined = kept.join(" ");
  while (joined.length > MAX_CHARS && kept.length > 1) {
    kept = kept.slice(0, -1);
    joined = kept.join(" ");
  }
  if (joined.length > MAX_CHARS) joined = joined.slice(0, MAX_CHARS).trim();
  joined = joined.trim();

  const letters = joined.replace(/[^a-zа-яё]/gi, "");
  const cyr = (letters.match(CYRILLIC) || []).length;
  const lang = letters.length > 0 && cyr / letters.length > 0.3 ? "ru" : "en";
  return { text: joined, lang };
}
