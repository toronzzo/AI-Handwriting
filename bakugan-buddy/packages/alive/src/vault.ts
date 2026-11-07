/**
 * Obsidian vault for Preyas: Markdown files generated from the app's own data.
 *
 * The JSON on the drive stays the source of truth. The vault is a readable
 * mirror Preyas writes, plus anything the user writes by hand, which is read
 * back in. Pure functions here build the text; vault.mjs touches the disk.
 */

export type VaultKind = "note" | "daily" | "document" | "deck" | "reminders" | "home" | "user";

export type VaultFile = {
  /** Path under the vault, e.g. "Notes/Deadline dentist.md". */
  path: string;
  content: string;
};

/** Filenames Obsidian accepts and every OS can store. */
export function safeFileName(raw: string, fallback = "Untitled"): string {
  const cleaned = String(raw ?? "")
    .replace(/[\\/:*?"<>|#^[\]]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[.\-]+|[.\-]+$/g, "")
    .slice(0, 80)
    .trim();
  return cleaned || fallback;
}

/** A stable, short hash so we can tell our own output from the user's edits. */
export function contentHash(text: string): string {
  let hash = 2166136261;
  const value = String(text ?? "");
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function yamlValue(value: string): string {
  const text = String(value ?? "");
  if (/^[A-Za-z0-9 _.:\-/]+$/.test(text) && !/^[\d.]+$/.test(text)) return text;
  return `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function frontmatter(fields: Record<string, string | number | string[] | undefined>): string {
  const lines = ["---"];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === "") continue;
    if (Array.isArray(value)) {
      lines.push(`${key}: [${value.map((item) => yamlValue(item)).join(", ")}]`);
    } else if (typeof value === "number") {
      lines.push(`${key}: ${value}`);
    } else {
      lines.push(`${key}: ${yamlValue(String(value))}`);
    }
  }
  lines.push("---", "");
  return lines.join("\n");
}

export function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Words worth linking on: lowercase, no stopwords, length > 3. */
const STOP = new Set([
  "the", "and", "for", "with", "that", "this", "from", "have", "been", "will", "your",
  "about", "into", "then", "than", "them", "they", "their", "there", "what", "when",
  "where", "which", "while", "would", "could", "should", "some", "more", "most", "also",
  "just", "like", "make", "made", "need", "needs", "been", "were", "was", "are", "not",
]);

export function keywords(text: string, limit = 4): string[] {
  const words = String(text ?? "")
    .toLowerCase()
    .split(/[^a-z0-9\u0400-\u04ff]+/)
    .filter((word) => word.length > 3 && !STOP.has(word));
  const counts = new Map<string, number>();
  for (const word of words) counts.set(word, (counts.get(word) || 0) + 1);
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([word]) => word);
}

export function wikilink(name: string): string {
  return `[[${name}]]`;
}

export type SourceNote = {
  id: string;
  text: string;
  kind: "deadline" | "decision" | "idea" | "fact" | "todo";
  created: number;
  updated?: number;
};

export type SourceReminder = {
  id: string;
  text: string;
  dueAt: string;
  repeat?: string;
  status: string;
};

export type SourceDeck = {
  id: string;
  title: string;
  language?: string;
  createdAt: number;
  cards: { question: string; answer: string }[];
};

export type SourceDocument = {
  name: string;
  summary: string;
  at: number;
};

export type SourceBriefing = {
  day: string;
  text: string;
};

export type VaultInput = {
  notes: SourceNote[];
  reminders: SourceReminder[];
  decks: SourceDeck[];
  documents: SourceDocument[];
  briefings: SourceBriefing[];
  /** Chat lines per day, already formatted "who: text". */
  highlights: Record<string, string[]>;
  now?: number;
};

/** The note file for one note, idea or decision. */
export function noteFile(note: SourceNote, related: string[] = []): VaultFile {
  const title = safeFileName(titleOf(note));
  const body = [
    frontmatter({
      type: note.kind,
      created: isoDay(note.created),
      updated: note.updated ? isoDay(note.updated) : undefined,
      tags: [note.kind, ...keywords(note.text, 3)],
      source: "preyas",
    }),
    `# ${titleOf(note)}`,
    "",
    note.text,
    "",
  ];
  if (related.length) {
    body.push("## Related", "", ...related.map((name) => `- ${wikilink(name)}`), "");
  }
  return { path: `Notes/${title}.md`, content: body.join("\n") };
}

export function titleOf(note: SourceNote, max = 60): string {
  const text = String(note.text ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "Untitled note";
  const cut = text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
  return cut.charAt(0).toUpperCase() + cut.slice(1);
}

/** Reminders as a checklist, grouped by whether they are still ahead. */
export function remindersFile(reminders: SourceReminder[], now = Date.now()): VaultFile {
  const open = reminders.filter((row) => row.status !== "done");
  const done = reminders.filter((row) => row.status === "done");
  const line = (row: SourceReminder) => {
    const due = isoDay(new Date(row.dueAt).getTime());
    const late = row.status !== "done" && new Date(row.dueAt).getTime() < now ? " ⚠️" : "";
    return `- [${row.status === "done" ? "x" : " "}] ${row.text} — ${due}${late}${row.repeat && row.repeat !== "none" ? ` (${row.repeat})` : ""}`;
  };
  const body = [
    frontmatter({ type: "reminders", created: isoDay(now), updated: isoDay(now), tags: ["reminders"], source: "preyas" }),
    "# Reminders",
    "",
    "## Upcoming",
    "",
    ...(open.length ? open.map(line) : ["_Nothing scheduled._"]),
    "",
    "## Done",
    "",
    ...(done.length ? done.map(line) : ["_Nothing finished yet._"]),
    "",
  ];
  return { path: "Reminders.md", content: body.join("\n") };
}

/** One card per "Question :: Answer" line, which Obsidian shows as flashcards with community plugins and reads fine as plain text. */
export function deckFile(deck: SourceDeck): VaultFile {
  const title = safeFileName(deck.title, "Deck");
  const body = [
    frontmatter({
      type: "deck",
      created: isoDay(deck.createdAt),
      tags: ["study", "flashcards"],
      language: deck.language || "en",
      cards: deck.cards.length,
      source: "preyas",
    }),
    `# ${title}`,
    "",
    `${deck.cards.length} cards.`,
    "",
    ...deck.cards.map((card) => `${card.question.replace(/\s+/g, " ").trim()} :: ${card.answer.replace(/\s+/g, " ").trim()}`),
    "",
  ];
  return { path: `Study/${title}.md`, content: body.join("\n") };
}

export function documentFile(document: SourceDocument, inboxPath: string): VaultFile {
  const title = safeFileName(document.name, "Document");
  const body = [
    frontmatter({
      type: "document",
      created: isoDay(document.at),
      tags: ["document"],
      source: "preyas",
      file: `file://${inboxPath}/${document.name}`,
    }),
    `# ${document.name}`,
    "",
    document.summary.trim(),
    "",
    "## Source",
    "",
    `- [${document.name}](${inboxPath}/${document.name})`,
    "",
  ];
  return { path: `Documents/${title}.md`, content: body.join("\n") };
}

export function dailyFile(day: string, briefing: string, highlights: string[]): VaultFile {
  const body = [
    frontmatter({ type: "daily", created: day, tags: ["daily", "briefing"], source: "preyas" }),
    `# ${day}`,
    "",
    "## Briefing",
    "",
    briefing.trim(),
    "",
  ];
  if (highlights.length) {
    body.push("## Chat highlights", "", ...highlights.slice(0, 12).map((line) => `- ${line}`), "");
  }
  return { path: `Daily/${day}.md`, content: body.join("\n") };
}

/** The home page: every section as links, so the graph has a centre. */
export function homeFile(input: VaultInput, files: VaultFile[]): VaultFile {
  const links = (prefix: string) =>
    files
      .filter((file) => file.path.startsWith(`${prefix}/`))
      .map((file) => `- ${wikilink(file.path.slice(prefix.length + 1).replace(/\.md$/, ""))}`);
  const noteLinks = links("Notes");
  const dailyLinks = links("Daily").slice(-14).reverse();
  const docLinks = links("Documents");
  const deckLinks = links("Study");
  const body = [
    frontmatter({ type: "home", created: isoDay(input.now ?? Date.now()), tags: ["preyas", "home"], source: "preyas" }),
    "# Preyas",
    "",
    "Your companion's readable memory. Edit anything here; Preyas reads it back.",
    "",
    "## Reminders",
    "",
    `- ${wikilink("Reminders")}`,
    "",
    "## Notes, ideas and decisions",
    "",
    ...(noteLinks.length ? noteLinks : ["_Nothing yet._"]),
    "",
    "## Daily",
    "",
    ...(dailyLinks.length ? dailyLinks : ["_Nothing yet._"]),
    "",
    "## Documents",
    "",
    ...(docLinks.length ? docLinks : ["_Nothing yet._"]),
    "",
    "## Study",
    "",
    ...(deckLinks.length ? deckLinks : ["_Nothing yet._"]),
    "",
  ];
  return { path: "Preyas.md", content: body.join("\n") };
}

/**
 * Build every vault file. Notes with a shared keyword are linked to each other,
 * which is what makes Obsidian's graph show clusters.
 */
export function buildVault(input: VaultInput): VaultFile[] {
  const now = input.now ?? Date.now();
  const files: VaultFile[] = [];

  const titles = input.notes.map((note) => safeFileName(titleOf(note)));
  const keywordSets = input.notes.map((note) => new Set([note.kind, ...keywords(note.text, 3)]));
  input.notes.forEach((note, index) => {
    const related: string[] = [];
    for (let other = 0; other < input.notes.length; other += 1) {
      if (other === index) continue;
      const shared = [...keywordSets[index]].filter((word) => keywordSets[other].has(word));
      if (shared.length >= 2) related.push(titles[other]);
      if (related.length >= 5) break;
    }
    files.push(noteFile(note, [...new Set(related)]));
  });

  for (const deck of input.decks) files.push(deckFile(deck));
  for (const document of input.documents) files.push(documentFile(document, "/Volumes/Agent/BakuganBuddy/documents"));
  for (const briefing of input.briefings) {
    files.push(dailyFile(briefing.day, briefing.text, input.highlights[briefing.day] || []));
  }
  files.push(remindersFile(input.reminders, now));
  files.push(homeFile({ ...input, now }, files));
  return files;
}

/* ------------------------------------------------------------------ */
/* Reading the user's own files                                        */
/* ------------------------------------------------------------------ */

export type ParsedNote = {
  title: string;
  body: string;
  tasks: string[];
  tags: string[];
  generated: boolean;
  hash?: string;
};

/** Read frontmatter enough to know whether Preyas wrote the file. */
export function parseMarkdown(raw: string, fallbackTitle = "Untitled"): ParsedNote {
  const text = String(raw ?? "");
  const match = text.match(/^---\n([\s\S]*?)\n---\n?/);
  const front = match ? match[1] : "";
  const body = (match ? text.slice(match[0].length) : text).trim();
  const field = (key: string) => {
    const line = front.match(new RegExp(`^${key}:\\s*(.*)$`, "m"));
    return line ? line[1].trim().replace(/^["']|["']$/g, "") : "";
  };
  const tagLine = front.match(/^tags:\s*\[(.*)\]$/m);
  const tags = tagLine
    ? tagLine[1].split(",").map((tag) => tag.trim().replace(/^["']|["']$/g, "")).filter(Boolean)
    : [];
  const tasks = [...text.matchAll(/^\s*[-*]\s*\[ \]\s+(.+)$/gm)].map((row) => row[1].trim()).filter(Boolean);
  // Checkbox lines are tasks, not prose: keep them out of the note body.
  const bodyText = body.replace(/^\s*[-*]\s*\[[ xX]\]\s+.+$/gm, "").replace(/\n{3,}/g, "\n\n").trim();
  const heading = body.match(/^#\s+(.+)$/m);
  return {
    title: (heading ? heading[1].trim() : fallbackTitle).slice(0, 120),
    body: bodyText.replace(/^#\s+.+$/m, "").trim(),
    tasks,
    tags,
    generated: field("source") === "preyas" || Boolean(field("hash")),
    hash: field("hash") || undefined,
  };
}

/**
 * Stamp a generated file with the hash of its body (everything after the
 * frontmatter). The hash therefore matches on read, and any user edit changes
 * it — which is how Preyas knows a file is not its own any more.
 */
export function withHash(file: VaultFile): VaultFile {
  const match = file.content.match(/^---\n([\s\S]*?)\n---\n?/);
  const body = match ? file.content.slice(match[0].length) : file.content;
  const hash = contentHash(body);
  if (match) {
    return { path: file.path, content: file.content.replace(/^---\n/, `---\nhash: ${hash}\n`) };
  }
  return { path: file.path, content: `---\nhash: ${hash}\n---\n\n${file.content}` };
}

/** True when the file still matches the hash Preyas wrote. */
export function hashMatches(parsed: ParsedNote, raw: string): boolean {
  if (!parsed.hash) return false;
  const match = String(raw).match(/^---\n([\s\S]*?)\n---\n?/);
  const body = match ? String(raw).slice(match[0].length) : String(raw);
  return contentHash(body) === parsed.hash;
}
