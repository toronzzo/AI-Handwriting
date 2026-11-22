import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { appendEvent } from "./os/events.mjs";
import { partnerFromAreas } from "../../packages/alive/src/rpgLevel.ts";
import {
  FIRST_CHAT_TITLE,
  NEW_CHAT_TITLE,
  appendMessage,
  chatFile,
  collapseBriefingChat,
  collapseBriefingsEverywhere,
  isBriefingRow,
  oneBriefingPerDay,
  createChat,
  dayFromContent,
  deleteChat,
  drivePartner,
  indexPath,
  listChats,
  migrateLegacy,
  readChat,
  renameChat,
  titleFrom,
  upsertDayMessage,
} from "./chats.mjs";

function drive() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "preyas-chats-"));
  return { root, done: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test("a chat gets its title from the first user message", () => {
  const { root, done } = drive();
  const chat = createChat(root);
  assert.equal(chat.title, NEW_CHAT_TITLE);
  appendMessage(root, chat.id, { role: "user", who: "user", content: "  tell me about   bakugan " });
  appendMessage(root, chat.id, { role: "user", who: "user", content: "second message" });
  const listed = listChats(root);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].title, "tell me about bakugan");
  assert.equal(listed[0].id, chat.id);
  done();
});

test("a long first message is trimmed to about 40 characters", () => {
  assert.equal(titleFrom("short"), "short");
  const long = "a".repeat(60);
  const title = titleFrom(long);
  assert.equal(title.length, 41);
  assert.ok(title.endsWith("…"));
  assert.equal(title.slice(0, 40), "a".repeat(40));
  assert.equal(titleFrom("   "), NEW_CHAT_TITLE);
});

test("chats are listed newest first and keep their own messages", () => {
  const { root, done } = drive();
  const first = createChat(root, "Older");
  const second = createChat(root, "Newer");
  appendMessage(root, first.id, { role: "user", who: "user", content: "one" });
  appendMessage(root, second.id, { role: "user", who: "user", content: "two" });
  // Touching the first chat makes it the most recent.
  appendMessage(root, first.id, { role: "assistant", who: "preyas", content: "three" });
  const listed = listChats(root);
  assert.equal(listed[0].id, first.id);
  assert.equal(listed[1].id, second.id);
  assert.equal(readChat(root, second.id).messages.length, 1);
  assert.equal(readChat(root, first.id).messages.length, 2);
  done();
});

test("rename and delete update the index", () => {
  const { root, done } = drive();
  const chat = createChat(root);
  assert.equal(renameChat(root, chat.id, "  Battle notes  ").title, "Battle notes");
  assert.equal(listChats(root)[0].title, "Battle notes");
  assert.equal(deleteChat(root, chat.id), true);
  assert.equal(listChats(root).length, 0);
  assert.equal(fs.existsSync(chatFile(root, chat.id)), false);
  assert.equal(deleteChat(root, chat.id), false);
  done();
});

test("a new chat starts empty while the summary stays shared", () => {
  const { root, done } = drive();
  const old = createChat(root, "Old");
  appendMessage(root, old.id, { role: "user", who: "user", content: "my name is Toronzzo" });
  const fresh = createChat(root);
  const book = readChat(root, fresh.id);
  assert.deepEqual(book.messages, []);
  assert.match(book.summary, /Toronzzo/);
  done();
});

test("the legacy chat.jsonl is copied into First chat, not moved", () => {
  const { root, done } = drive();
  const dir = path.join(root, "history");
  fs.mkdirSync(dir, { recursive: true });
  const legacy = path.join(dir, "chat.jsonl");
  fs.writeFileSync(
    legacy,
    [
      JSON.stringify({ t: 1, role: "user", who: "user", content: "old question" }),
      JSON.stringify({ t: 2, role: "assistant", who: "preyas", content: "old answer" }),
      "",
    ].join("\n"),
  );
  const result = migrateLegacy(root);
  assert.equal(result.migrated, true);
  assert.equal(result.id, "first");
  assert.equal(fs.existsSync(legacy), true, "the source file must survive migration");
  const chats = listChats(root);
  assert.equal(chats.length, 1);
  assert.equal(chats[0].title, FIRST_CHAT_TITLE);
  assert.equal(readChat(root, "first").messages.length, 2);
  // Running again does not duplicate or re-copy.
  assert.equal(migrateLegacy(root).migrated, false);
  assert.equal(listChats(root).length, 1);
  done();
});

test("migration writes an empty index when there is no history yet", () => {
  const { root, done } = drive();
  const result = migrateLegacy(root);
  assert.equal(result.migrated, false);
  assert.deepEqual(listChats(root), []);
  assert.equal(fs.existsSync(indexPath(root)), true);
  done();
});

test("an unknown chat is not created or written", () => {
  const { root, done } = drive();
  assert.equal(readChat(root, "nope"), null);
  assert.equal(appendMessage(root, "nope", { role: "user", content: "x" }), null);
  assert.equal(renameChat(root, "nope", "x"), null);
  assert.equal(deleteChat(root, "nope"), false);
  done();
});

test("a chat id cannot escape the chats folder", () => {
  const { root, done } = drive();
  assert.throws(() => readChat(root, "../../etc/passwd"), /bad chat id/);
  done();
});

test("a torn index is rebuilt from the chat files", () => {
  const { root, done } = drive();
  const first = createChat(root);
  const second = createChat(root);
  appendMessage(root, first.id, { role: "user", who: "user", content: "recover me first" });
  appendMessage(root, second.id, { role: "user", who: "user", content: "recover me second" });
  fs.writeFileSync(indexPath(root), "{ torn json");
  const listed = listChats(root);
  assert.equal(listed.length, 2);
  assert.equal(listed.some((chat) => chat.id === first.id && chat.title === "recover me first"), true);
  assert.equal(listed.some((chat) => chat.id === second.id && chat.title === "recover me second"), true);
  assert.equal(fs.existsSync(`${indexPath(root)}.tmp`), false);
  done();
});

function lines(root, id) {
  return fs
    .readFileSync(chatFile(root, id), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

test("a briefing day has exactly one message, replaced on a second run", () => {
  const { root, done } = drive();
  const chat = createChat(root, "Daily briefing");
  const first = upsertDayMessage(root, chat.id, "2026-11-02", {
    t: 1000,
    role: "assistant",
    who: "preyas",
    content: "- first version",
  });
  assert.equal(first.removed, 0);
  const second = upsertDayMessage(root, chat.id, "2026-11-02", {
    t: 2000,
    role: "assistant",
    who: "preyas",
    content: "- second version",
  });
  assert.equal(second.removed, 1);
  const rows = lines(root, chat.id);
  assert.equal(rows.length, 1, "one message for that day");
  assert.equal(rows[0].content, "- second version", "the latest wins");
  assert.equal(rows[0].briefingDay, "2026-11-02", "tagged so it can be found later");
  assert.equal(fs.existsSync(`${chatFile(root, chat.id)}.tmp`), false);
  // Another day is untouched.
  upsertDayMessage(root, chat.id, "2026-11-03", { t: 3000, role: "assistant", who: "preyas", content: "- next day" });
  assert.equal(lines(root, chat.id).length, 2);
  assert.deepEqual(readChat(root, chat.id).messages.map((row) => row.content), ["- second version", "- next day"]);
  done();
});

test("the day is also found in an old untagged 'Briefing <day>' message", () => {
  const { root, done } = drive();
  const chat = createChat(root, "Daily briefing");
  appendMessage(root, chat.id, { role: "assistant", who: "preyas", content: "Briefing 2026-11-02\n\n- old" });
  upsertDayMessage(root, chat.id, "2026-11-02", { t: 5000, role: "assistant", who: "preyas", content: "- new" });
  const rows = lines(root, chat.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].content, "- new");
  assert.equal(dayFromContent("Briefing 2026-11-07\n\nMorning"), "2026-11-07");
  assert.equal(dayFromContent("just a chat"), "");
  assert.equal(dayFromContent("Briefing tomorrow"), "");
  done();
});

test("saved duplicates of one day's briefing are shown once, and the newest is kept", () => {
  const { root, done } = drive();
  const chat = createChat(root, "Daily briefing");
  const file = chatFile(root, chat.id);
  const rows = [
    { t: 1000, role: "assistant", who: "preyas", content: "Good morning\n\n- old", briefingDay: "2026-11-02" },
    { t: 2000, role: "user", who: "user", content: "a normal question" },
    { t: 3000, role: "assistant", who: "preyas", content: "Good morning\n\n- new", briefingDay: "2026-11-02" },
    { t: 4000, role: "assistant", who: "preyas", content: "Briefing 2026-11-03\n\n- next" },
  ];
  for (const row of rows) fs.appendFileSync(file, JSON.stringify(row) + "\n");
  assert.deepEqual(
    readChat(root, chat.id).messages.map((row) => row.content),
    ["a normal question", "Good morning\n\n- new", "Briefing 2026-11-03\n\n- next"],
  );
  assert.equal(isBriefingRow({ content: "hello" }), false);
  assert.equal(isBriefingRow({ content: "x", briefingDay: "2026-11-02" }), true);
  assert.equal(oneBriefingPerDay([{ content: "keep me" }]).length, 1);
  done();
});

test("a briefing appended again for the same day replaces it instead of piling up", () => {
  const { root, done } = drive();
  const chat = createChat(root, "Daily briefing");
  appendMessage(root, chat.id, { t: 1000, role: "assistant", who: "preyas", briefingDay: "2026-11-02", content: "Good morning\n\n- first" });
  appendMessage(root, chat.id, { t: 2000, role: "assistant", who: "preyas", briefingDay: "2026-11-02", content: "Good morning\n\n- second" });
  appendMessage(root, chat.id, { t: 3000, role: "user", who: "user", content: "hello" });
  const rows = lines(root, chat.id);
  const briefs = rows.filter((row) => row.briefingDay === "2026-11-02");
  assert.equal(briefs.length, 1, "only one message for the day");
  assert.equal(briefs[0].content, "Good morning\n\n- second", "the newest wins");
  assert.equal(rows.filter((row) => row.content === "hello").length, 1, "normal messages still append");
  done();
});

test("the sweep cleans every chat, backs each file up and leaves normal messages alone", () => {
  const { root, done } = drive();
  const briefing = createChat(root, "Daily briefing");
  const chat = createChat(root, "A real chat");
  const seed = (id, rows) => {
    for (const row of rows) fs.appendFileSync(chatFile(root, id), JSON.stringify(row) + "\n");
  };
  seed(briefing.id, [
    { t: 1000, role: "assistant", who: "preyas", content: "Good morning\n\n- copy 0", briefingDay: "2026-11-02" },
    { t: 2000, role: "assistant", who: "preyas", content: "Good morning\n\n- copy 1", briefingDay: "2026-11-02" },
  ]);
  seed(chat.id, [
    { t: 3000, role: "assistant", who: "preyas", content: "Good morning\n\n- old", briefingDay: "2026-11-02" },
    { t: 3100, role: "user", who: "user", content: "a normal question" },
    { t: 4000, role: "assistant", who: "preyas", content: "Good morning\n\n- newest", briefingDay: "2026-11-02" },
  ]);

  const result = collapseBriefingsEverywhere(root, 909);
  assert.equal(result.removed, 2, "one older copy in each chat");
  assert.equal(result.backups.length, 2, "a copy per rewritten file");
  assert.equal(fs.existsSync(`${chatFile(root, briefing.id)}.bak-909`), true);
  assert.match(fs.readFileSync(`${chatFile(root, chat.id)}.bak-909`, "utf8"), /a normal question/, "the backup holds the old file");
  assert.deepEqual(lines(root, chat.id).map((row) => row.content), ["a normal question", "Good morning\n\n- newest"]);
  assert.equal(lines(root, briefing.id).length, 1);

  // Nothing left to drop: no new copy and no new backup.
  assert.deepEqual(collapseBriefingsEverywhere(root, 910), { removed: 0, backups: [] });
  assert.equal(fs.existsSync(`${chatFile(root, chat.id)}.bak-910`), false);
  done();
});

test("the one-time cleanup keeps the newest message per day and writes a .bak copy", () => {
  const { root, done } = drive();
  const chat = createChat(root, "Daily briefing");
  const other = createChat(root, "A real chat");
  // Seed the duplicates straight into the file: appendMessage now refuses them.
  for (let i = 0; i < 4; i += 1) {
    fs.appendFileSync(chatFile(root, chat.id), JSON.stringify({ t: 1000 + i, role: "assistant", who: "preyas", content: `Briefing 2026-11-02\n\n- copy ${i}` }) + "\n");
  }
  appendMessage(root, chat.id, { role: "assistant", who: "preyas", content: "Briefing 2026-11-03\n\n- one" });
  appendMessage(root, chat.id, { role: "assistant", who: "preyas", content: "Briefing 2026-11-07\n\n- only" });
  appendMessage(root, chat.id, { role: "user", who: "user", content: "a normal message" });
  appendMessage(root, other.id, { role: "assistant", who: "preyas", content: "Briefing 2026-11-02\n\n- other chat" });

  const result = collapseBriefingChat(root, chat.id, 777);
  assert.equal(result.removed, 3, "three older duplicates");
  assert.equal(result.backup, `${chatFile(root, chat.id)}.bak-777`);
  assert.equal(fs.existsSync(result.backup), true, "a copy is kept first");
  assert.match(fs.readFileSync(result.backup, "utf8"), /- copy 0/, "the copy holds the old rows");
  const rows = lines(root, chat.id);
  assert.equal(rows.length, 4, "two days plus the normal message");
  assert.deepEqual(rows.map((row) => row.content), [
    "Briefing 2026-11-02\n\n- copy 3",
    "Briefing 2026-11-03\n\n- one",
    "Briefing 2026-11-07\n\n- only",
    "a normal message",
  ]);
  assert.equal(lines(root, other.id).length, 1, "other chats are not touched");

  // Nothing left to drop: no second copy.
  assert.deepEqual(collapseBriefingChat(root, chat.id, 888), { removed: 0, backup: "" });
  done();
});

test("level and bond are one Preyas, shared by every chat and the life log", () => {
  const { root, done } = drive();
  const quiet = createChat(root, "hi");
  const busy = createChat(root, "long");
  appendMessage(root, quiet.id, { role: "user", who: "user", content: "hi" });
  for (let i = 0; i < 14; i += 1) {
    appendMessage(root, busy.id, { role: "user", who: "user", content: `turn ${i}` });
  }
  appendEvent(root, {
    v: 1,
    id: "evt_level",
    ts: Date.UTC(2026, 10, 22, 12, 0, 0),
    day: "2026-11-22",
    type: "focus",
    data: { minutes: 1000, area: "intel" },
    src: "tool",
    raw: "",
    parser: "p1",
  });
  const partner = drivePartner(root);
  assert.equal(partner.level, 2, "200 XP from the life log is level 2, the Today number");
  assert.deepEqual(readChat(root, quiet.id).partner, partner);
  assert.deepEqual(readChat(root, busy.id).partner, partner);
  assert.deepEqual(partner, partnerFromAreas(partner.turns));
  assert.notEqual(partner.bond, 4, "one turn in the open chat is not the bond");
  assert.notEqual(partner.bond, 56, "fourteen turns in another chat are not the bond");
  done();
});
