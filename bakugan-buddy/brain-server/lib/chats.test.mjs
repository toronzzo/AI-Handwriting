import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  FIRST_CHAT_TITLE,
  NEW_CHAT_TITLE,
  appendMessage,
  chatFile,
  createChat,
  deleteChat,
  indexPath,
  listChats,
  migrateLegacy,
  readChat,
  renameChat,
  titleFrom,
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
