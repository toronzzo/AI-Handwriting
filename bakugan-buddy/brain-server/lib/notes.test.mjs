import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  addNote,
  deleteNote,
  exportNotes,
  loadNotes,
  notesMarkdownPath,
  notesPath,
  searchNotes,
  updateNote,
} from "./notes.mjs";

function drive() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "preyas-notes-"));
  return { root, done: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test("a note is stored as one JSON line and mirrored to markdown", () => {
  const { root, done } = drive();
  const saved = addNote(root, { text: "Dentist on Friday at 9", kind: "deadline", sourceChatId: "chat-1" }, 1000);
  assert.equal(saved.duplicate, false);
  assert.equal(saved.note.text, "Dentist on Friday at 9");
  assert.equal(saved.note.kind, "deadline");
  assert.equal(saved.note.sourceChatId, "chat-1");
  const lines = fs.readFileSync(notesPath(root), "utf8").trim().split("\n");
  assert.equal(lines.length, 1);
  assert.equal(JSON.parse(lines[0]).text, "Dentist on Friday at 9");
  const md = fs.readFileSync(notesMarkdownPath(root), "utf8");
  assert.match(md, /## Deadlines/);
  assert.match(md, /- Dentist on Friday at 9/);
  done();
});

test("the same idea is not saved twice", () => {
  const { root, done } = drive();
  const first = addNote(root, { text: "Dentist on Friday at 9", kind: "deadline" });
  const again = addNote(root, { text: "  dentist on friday at 9. ", kind: "todo" });
  assert.equal(again.duplicate, true);
  assert.equal(again.note.id, first.note.id);
  assert.equal(loadNotes(root).length, 1);
  done();
});

test("short or empty notes are refused", () => {
  const { root, done } = drive();
  assert.equal(addNote(root, { text: "ok" }).note, null);
  assert.equal(addNote(root, { text: "   " }).note, null);
  assert.deepEqual(loadNotes(root), []);
  done();
});

test("an unknown kind falls back to fact", () => {
  const { root, done } = drive();
  const saved = addNote(root, { text: "Prefers local models", kind: "banana" });
  assert.equal(saved.note.kind, "fact");
  done();
});

test("updating a note rewrites the store and the markdown", () => {
  const { root, done } = drive();
  const saved = addNote(root, { text: "Call the vet", kind: "todo" }, 1000);
  const updated = updateNote(root, saved.note.id, { text: "Call the vet on Monday", kind: "deadline" }, 2000);
  assert.equal(updated.text, "Call the vet on Monday");
  assert.equal(updated.kind, "deadline");
  assert.equal(updated.updated, 2000);
  const md = fs.readFileSync(notesMarkdownPath(root), "utf8");
  assert.match(md, /## Deadlines/);
  assert.match(md, /Call the vet on Monday/);
  assert.equal(updateNote(root, "missing", { text: "nope" }), null);
  done();
});

test("deleting a note removes it and regenerates the export", () => {
  const { root, done } = drive();
  const saved = addNote(root, { text: "Buy milk", kind: "todo" });
  assert.equal(deleteNote(root, saved.note.id), true);
  assert.equal(deleteNote(root, saved.note.id), false);
  assert.deepEqual(loadNotes(root), []);
  assert.match(fs.readFileSync(notesMarkdownPath(root), "utf8"), /_No notes yet._/);
  done();
});

test("search returns the most relevant notes and an empty query the newest", () => {
  const { root, done } = drive();
  addNote(root, { text: "Dentist appointment on Friday at nine", kind: "deadline" }, 1000);
  addNote(root, { text: "The aquarium filter needs a new sponge", kind: "todo" }, 2000);
  addNote(root, { text: "Buy milk and bread", kind: "todo" }, 3000);
  const ranked = searchNotes(root, "dentist appointment");
  assert.equal(ranked.length, 1);
  assert.match(ranked[0].text, /Dentist appointment/);
  assert.deepEqual(searchNotes(root, "quantum chromodynamics"), []);
  const newest = searchNotes(root, "", 2);
  assert.equal(newest.length, 2);
  assert.equal(newest[0].text, "Buy milk and bread");
  done();
});

test("a torn line is skipped instead of breaking the store", () => {
  const { root, done } = drive();
  addNote(root, { text: "Keep me", kind: "fact" });
  fs.appendFileSync(notesPath(root), "{not json\n");
  const notes = loadNotes(root);
  assert.equal(notes.length, 1);
  assert.equal(notes[0].text, "Keep me");
  done();
});

test("export can be regenerated from the JSONL alone", () => {
  const { root, done } = drive();
  addNote(root, { text: "Ship the panel on Friday", kind: "deadline" });
  fs.rmSync(notesMarkdownPath(root));
  const markdown = exportNotes(root, 5000);
  assert.match(markdown, /## Deadlines/);
  assert.equal(fs.existsSync(notesMarkdownPath(root)), true);
  done();
});
