/**
 * Notes store on the Agent drive: memory/notes.jsonl plus a readable mirror at
 * memory/notes.md. Writes are whole-file and atomic (temp file, then rename),
 * so a crash cannot leave half a note behind.
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  cleanNoteText,
  isDuplicate,
  isNoteKind,
  rankNotes,
  renderNotesMarkdown,
} from "../../packages/alive/src/notes.ts";

export const NOTE_MIN = 4;

export function notesDir(root) {
  return path.join(root, "memory");
}

export function notesPath(root) {
  return path.join(notesDir(root), "notes.jsonl");
}

export function notesMarkdownPath(root) {
  return path.join(notesDir(root), "notes.md");
}

function normalizeNote(raw) {
  return {
    id: String(raw.id),
    text: cleanNoteText(raw.text),
    kind: isNoteKind(raw.kind) ? raw.kind : "fact",
    sourceChatId: String(raw.sourceChatId || ""),
    created: Number(raw.created) || Date.now(),
    updated: Number(raw.updated) || Number(raw.created) || Date.now(),
  };
}

export function loadNotes(root) {
  const file = notesPath(root);
  if (!fs.existsSync(file)) return [];
  const notes = [];
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      if (!row || typeof row.text !== "string" || !row.id) continue;
      notes.push(normalizeNote(row));
    } catch {
      /* skip a torn line */
    }
  }
  return notes;
}

/** Regenerate memory/notes.md; other tools read it instead of the JSONL. */
export function exportNotes(root, now = Date.now()) {
  const dir = notesDir(root);
  fs.mkdirSync(dir, { recursive: true });
  const markdown = renderNotesMarkdown(loadNotes(root), now);
  fs.writeFileSync(notesMarkdownPath(root), markdown);
  return markdown;
}

export function saveNotes(root, notes) {
  const dir = notesDir(root);
  fs.mkdirSync(dir, { recursive: true });
  const body = notes.map((note) => JSON.stringify(note)).join("\n") + (notes.length ? "\n" : "");
  const temp = `${notesPath(root)}.tmp`;
  fs.writeFileSync(temp, body);
  fs.renameSync(temp, notesPath(root));
  exportNotes(root);
  return notes;
}

/** Add one note unless the same idea is already stored. */
export function addNote(root, entry, now = Date.now()) {
  const text = cleanNoteText(entry?.text);
  if (text.length < NOTE_MIN) return { note: null, duplicate: false };
  const kind = isNoteKind(entry?.kind) ? entry.kind : "fact";
  const notes = loadNotes(root);
  const already = notes.find((note) => isDuplicate(note.text, text));
  if (already) return { note: already, duplicate: true };
  const note = {
    id: randomUUID(),
    text,
    kind,
    sourceChatId: String(entry?.sourceChatId || ""),
    created: now,
    updated: now,
  };
  saveNotes(root, [...notes, note]);
  return { note, duplicate: false };
}

export function updateNote(root, id, patch, now = Date.now()) {
  const notes = loadNotes(root);
  const index = notes.findIndex((note) => note.id === id);
  if (index < 0) return null;
  const text = patch?.text === undefined ? notes[index].text : cleanNoteText(patch.text);
  if (text.length < NOTE_MIN) throw new Error("note text is too short");
  const kind = patch?.kind === undefined ? notes[index].kind : isNoteKind(patch.kind) ? patch.kind : notes[index].kind;
  const next = [...notes];
  next[index] = { ...notes[index], text, kind, updated: now };
  saveNotes(root, next);
  return next[index];
}

export function deleteNote(root, id) {
  const notes = loadNotes(root);
  const next = notes.filter((note) => note.id !== id);
  if (next.length === notes.length) return false;
  saveNotes(root, next);
  return true;
}

/** Top matches for a question; empty query returns the newest notes. */
export function searchNotes(root, query, limit = 5) {
  const notes = loadNotes(root);
  const text = String(query || "").trim();
  if (!text) return [...notes].sort((a, b) => b.updated - a.updated).slice(0, limit);
  return rankNotes(notes, text, limit);
}
