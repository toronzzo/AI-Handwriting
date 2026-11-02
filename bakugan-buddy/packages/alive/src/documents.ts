/**
 * Which document a message means, and whether it is asking about documents at
 * all. Pure so the app and the brain-server agree.
 */

export type DocumentRef = { kind: "summary" | "read" | "question"; name: string; question?: string };

export type DocumentHit = { name: string; score: number };

const DOC_WORD = "(?:document|doc|file|pdf|docx|paper|report|notes|transcript)";

/**
 * "summarize report.pdf", "read notes.md", "/doc plan", "what does budget.pdf
 * say about rent". Returns null for ordinary chat.
 */
export function parseDocumentRequest(raw: string): DocumentRef | null {
  const text = String(raw ?? "").trim();
  if (!text) return null;

  const slash = text.match(/^\/(?:doc|document)\s+(.+)$/i);
  if (slash) {
    const body = (slash[1] || "").trim();
    const question = body.match(/^(.+?)\s+(?:about|on|regarding)\s+(.+)$/i);
    if (question) return { kind: "question", name: question[1].trim(), question: question[2].trim() };
    return { kind: "summary", name: body };
  }

  const question = text.match(
    new RegExp(`what\\s+does\\s+(.+?)\\s+say\\s+about\\s+(.+)$`, "i"),
  );
  if (question) {
    return { kind: "question", name: (question[1] || "").trim(), question: (question[2] || "").trim() };
  }

  const summary = text.match(
    new RegExp(`^(?:please\\s+)?(?:summari[sz]e|sum\\s+up|tldr)\\s+(?:the\\s+)?(?:${DOC_WORD}\\s+)?["']?(.+?)["']?\\s*[?.!]*$`, "i"),
  );
  if (summary) {
    const name = (summary[1] || "").trim();
    if (name && mentionsDocument(text, name)) return { kind: "summary", name };
  }

  const read = text.match(
    new RegExp(`^(?:please\\s+)?(?:read|open|show\\s+me)\\s+(["']?)(.+?)\\1(?:\\s+out\\s+loud)?\\s*[?.!]*$`, "i"),
  );
  if (read) {
    const name = (read[2] || "").trim();
    if (name && mentionsDocument(text, name)) return { kind: "read", name };
  }

  return null;
}

/** A bare "summarize this" has no file name, so it is not a document request. */
function mentionsDocument(fullText: string, name: string): boolean {
  const lowerName = name.toLowerCase();
  if (!lowerName) return false;
  if (/\.(txt|md|markdown|pdf|docx?|rtf)$/.test(lowerName)) return true;
  return new RegExp(`\\b${DOC_WORD}\\b`, "i").test(fullText);
}

function normalize(value: string): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\.(txt|md|markdown|pdf|docx?|rtf)$/, "")
    .replace(/[^a-z0-9\u0400-\u04ff]+/g, " ")
    .trim();
}

/** Rank inbox files against what the user typed. */
export function matchDocuments(query: string, names: readonly string[], limit = 5): DocumentHit[] {
  const needle = normalize(query);
  if (!needle) return [];
  const words = needle.split(" ").filter(Boolean);
  const hits: DocumentHit[] = [];
  for (const name of names) {
    const haystack = normalize(name);
    if (!haystack) continue;
    let score = 0;
    if (haystack === needle) score = 100;
    else if (haystack.includes(needle) || needle.includes(haystack)) score = 70;
    else {
      const shared = words.filter((word) => haystack.includes(word)).length;
      if (shared) score = 20 + shared * 5;
    }
    if (score > 0) hits.push({ name, score });
  }
  hits.sort((left, right) => right.score - left.score || left.name.localeCompare(right.name));
  return hits.slice(0, limit);
}
