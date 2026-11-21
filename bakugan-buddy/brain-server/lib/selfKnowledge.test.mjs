import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { estimateTokens } from "./capabilities.mjs";
import { createSelfKnowledge, PROMPT_MAX_CHARS, readState, statePath, withSelfKnowledge } from "./selfKnowledge.mjs";

function items() {
  return [
    { id: "2026-11-21|I can now do one.", date: "2026-11-21", text: "I can now do one.", pr: 1 },
    { id: "2026-11-21|I can now do two.", date: "2026-11-21", text: "I can now do two.", pr: 2 },
  ];
}

function caps(summary = "CAPS: files, 8B local.") {
  return { snapshot: () => ({ summary }) };
}

test("the first chat promises new-since-last-time once, then remembers", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "preyas-self-"));
  try {
    const sk = createSelfKnowledge({ dataDir: dir, items: items(), capabilities: caps() });
    assert.equal(sk.introPending(), true);
    const first = await sk.promptForChat();
    assert.ok(first.includes("CAPS: files, 8B local."));
    assert.ok(first.includes('New since last time: '));
    assert.ok(first.includes("I can now do one."));
    assert.equal(sk.introPending(), false);

    const second = await sk.promptForChat();
    assert.equal(second, "CAPS: files, 8B local.");

    const state = readState(statePath(dir));
    assert.equal(state.seen.length, 2);
    assert.equal(state.seenAt, new Date(state.seenAt).toISOString());
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a new changelog entry is announced once, and only the new one is named", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "preyas-self-new-"));
  try {
    const first = createSelfKnowledge({ dataDir: dir, items: items(), capabilities: caps() });
    await first.promptForChat();

    const newer = [
      { id: "2026-11-22|I can now do three.", date: "2026-11-22", text: "I can now do three.", pr: 3 },
      ...items(),
    ];
    const second = createSelfKnowledge({ dataDir: dir, items: newer, capabilities: caps("CAPS.") });
    assert.equal(second.introPending(), true);
    const text = await second.promptForChat();
    assert.ok(text.includes("I can now do three."));
    assert.ok(!text.includes("New since last time: I can now do one."), "old items stay quiet");
    assert.equal(second.introPending(), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("withSelfKnowledge inserts one system block after the persona, only for a chat", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "preyas-self-inject-"));
  try {
    const sk = createSelfKnowledge({ dataDir: dir, items: items(), capabilities: caps() });
    const raw = Buffer.from(
      JSON.stringify({ messages: [{ role: "system", content: "PERSONA" }, { role: "user", content: "what's new?" }] }),
    );
    const first = await withSelfKnowledge(raw, sk);
    const body = JSON.parse(first.toString("utf8"));
    assert.equal(body.messages.length, 3);
    assert.equal(body.messages[0].content, "PERSONA");
    assert.match(body.messages[1].content, /New since last time: /);
    assert.equal(body.messages[2].content, "what's new?");

    const second = await withSelfKnowledge(raw, sk);
    const body2 = JSON.parse(second.toString("utf8"));
    assert.equal(body2.messages.length, 3);
    assert.ok(!body2.messages[1].content.includes("New since last time: "));

    const noUser = Buffer.from(JSON.stringify({ messages: [{ role: "system", content: "PERSONA" }] }));
    assert.equal(await withSelfKnowledge(noUser, sk), noUser, "no user message, no injection");
    const broken = Buffer.from("not json");
    assert.equal(await withSelfKnowledge(broken, sk), broken);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the injected block stays under ~400 tokens even with a long capability summary", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "preyas-self-budget-"));
  try {
    const long = "Tools: Files, Terminal, Browser. ".repeat(80);
    const sk = createSelfKnowledge({ dataDir: dir, items: items(), capabilities: caps(long.slice(0, PROMPT_MAX_CHARS)) });
    const text = await sk.promptForChat();
    assert.ok(text.length <= PROMPT_MAX_CHARS + 1, text.length);
    assert.ok(estimateTokens(text) <= 400, estimateTokens(text) + " tokens");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a broken state file starts fresh instead of throwing", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "preyas-self-broken-"));
  try {
    const file = statePath(dir);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "{ broken");
    assert.deepEqual(readState(file).seen, []);
    const sk = createSelfKnowledge({ dataDir: dir, items: [], capabilities: caps() });
    assert.equal(sk.introPending(), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
