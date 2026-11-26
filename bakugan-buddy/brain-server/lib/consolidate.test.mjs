import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadNotes, notesPath, saveNotes } from "./notes.mjs";
import {
  STALE_DAYS,
  appendArchive,
  archivePath,
  atlasPath,
  dayKey,
  decayNotes,
  digestPath,
  digestText,
  isStale,
  liftToAtlas,
  loadAtlas,
  maybeConsolidate,
  mergeDuplicates,
  runConsolidation,
  statePath,
} from "./consolidate.mjs";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 26, 20, 0, 0);

function drive(notes = []) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "preyas-consolidate-"));
  if (notes.length) saveNotes(root, notes);
  return { root, done: () => fs.rmSync(root, { recursive: true, force: true }) };
}

function note(id, text, kind = "fact", created = NOW - DAY, updated = created) {
  return { id, text, kind, sourceChatId: "", created, updated };
}

test("near-duplicates collapse into the older note, keeping the longer text", () => {
  const notes = [
    note("b", "Dentist appointment on Friday at 9 in the morning", "deadline", 200),
    note("a", "Dentist on Friday at 9 in the morning", "deadline", 100),
    note("c", "Buy more coffee beans", "todo", 300),
  ];
  const { notes: kept, pairs } = mergeDuplicates(notes);
  assert.equal(kept.length, 2);
  assert.deepEqual(pairs.map((pair) => pair.drop), ["b"]);
  const survivor = kept.find((row) => row.id === "a");
  assert.equal(survivor.text, "Dentist appointment on Friday at 9 in the morning");
  assert.ok(kept.some((row) => row.id === "c"));
});

test("notes that merely share a word are not merged", () => {
  const notes = [note("a", "Preyas uses Qwen3 8B", "fact"), note("b", "Preyas likes purple", "fact")];
  assert.equal(mergeDuplicates(notes).notes.length, 2);
});

test("a longer paraphrase of the same kind is one note", () => {
  const notes = [
    note("a", "Refine narrative logic to ensure character motivation aligns with action", "decision"),
    note("b", "Refine narrative logic to ensure character motivation makes sense", "decision"),
  ];
  assert.equal(mergeDuplicates(notes).notes.length, 1);
});

test("one distinguishing word keeps two preferences apart", () => {
  const notes = [
    note("a", "Partner prefers straightforward communication.", "fact"),
    note("b", "Partner prefers minimal emojis during communication.", "fact"),
  ];
  assert.equal(mergeDuplicates(notes).notes.length, 2);
});

test("a negation is never merged away", () => {
  const notes = [
    note("a", "Preyas can use emojis in every answer", "fact"),
    note("b", "Preyas cannot use emojis in every answer", "fact"),
  ];
  assert.equal(mergeDuplicates(notes).notes.length, 2);
});

test("a quiet note decays, but a decision never does", () => {
  const old = NOW - (STALE_DAYS + 1) * DAY;
  const staleTodo = note("a", "Read the Bakugan rulebook", "todo", old);
  const oldDecision = note("b", "Use Qwen3 8B Q4 as main model", "decision", old);
  const fresh = note("c", "Ship the arena", "todo", NOW - DAY);
  const { kept, decayed } = decayNotes([staleTodo, oldDecision, fresh], { now: NOW });
  assert.deepEqual(decayed.map((row) => row.id), ["a"]);
  assert.deepEqual(kept.map((row) => row.id), ["b", "c"]);
  assert.equal(isStale(oldDecision, { now: NOW }), false);
});

test("every note becomes a record and the entities are shared, not repeated", () => {
  const notes = [
    note("a", "Remember Preyas runs on Qwen3 8B", "fact"),
    note("b", "Ask Preyas about the arena", "todo"),
  ];
  const { nodes, edges } = liftToAtlas(notes, { now: NOW });
  const records = nodes.filter((row) => row.kind === "record");
  const entities = nodes.filter((row) => row.kind === "entity");
  assert.equal(records.length, 2);
  const preyas = entities.filter((row) => row.label.toLowerCase() === "preyas");
  assert.equal(preyas.length, 1);
  const preyasEdges = edges.filter((edge) => edge.to === preyas[0].id);
  assert.equal(preyasEdges.length, 2);
  assert.ok(preyasEdges.every((edge) => edge.relation === "mentions"));
  assert.ok(preyasEdges.every((edge) => edge.why && edge.source.id));
  assert.ok(entities.every((row) => row.aliases.length > 0));
});

test("a note can name at most six entities", () => {
  const text = "Ask Alice about Bob and Carol, Dave, Erin, Frank, Grace and Heidi";
  const { edges } = liftToAtlas([note("a", text, "todo")], { now: NOW });
  assert.ok(edges.length <= 6);
  assert.ok(edges.length > 0);
});

test("one night merges, decays, lifts and writes a short digest", () => {
  const old = NOW - (STALE_DAYS + 1) * DAY;
  const { root, done } = drive([
    note("a", "Dentist on Friday at 9 in the morning", "deadline", old, NOW - DAY),
    note("b", "Dentist appointment on Friday at 9 in the morning", "deadline", old, old),
    note("c", "Learn FastText and M2M100", "idea", old),
    note("d", "Preyas runs on Qwen3 8B", "fact", NOW - DAY),
  ]);
  const summary = runConsolidation(root, { now: NOW });
  assert.equal(summary.before, 4);
  assert.equal(summary.merged, 1);
  assert.equal(summary.decayed, 1);
  assert.equal(summary.after, 2);
  assert.ok(summary.entities > 0);

  const stored = loadNotes(root);
  assert.deepEqual(stored.map((row) => row.id).sort(), ["a", "d"]);
  const archived = fs.readFileSync(archivePath(root), "utf8").trim().split("\n").map(JSON.parse);
  assert.deepEqual(archived.map((row) => row.id), ["c"]);
  assert.ok(archived[0].archivedAt);
  assert.equal(archived[0].text, "Learn FastText and M2M100");

  const atlas = loadAtlas(root);
  assert.equal(atlas.nodes.filter((row) => row.kind === "record").length, 2);
  assert.ok(atlas.edges.length > 0);

  const digest = fs.readFileSync(digestPath(root, summary.day), "utf8");
  assert.ok(digest.split("\n").length <= 12);
  assert.match(digest, /1 near-duplicate note was merged/);
  assert.match(digest, /1 stale note was filed/);
  done();
});

test("a dry run writes nothing at all", () => {
  const old = NOW - (STALE_DAYS + 1) * DAY;
  const { root, done } = drive([note("a", "Old idea about flash cards", "idea", old)]);
  const before = fs.readFileSync(notesPath(root), "utf8");
  const summary = runConsolidation(root, { now: NOW, dryRun: true });
  assert.equal(summary.decayed, 1);
  assert.equal(fs.readFileSync(notesPath(root), "utf8"), before);
  assert.equal(fs.existsSync(archivePath(root)), false);
  assert.equal(fs.existsSync(atlasPath(root)), false);
  assert.equal(fs.existsSync(statePath(root)), false);
  done();
});

test("a second night adds nothing to the archive", () => {
  const old = NOW - (STALE_DAYS + 1) * DAY;
  const { root, done } = drive([note("a", "Old idea about flash cards", "idea", old)]);
  runConsolidation(root, { now: NOW });
  runConsolidation(root, { now: NOW + DAY });
  const archived = fs.readFileSync(archivePath(root), "utf8").trim().split("\n");
  assert.equal(archived.length, 1);
  appendArchive(root, [note("a", "Old idea about flash cards", "idea", old)], NOW);
  assert.equal(fs.readFileSync(archivePath(root), "utf8").trim().split("\n").length, 1);
  done();
});

test("the pass runs once a day and only after three in the morning", () => {
  const { root, done } = drive([note("a", "Preyas runs on Qwen3 8B", "fact")]);
  const early = new Date("2026-11-27T01:30:00+01:00");
  assert.equal(maybeConsolidate(root, early), null);
  assert.equal(fs.existsSync(statePath(root)), false);
  const late = new Date("2026-11-27T04:00:00+01:00");
  const first = maybeConsolidate(root, late);
  assert.ok(first);
  assert.equal(dayKey(late), "2026-11-27");
  assert.equal(maybeConsolidate(root, new Date("2026-11-27T22:00:00+01:00")), null);
  assert.ok(maybeConsolidate(root, new Date("2026-11-28T04:00:00+01:00")));
  done();
});

test("the digest is three sentences, never a diff", () => {
  const text = digestText({ day: "2026-11-27", before: 186, after: 171, merged: 15, decayed: 12, entities: 238, links: 402 });
  assert.match(text, /# Consolidation - 2026-11-27/);
  assert.match(text, /15 near-duplicate notes were merged/);
  assert.match(text, /171 notes sit on 238 entities with 402 mentions/);
  assert.match(text, /12 stale notes were filed/);
  assert.equal(text.trim().split("\n").length, 7);
});
