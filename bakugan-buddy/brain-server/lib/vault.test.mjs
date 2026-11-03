import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildVault,
  contentHash,
  dailyFile,
  deckFile,
  documentFile,
  noteFile,
  parseMarkdown,
  remindersFile,
  safeFileName,
  withHash,
  hashMatches,
} from "../../packages/alive/src/vault.ts";

const NOW = new Date("2026-11-03T09:00:00+01:00").getTime();

const note = (text, kind = "idea", created = NOW) => ({
  id: text.slice(0, 6),
  text,
  kind,
  created,
});

test("a note file has frontmatter, a heading and the text", () => {
  const file = noteFile(note("The arena plan needs a budget", "decision"));
  assert.match(file.path, /^Notes\/.+\.md$/);
  const parsed = parseMarkdown(file.content);
  assert.equal(parsed.generated, true);
  assert.equal(parsed.tags.includes("decision"), true);
  assert.equal(parsed.title, "The arena plan needs a budget");
  assert.match(parsed.body, /needs a budget/);
});

test("filenames are safe for Obsidian", () => {
  assert.equal(safeFileName('a/b:c*d?e"f<g>h|i#j^k[l]m'), "a b c d e f g h i j k l m");
  assert.equal(safeFileName("   "), "Untitled");
  assert.equal(safeFileName("x".repeat(200)).length <= 80, true);
});

test("reminders become a checklist with done and upcoming", () => {
  const file = remindersFile(
    [
      { id: "1", text: "call the vet", dueAt: "2026-11-05T09:00:00.000Z", status: "pending", repeat: "none" },
      { id: "2", text: "ship arena", dueAt: "2026-11-01T09:00:00.000Z", status: "done", repeat: "none" },
    ],
    NOW,
  );
  assert.equal(file.path, "Reminders.md");
  assert.match(file.content, /- \[ \] call the vet/);
  assert.match(file.content, /- \[x\] ship arena/);
});

test("a deck writes Question :: Answer lines", () => {
  const file = deckFile({
    id: "d1",
    title: "Arena Basics",
    language: "en",
    createdAt: NOW,
    cards: [
      { question: "When is the launch?", answer: "March 3" },
      { question: "Who calls the venue?", answer: "Preyas" },
    ],
  });
  assert.equal(file.path, "Study/Arena Basics.md");
  assert.match(file.content, /When is the launch\? :: March 3/);
  assert.match(file.content, /Who calls the venue\? :: Preyas/);
});

test("a daily file carries the briefing and that day's highlights", () => {
  const file = dailyFile("2026-11-03", "- 2 flashcards due", ["user: hello", "preyas: hi"]);
  assert.equal(file.path, "Daily/2026-11-03.md");
  assert.match(file.content, /## Briefing/);
  assert.match(file.content, /2 flashcards due/);
  assert.match(file.content, /## Chat highlights/);
});

test("a document file links back to the inbox file", () => {
  const file = documentFile({ name: "memo.docx", summary: "- ships March 3", at: NOW }, "/Volumes/Agent/BakuganBuddy/documents");
  assert.match(file.path, /^Documents\/memo\.docx\.md$/);
  assert.match(file.content, /file:\/\/\/Volumes\/Agent\/BakuganBuddy\/documents/);
});

test("the home page links every section", () => {
  const files = buildVault({
    notes: [note("Budget for the arena", "decision"), note("Buy arena lights")],
    reminders: [{ id: "1", text: "call the vet", dueAt: "2026-11-05T09:00:00.000Z", status: "pending" }],
    decks: [{ id: "d", title: "Arena", createdAt: NOW, cards: [] }],
    documents: [{ name: "memo.docx", summary: "s", at: NOW }],
    briefings: [{ day: "2026-11-03", text: "- two things" }],
    highlights: {},
    now: NOW,
  });
  const home = files.find((file) => file.path === "Preyas.md");
  assert.ok(home, "Preyas.md exists");
  assert.match(home.content, /\[\[Reminders\]\]/);
  assert.match(home.content, /\[\[Budget for the arena\]\]/);
  assert.match(home.content, /\[\[2026-11-03\]\]/);
  assert.match(home.content, /\[\[Arena\]\]/);
  assert.match(home.content, /\[\[memo\.docx\]\]/);
});

test("notes that share keywords are linked to each other", () => {
  const files = buildVault({
    notes: [
      note("Arena budget planning for the arena launch"),
      note("Arena budget review for the arena launch"),
      note("Something else entirely about weather"),
    ],
    reminders: [],
    decks: [],
    documents: [],
    briefings: [],
    highlights: {},
  });
  const first = files.find((file) => file.content.includes("Arena budget planning"));
  assert.match(first.content, /## Related/);
  assert.match(first.content, /\[\[Arena budget review/);
});

test("the hash survives writing and breaks on an edit", () => {
  const stamped = withHash(noteFile(note("Idea about the arena")));
  assert.ok(parseMarkdown(stamped.content).hash);
  assert.equal(hashMatches(parseMarkdown(stamped.content), stamped.content), true);
  const edited = `${stamped.content}\nthe user added this`;
  assert.equal(hashMatches(parseMarkdown(edited), edited), false);
  assert.equal(contentHash("abc"), contentHash("abc"));
  assert.notEqual(contentHash("abc"), contentHash("abd"));
});

test("user markdown is parsed for tasks, tags and title", () => {
  const raw = ["---", "type: idea", "tags: [personal, tests]", "---", "", "# My plan", "", "Body here.", "", "- [ ] call the vet", "- [x] done thing", ""].join("\n");
  const parsed = parseMarkdown(raw, "fallback");
  assert.equal(parsed.title, "My plan");
  assert.deepEqual(parsed.tags, ["personal", "tests"]);
  assert.deepEqual(parsed.tasks, ["call the vet"]);
  assert.equal(parsed.generated, false);
});
