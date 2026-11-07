import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  collectUserNotes,
  ensureObsidianConfig,
  exportVault,
  listMarkdown,
  saveToVault,
  searchVault,
} from "./vault.mjs";

const NOW = new Date("2026-11-03T09:00:00+01:00").getTime();

function sandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "preyas-vault-"));
  return { root, done: () => fs.rmSync(root, { recursive: true, force: true }) };
}

function input() {
  return {
    notes: [
      { id: "n1", text: "Arena budget for March", kind: "decision", created: NOW },
      { id: "n2", text: "Buy arena lights", kind: "idea", created: NOW },
    ],
    reminders: [{ id: "r1", text: "call the vet", dueAt: "2026-11-05T09:00:00.000Z", status: "pending" }],
    decks: [{ id: "d1", title: "Arena", createdAt: NOW, cards: [{ question: "Q1?", answer: "A1" }] }],
    documents: [{ name: "memo.docx", summary: "- ships March 3", at: NOW }],
    briefings: [{ day: "2026-11-03", text: "- 2 flashcards due" }],
    highlights: { "2026-11-03": ["user: hello"] },
    now: NOW,
  };
}

test("export writes the whole vault and skips unchanged files next time", () => {
  const { root, done } = sandbox();
  try {
    const first = exportVault(input(), { root });
    assert.ok(first.written >= 7, `wrote ${first.written} files`);
    assert.ok(fs.existsSync(path.join(root, "Preyas.md")));
    assert.ok(fs.existsSync(path.join(root, "Reminders.md")));
    assert.ok(listMarkdown(root).some((rel) => rel.startsWith("Notes/")));

    const second = exportVault(input(), { root });
    assert.equal(second.written, 0, "a second identical export writes nothing");
    assert.equal(second.skipped, first.total);

    const changed = input();
    changed.notes.push({ id: "n3", text: "New thought", kind: "idea", created: NOW });
    const third = exportVault(changed, { root });
    assert.ok(third.written >= 2, "the new note and the home page change");
  } finally {
    done();
  }
});

test("a file still being written is left alone until it settles", () => {
  const { root, done } = sandbox();
  try {
    exportVault(input(), { root });
    const mine = path.join(root, "Notes", "My own note.md");
    fs.writeFileSync(mine, "---\ntype: idea\n---\n\n# My own note\n\nstill typing");
    const fresh = collectUserNotes({ root, now: Date.now() });
    assert.equal(fresh.length, 0, "a file modified just now is skipped");
    const settled = collectUserNotes({ root, now: Date.now() + 10_000 });
    assert.equal(settled.length, 1);
    assert.equal(settled[0].title, "My own note");
  } finally {
    done();
  }
});

test("generated files never come back as user notes", () => {
  const { root, done } = sandbox();
  try {
    exportVault(input(), { root });
    const later = Date.now() + 60_000;
    for (const file of listMarkdown(root)) fs.utimesSync(path.join(root, file), later / 1000, later / 1000);
    assert.deepEqual(collectUserNotes({ root, now: later + 10_000 }), [], "no feedback loop");
  } finally {
    done();
  }
});

test("a user edit to a generated file is imported once", () => {
  const { root, done } = sandbox();
  try {
    exportVault(input(), { root });
    const target = listMarkdown(root).find((rel) => rel.startsWith("Notes/") && rel.includes("Arena budget"));
    const full = path.join(root, target);
    fs.appendFileSync(full, "\nMy correction: the budget is 500 PLN.\n");
    const later = Date.now() + 60_000;
    fs.utimesSync(full, later / 1000, later / 1000);

    const first = collectUserNotes({ root, now: later + 10_000 });
    assert.equal(first.length, 1);
    assert.match(first[0].text, /500 PLN/);

    // Reading again without a change must not produce it a second time.
    const second = collectUserNotes({ root, now: later + 20_000, known: { [target]: first[0].fingerprint } });
    assert.equal(second.filter((row) => row.path === target).length, 0);
  } finally {
    done();
  }
});

test("checkboxes in a user note become tasks", () => {
  const { root, done } = sandbox();
  try {
    const file = path.join(root, "Notes", "jobs.md");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "---\ntype: todo\n---\n\n# Jobs\n\n- [ ] call the venue\n- [ ] book lights\n- [x] already done\n");
    const later = Date.now() + 60_000;
    fs.utimesSync(file, later / 1000, later / 1000);
    const notes = collectUserNotes({ root, now: later + 10_000 });
    assert.equal(notes.length, 1);
    assert.deepEqual(notes[0].tasks, ["call the venue", "book lights"]);
  } finally {
    done();
  }
});

test("export never touches anything outside the vault", () => {
  const { root, done } = sandbox();
  try {
    const outside = path.join(root, "keep-me.txt");
    fs.writeFileSync(outside, "important");
    const vault = path.join(root, "vault");
    exportVault(input(), { root: vault });
    assert.equal(fs.readFileSync(outside, "utf8"), "important");
    assert.ok(fs.existsSync(vault));
  } finally {
    done();
  }
});

test("search finds the user's notes and cites them", () => {
  const { root, done } = sandbox();
  try {
    const file = path.join(root, "Notes", "aquarium.md");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "---\ntype: idea\n---\n\n# Aquarium plan\n\nThe filter needs a new sponge every month.\n");
    const hits = searchVault("filter sponge", { root });
    assert.equal(hits.length, 1);
    assert.equal(hits[0].title, "Aquarium plan");
    assert.deepEqual(searchVault("nothing here matches", { root }), []);
  } finally {
    done();
  }
});

test("saveToVault writes a new file and never overwrites", () => {
  const { root, done } = sandbox();
  try {
    const first = saveToVault("My plan", "first body", { root, now: NOW });
    const second = saveToVault("My plan", "second body", { root, now: NOW });
    assert.notEqual(first.path, second.path);
    assert.match(fs.readFileSync(path.join(root, first.path), "utf8"), /first body/);
    assert.match(fs.readFileSync(path.join(root, second.path), "utf8"), /second body/);
  } finally {
    done();
  }
});

test("obsidian config is created only when missing", () => {
  const { root, done } = sandbox();
  try {
    assert.equal(ensureObsidianConfig(root).created, true);
    const appFile = path.join(root, ".obsidian", "app.json");
    const before = fs.readFileSync(appFile, "utf8");
    assert.equal(ensureObsidianConfig(root).created, false);
    assert.equal(fs.readFileSync(appFile, "utf8"), before, "user settings are never overwritten");

    fs.writeFileSync(appFile, '{"userSetting":true}');
    ensureObsidianConfig(root);
    assert.equal(fs.readFileSync(appFile, "utf8"), '{"userSetting":true}');
  } finally {
    done();
  }
});
