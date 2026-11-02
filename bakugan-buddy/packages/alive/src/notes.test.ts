import assert from "node:assert/strict";
import test from "node:test";
import {
  NOTE_KINDS,
  dedupeKey,
  isDuplicate,
  notesContext,
  parseExtractedNotes,
  parseNoteCommand,
  queryForRetrieval,
  rankNotes,
  renderNotesMarkdown,
  type Note,
} from "./notes.ts";

function note(text: string, kind: Note["kind"] = "fact", created = 0): Note {
  return { id: text, text, kind, sourceChatId: "chat", created, updated: created };
}

test("remember, forget and recall commands are parsed", () => {
  assert.deepEqual(parseNoteCommand("remember the dentist on Friday"), {
    kind: "remember",
    text: "the dentist on Friday",
  });
  assert.deepEqual(parseNoteCommand("Remember: buy milk"), { kind: "remember", text: "buy milk" });
  assert.deepEqual(parseNoteCommand("please remember that I hate cilantro"), {
    kind: "remember",
    text: "I hate cilantro",
  });
  assert.deepEqual(parseNoteCommand("forget about the dentist"), { kind: "forget", query: "the dentist" });
  assert.deepEqual(parseNoteCommand("What did I say about the dentist?"), {
    kind: "recall",
    query: "the dentist",
  });
  assert.equal(parseNoteCommand("remember"), null);
  assert.equal(parseNoteCommand("hello there"), null);
  assert.equal(parseNoteCommand(""), null);
});

test("retrieval uses the topic, not the command wrapper", () => {
  assert.equal(queryForRetrieval("what did I say about the trip?"), "the trip");
  assert.equal(queryForRetrieval("remember to call mom"), "to call mom");
  assert.equal(queryForRetrieval("plain question"), "plain question");
});

test("duplicate notes are caught by text, not by id", () => {
  assert.equal(dedupeKey("  The Dentist, Friday! "), "the dentist friday");
  assert.equal(isDuplicate("Dentist on Friday at 9", "dentist on friday at 9."), true);
  assert.equal(
    isDuplicate("Dentist on Friday at nine in the morning", "dentist on friday at nine"),
    true,
  );
  assert.equal(isDuplicate("buy milk", "call the dentist"), false);
  assert.equal(
    isDuplicate(
      "Renew passport before the Lisbon trip in March",
      "Partner needs to renew passport before March trip to Lisbon",
    ),
    true,
  );
  assert.equal(isDuplicate("ok", "okay then"), false);
});

test("BM25 ranks the note that shares the query words", () => {
  const notes = [
    note("dentist appointment on Friday at nine"),
    note("the aquarium filter needs a new sponge"),
    note("buy milk and bread"),
    note("dentist again next month for a cleaning"),
  ];
  const ranked = rankNotes(notes, "dentist appointment");
  assert.equal(ranked.length, 2);
  assert.match(ranked[0]!.text, /dentist appointment/);
  assert.equal(rankNotes(notes, "quantum chromodynamics").length, 0);
  assert.equal(rankNotes(notes, "dentist", 1).length, 1);
});

test("markdown export groups notes by kind", () => {
  const notes = [
    note("call the dentist", "todo", 1),
    note("ship the chat panel on Friday", "deadline", 2),
    note("use the local model first", "decision", 3),
  ];
  const md = renderNotesMarkdown(notes, Date.UTC(2026, 10, 2));
  assert.match(md, /^# Preyas notes/);
  assert.match(md, /_Updated 2026-11-02_/);
  const deadlines = md.indexOf("## Deadlines");
  const decisions = md.indexOf("## Decisions");
  const todos = md.indexOf("## Todos");
  assert.ok(deadlines >= 0 && decisions > deadlines && todos > decisions);
  assert.match(md, /- ship the chat panel on Friday/);
  assert.match(md, /- call the dentist/);
  assert.equal(renderNotesMarkdown([], Date.UTC(2026, 10, 2)).includes("_No notes yet._"), true);
});

test("model output is parsed into notes, tolerating thinking and fences", () => {
  const raw = '<think>hmm</think>```json\n[{"text":"Ship the panel on Friday","kind":"deadline"},{"text":"x","kind":"idea"},{"text":"Uses local models","kind":"nonsense"}]\n```';
  const parsed = parseExtractedNotes(raw);
  assert.equal(parsed.length, 2);
  assert.deepEqual(parsed[0], { text: "Ship the panel on Friday", kind: "deadline" });
  assert.deepEqual(parsed[1], { text: "Uses local models", kind: "fact" });
  assert.deepEqual(parseExtractedNotes("no json here"), []);
  assert.deepEqual(parseExtractedNotes('{"text":"object not array"}'), []);
});

test("the injected note context lists kind and text", () => {
  const context = notesContext([
    { kind: "deadline", text: "ship on Friday" },
    { kind: "fact", text: "partner likes aquariums" },
  ]);
  assert.match(context, /never invent/);
  assert.match(context, /- \[deadline\] ship on Friday/);
  assert.match(context, /- \[fact\] partner likes aquariums/);
});

test("every kind has a label in the export", () => {
  const all = NOTE_KINDS.map((kind, index) => note(`${kind} item`, kind, index));
  const md = renderNotesMarkdown(all, 0);
  for (const kind of NOTE_KINDS) {
    assert.match(md, new RegExp(`## ${kind[0]!.toUpperCase()}${kind.slice(1)}s`));
  }
});
