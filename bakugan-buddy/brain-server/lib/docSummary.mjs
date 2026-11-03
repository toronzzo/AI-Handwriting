/**
 * Summarise a document with the local model, one context-sized chunk at a
 * time. Nothing here reaches a paid model: the caller decides that.
 */
import { chunkText, pickRelevantChunks } from "./documents.mjs";

const CHUNK_SYSTEM = [
  "You summarise one part of a partner's document for Preyas, a careful assistant.",
  "Reply with three to five short bullet points of the facts that matter: names, numbers, dates, decisions, and to-dos.",
  "Never guess. If a detail is missing or uncertain in this part, write [UNVERIFIED] where that detail would go.",
  "No preamble, no headings, no markdown fences.",
].join("\n");

const MERGE_SYSTEM = [
  "You merge partial summaries of one document into a single short summary for its owner.",
  "Reply with at most eight short bullet points, most important first, then one closing line starting with 'In short:'.",
  "Keep every [UNVERIFIED] marker you are given. If a detail is missing or uncertain, write [UNVERIFIED] instead of guessing.",
  "No preamble and no repetition between bullets.",
].join("\n");

const ANSWER_SYSTEM = [
  "You are Preyas, a careful assistant. Answer the question using only the document excerpts you are given.",
  "Lead with the answer in one or two sentences and quote a short phrase when it helps.",
  "If a detail is missing or uncertain, write [UNVERIFIED] rather than guessing.",
  "If the excerpts do not answer it, say plainly that the document does not say.",
].join("\n");

export function stripFences(text) {
  return String(text ?? "")
    .replace(/```[a-z]*\n?/gi, "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .trim();
}

async function askLocal(llamaUrl, system, user, options = {}) {
  const { fetchImpl = fetch, timeoutMs = 90_000, maxTokens = 420 } = options;
  const body = {
    model: "preyas",
    stream: false,
    temperature: 0.2,
    max_tokens: maxTokens,
    chat_template_kwargs: { enable_thinking: false },
    messages: [
      { role: "system", content: system },
      { role: "user", content: `${user}\n\n/no_think` },
    ],
  };
  const res = await fetchImpl(`${llamaUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`the local model answered ${res.status}`);
  const json = await res.json();
  return stripFences(json?.choices?.[0]?.message?.content || "");
}

/**
 * Summarise the whole document. Calls `onProgress(done, total)` before each
 * chunk so the UI can say "Reading page chunk 2 of 5".
 */
export async function summarizeDocument(text, options = {}) {
  const { llamaUrl, onProgress, chunkSize, fetchImpl = fetch } = options;
  const chunks = chunkText(text, chunkSize);
  if (!chunks.length) throw new Error("no readable text in this document");
  if (chunks.length === 1) {
    onProgress?.(1, 1);
    return askLocal(llamaUrl, MERGE_SYSTEM, `Document:\n${chunks[0]}`, { fetchImpl, maxTokens: 500 });
  }
  const parts = [];
  for (let index = 0; index < chunks.length; index += 1) {
    onProgress?.(index + 1, chunks.length);
    parts.push(await askLocal(llamaUrl, CHUNK_SYSTEM, `Part ${index + 1} of ${chunks.length}:\n${chunks[index]}`, { fetchImpl }));
  }
  onProgress?.(chunks.length, chunks.length);
  return askLocal(llamaUrl, MERGE_SYSTEM, `Partial summaries:\n\n${parts.join("\n\n")}`, { fetchImpl, maxTokens: 500 });
}

/** Answer a question from the few chunks that actually mention it. */
export async function answerFromDocument(text, question, options = {}) {
  const { llamaUrl, chunkSize, fetchImpl = fetch } = options;
  const chunks = chunkText(text, chunkSize);
  const picked = pickRelevantChunks(chunks, question, 3);
  if (!picked.length) throw new Error("no readable text in this document");
  const excerpts = picked.map((chunk, index) => `Excerpt ${index + 1}:\n${chunk}`).join("\n\n");
  return askLocal(llamaUrl, ANSWER_SYSTEM, `Question: ${question}\n\n${excerpts}`, { fetchImpl, maxTokens: 320 });
}

/** Key points worth remembering, offered to the notes memory after a summary. */
export function keyPointsFrom(summary) {
  const lines = String(summary ?? "")
    .split("\n")
    .map((line) => line.replace(/^[\s*\-•\d.]+/, "").trim())
    .filter((line) => line.length > 8 && !/^in short\b/i.test(line));
  return lines.slice(0, 6).map((line) => ({
    text: line.replace(/^in short:\s*/i, "").trim().slice(0, 200),
    kind: guessKind(line),
  }));
}

function guessKind(line) {
  const text = String(line).toLowerCase();
  if (/\b(deadline|due|by |before |until |no later than|march|april|may|june|july|august|september|october|november|december|january|february|\d{1,2}\/\d{1,2})\b/.test(text)) {
    return "deadline";
  }
  if (/\b(decided|decision|agreed|chose|approved|we will|plan is)\b/.test(text)) return "decision";
  if (/\b(todo|to-do|action|must|need to|follow up|next step|assign)\b/.test(text)) return "todo";
  if (/\b(idea|maybe we|what if|concept|proposal)\b/.test(text)) return "idea";
  return "fact";
}
