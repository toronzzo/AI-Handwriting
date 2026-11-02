/**
 * Preyas notes: durable items he keeps for his partner, and the small language
 * pieces around them. Pure logic only (no filesystem), so both the brain-server
 * and the app can import it.
 */

export const NOTE_KINDS = ["deadline", "decision", "idea", "fact", "todo"] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];

export type Note = {
  id: string;
  text: string;
  kind: NoteKind;
  sourceChatId: string;
  created: number;
  updated: number;
};

export type NoteCommand =
  | { kind: "remember"; text: string }
  | { kind: "forget"; query: string }
  | { kind: "recall"; query: string };

export const NOTE_MAX = 240;
export const NOTE_LIMIT = 5;

const KIND_SET = new Set<string>(NOTE_KINDS);

const KIND_LABEL: Record<NoteKind, string> = {
  deadline: "Deadlines",
  decision: "Decisions",
  idea: "Ideas",
  fact: "Facts",
  todo: "Todos",
};

const STOP = new Set([
  "the", "a", "an", "and", "or", "but", "if", "then", "to", "of", "in", "on",
  "for", "with", "is", "are", "was", "were", "be", "been", "it", "this", "that",
  "i", "you", "we", "they", "my", "your", "me", "do", "did", "does", "what",
  "about", "said", "say", "at", "as", "by", "from", "so", "not", "no", "have",
  "has", "had", "will", "would", "can", "could", "there", "here", "when", "who",
]);

export function isNoteKind(value: unknown): value is NoteKind {
  return typeof value === "string" && KIND_SET.has(value);
}

export function cleanNoteText(text: unknown, max = NOTE_MAX): string {
  return String(text ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

/** "remember …" / "forget …" / "what did I say about …?" — or null. */
export function parseNoteCommand(raw: string): NoteCommand | null {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  const remember = text.match(/^(?:please\s+)?remember(?:\s+that)?[:,]?\s+([\s\S]+)$/i);
  if (remember) {
    const body = cleanNoteText(remember[1]);
    return body ? { kind: "remember", text: body } : null;
  }
  const forget = text.match(/^(?:please\s+)?forget(?:\s+about)?[:,]?\s+([\s\S]+)$/i);
  if (forget) {
    const body = cleanNoteText(forget[1]);
    return body ? { kind: "forget", query: body } : null;
  }
  const recall = text.match(/^what\s+did\s+i\s+say\s+about\s+([\s\S]+?)\s*\?*$/i);
  if (recall) {
    const body = cleanNoteText(recall[1]);
    return body ? { kind: "recall", query: body } : null;
  }
  return null;
}

/** The topic, with any command wrapper removed, for note retrieval. */
export function queryForRetrieval(raw: string): string {
  const command = parseNoteCommand(raw);
  if (!command) return String(raw ?? "").trim();
  return command.kind === "remember" ? command.text : command.query;
}

/** Lowercase words only; used for duplicate checks, not for ranking. */
export function dedupeKey(text: string): string {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** True when two notes say the same thing, not merely when they share a word. */
export function isDuplicate(a: string, b: string): boolean {
  const x = dedupeKey(a);
  const y = dedupeKey(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  if (short.length >= 12 && long.includes(short) && short.length / long.length >= 0.6) return true;
  // A paraphrase reorders words, so compare the significant words as a set:
  // the shorter note must be almost fully covered by the longer one.
  const left = new Set(tokenize(x));
  const right = new Set(tokenize(y));
  if (left.size < 3 || right.size < 3) return false;
  const shared = [...left].filter((word) => right.has(word)).length;
  const coverage = shared / Math.min(left.size, right.size);
  return shared >= 3 && coverage >= 0.8;
}

function tokenize(text: string): string[] {
  return String(text ?? "")
    .toLowerCase()
    .split(/[^a-z0-9\u0400-\u04ff]+/)
    .filter((word) => word.length > 1 && !STOP.has(word));
}

/**
 * BM25 over note text. No embeddings, no network: a handful of notes rank fine
 * and the score is deterministic, which keeps the tests boring.
 */
export function rankNotes<T extends { text: string }>(notes: readonly T[], query: string, limit = NOTE_LIMIT): T[] {
  const terms = [...new Set(tokenize(query))];
  if (!notes.length || !terms.length) return notes.slice(0, limit);
  const docs = notes.map((note) => tokenize(note.text));
  const total = docs.length;
  const average = docs.reduce((sum, doc) => sum + doc.length, 0) / Math.max(1, total);
  const seen = new Map<string, number>();
  for (const term of terms) seen.set(term, docs.filter((doc) => doc.includes(term)).length);
  const k1 = 1.2;
  const b = 0.75;
  const scored = notes
    .map((note, index) => {
      const doc = docs[index]!;
      const length = doc.length || 1;
      let score = 0;
      for (const term of terms) {
        const tf = doc.filter((word) => word === term).length;
        if (!tf) continue;
        const df = seen.get(term) || 0;
        const idf = Math.log(1 + (total - df + 0.5) / (df + 0.5));
        score += idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * length) / average)));
      }
      return { note, score, index };
    })
    .filter((row) => row.score > 0);
  scored.sort((left, right) => right.score - left.score || left.index - right.index);
  return scored.slice(0, limit).map((row) => row.note);
}

/** The `memory/notes.md` mirror that other tools read. Grouped by kind. */
export function renderNotesMarkdown(notes: readonly Note[], now = Date.now()): string {
  const lines = ["# Preyas notes", "", `_Updated ${new Date(now).toISOString().slice(0, 10)}_`, ""];
  if (notes.length === 0) {
    lines.push("_No notes yet._", "");
    return lines.join("\n");
  }
  for (const kind of NOTE_KINDS) {
    const rows = notes.filter((note) => note.kind === kind);
    if (!rows.length) continue;
    lines.push(`## ${KIND_LABEL[kind]}`, "");
    for (const row of [...rows].sort((left, right) => left.created - right.created)) {
      lines.push(`- ${row.text}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

export const NOTE_EXTRACT_PROMPT = [
  "You keep notes for Preyas, a Bakugan who lives with his partner.",
  "Read the chat lines and list only durable, useful items: a deadline, a decision, an idea, a fact about the partner, or a todo.",
  "Skip jokes, moods, small talk, and anything that will not matter tomorrow.",
  "Reply with one JSON array and nothing else. Each item: {\"text\": \"one short sentence\", \"kind\": \"deadline|decision|idea|fact|todo\"}.",
  "If there is nothing worth keeping, reply with [].",
].join("\n");

/** Parse the model's JSON array, tolerating thinking blocks and code fences. */
export function parseExtractedNotes(raw: string): { text: string; kind: NoteKind }[] {
  let text = String(raw ?? "");
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, "");
  text = text.replace(/```(?:json)?/gi, "");
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end <= start) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: { text: string; kind: NoteKind }[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const row = item as { text?: unknown; kind?: unknown };
    const body = cleanNoteText(row.text);
    if (body.length < 4) continue;
    out.push({ text: body, kind: isNoteKind(row.kind) ? row.kind : "fact" });
  }
  return out.slice(0, 5);
}

/** The system line that puts retrieved notes in front of the model. */
export function notesContext(notes: readonly Pick<Note, "kind" | "text">[]): string {
  const rows = notes.map((note) => `- [${note.kind}] ${note.text}`).join("\n");
  return [
    "Notes you saved for your partner. Use them when they answer the question; never invent one.",
    rows,
  ].join("\n");
}
