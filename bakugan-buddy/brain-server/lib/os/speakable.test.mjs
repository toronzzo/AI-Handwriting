import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { speakableStep } from "./speakable.mjs";
import { handleOsRoute } from "./routes.mjs";

test("commands and backticks are never in the spoken text", () => {
  const step = [
    "Step 5 of 7: Squash and merge",
    "Careful: read the Check first.",
    "Check: The page shows Merged.",
    "Do: Click squash and merge.",
    "Why: One commit per slice.",
    "Command: `gh pr merge <n> --squash`",
    "Paste what you see here.",
  ].join("\n");
  const spoken = speakableStep(step);
  assert.ok(!spoken.text.includes("gh pr merge"), "commands must not be spoken");
  assert.ok(!spoken.text.includes("`"), "backticks must not survive");
  assert.ok(!/Command:/i.test(spoken.text));
  assert.match(spoken.text, /Squash and merge/);
});

test("URLs and placeholders become short spoken words", () => {
  const spoken = speakableStep("Do: Open https://github.com/toronzzo/AI-Handwriting/pull/<n> in the browser. Check: You see it.");
  assert.ok(!spoken.text.includes("github.com"), "URLs are replaced");
  assert.match(spoken.text, /the link on screen/);
  assert.ok(!spoken.text.includes("<n>"));
  assert.match(spoken.text, /the number/);
});

test("a step with only a command still says something", () => {
  const spoken = speakableStep("Command: `rm -rf /tmp/x`");
  assert.equal(spoken.text, "The command is on screen.");
});

test("empty input stays empty", () => {
  assert.deepEqual(speakableStep(""), { text: "", lang: "en" });
  assert.deepEqual(speakableStep("   \n  "), { text: "", lang: "en" });
});

test("sentence and length caps cut at a sentence end", () => {
  const sentences = Array.from({ length: 8 }, (_, i) => `Sentence number ${i + 1} with enough words to matter.`).join(" ");
  const spoken = speakableStep(sentences);
  const count = (spoken.text.match(/Sentence number/g) || []).length;
  assert.ok(count <= 3, `at most 3 sentences, got ${count}`);
  const long = speakableStep("A. " + "word ".repeat(400));
  assert.ok(long.text.length <= 420, `length capped, got ${long.text.length}`);
});

test("Russian detection: more than 30% Cyrillic letters", () => {
  assert.equal(speakableStep("Сохранено: кофе. Отменить можно 10 с.").lang, "ru");
  assert.equal(speakableStep("Saved: coffee. Undo for 10 s.").lang, "en");
  assert.equal(speakableStep("Mix: coffee and кофе only a little.").lang, "en");
});

test("route: POST /v1/coach/voice-intent autoSend table", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "voice-intent-"));
  try {
    const call = async (text, dataDir = dir) => {
      const out = { status: 0, body: "" };
      const res = { writeHead(status) { out.status = status; }, end(chunk) { out.body = String(chunk); } };
      const handled = await handleOsRoute({
        req: { method: "POST" },
        res,
        url: new URL("http://localhost/v1/coach/voice-intent"),
        dataDir,
        now: () => Date.now(),
        readJson: async () => ({ text }),
        readBody: async () => Buffer.alloc(0),
      });
      return { handled, ...JSON.parse(out.body) };
    };

    for (const word of ["done", "ok", "next", "back", "why", "where am i", "stop", "готово", "дальше", "назад", "почему", "где я", "стоп"]) {
      const result = await call(word);
      assert.equal(result.autoSend, true, `"${word}" should auto-send`);
    }
    const near = await call("done with it");
    assert.equal(near.autoSend, false, "a near-miss does not auto-send");
    assert.equal(near.normalized, "done with it");
    const hello = await call("hello there");
    assert.equal(hello.autoSend, false);

    // A Danger step: only why/back auto-send.
    const skillsDir = path.join(dir, "coach", "skills");
    fs.mkdirSync(skillsDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillsDir, "danger-skill.md"),
      [
        "---",
        'name: Danger skill',
        'when: ["danger"]',
        "risk: danger",
        "version: 1",
        "---",
        "Intro.",
        "## Steps",
        "",
        "### 1. Early step",
        "Do: One.",
        "Check: It worked.",
        "Expect: /^ok$/",
        "",
        "### 2. Dangerous step",
        "Do: The risky thing.",
        "Danger: yes",
        "Check: It is done.",
        "Expect: /^done$/",
      ].join("\n"),
    );
    fs.mkdirSync(path.join(dir, "coach"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "coach", "session.json"),
      JSON.stringify({ session: { mode: "skill", skillName: "Danger skill", step: 2 } }),
    );
    assert.equal((await call("done")).autoSend, false, "Danger step: done does not auto-send");
    assert.equal((await call("готово")).autoSend, false);
    assert.equal((await call("why")).autoSend, true, "Danger step: why still auto-sends");
    assert.equal((await call("back")).autoSend, true, "Danger step: back still auto-sends");
    assert.equal((await call("stop")).autoSend, false, "Danger step: stop does not auto-send");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("route: bad JSON on voice-intent is a 400", async () => {
  const out = { status: 0, body: "" };
  const res = { writeHead(status) { out.status = status; }, end(chunk) { out.body = String(chunk); } };
  const handled = await handleOsRoute({
    req: { method: "POST" },
    res,
    url: new URL("http://localhost/v1/coach/voice-intent"),
    dataDir: null,
    now: () => Date.now(),
    readJson: async () => {
      throw { status: 400, message: "bad json" };
    },
    readBody: async () => Buffer.alloc(0),
  });
  assert.equal(handled, true);
  assert.equal(out.status, 400);
});
