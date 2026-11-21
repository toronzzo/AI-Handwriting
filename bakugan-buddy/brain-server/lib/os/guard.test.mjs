import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createApprovals, guardedRun, hashAction, llamaJudge, reviewAction, tieBreakPrompt } from "./guard.mjs";
import { runTask } from "../taskRunner.mjs";
import { newTask } from "../tasks.mjs";

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "guard-test-"));
}

function writeAction() {
  return {
    kind: "write_vault",
    args: { title: "lunch", text: "plov" },
    userRequest: "put down what I ate",
    origin: "user",
    source: "chat",
  };
}

test("tie-breaker: yes allows a write, anything else asks", async () => {
  const yes = await reviewAction(writeAction(), { judge: async () => "yes", dataDir: null });
  assert.equal(yes.verdict, "allow");
  assert.equal(yes.model, true);
  const no = await reviewAction(writeAction(), { judge: async () => "no", dataDir: null });
  assert.equal(no.verdict, "ask");
  assert.equal(no.model, true);
  const unsure = await reviewAction(writeAction(), { judge: async () => "unsure", dataDir: null });
  assert.equal(unsure.verdict, "ask");
  const junk = await reviewAction(writeAction(), { judge: async () => "not json", dataDir: null });
  assert.equal(junk.verdict, "ask");
  const throws = await reviewAction(writeAction(), {
    judge: async () => {
      throw new Error("llama down");
    },
    dataDir: null,
  });
  assert.equal(throws.verdict, "ask");
  const missing = await reviewAction(writeAction(), { dataDir: null });
  assert.equal(missing.verdict, "ask");
  assert.match(missing.why, /no model is available/);
});

test("reviewAction resolves the navigation hostname before the rules", async () => {
  const navAction = {
    kind: "browser_navigate",
    args: { url: "https://innocent.example.com/" },
    userRequest: "open the page",
    origin: "user",
    source: "task",
  };
  const privateResolved = await reviewAction(navAction, {
    resolveNav: async () => ({ private: true, host: "innocent.example.com", address: "10.0.0.5" }),
  });
  assert.equal(privateResolved.verdict, "ask");
  assert.equal(privateResolved.rule, "R11");
  const publicResolved = await reviewAction(navAction, {
    resolveNav: async () => ({ private: false, host: "innocent.example.com" }),
  });
  assert.equal(publicResolved.verdict, "allow");
  // A broken resolver fails closed: the card is asked, never skipped.
  const broken = await reviewAction(navAction, {
    resolveNav: async () => {
      throw new Error("dns down");
    },
  });
  assert.equal(broken.verdict, "ask");
  assert.equal(broken.rule, "R11");
  // Other kinds never resolve a hostname.
  const snapshot = await reviewAction(
    { kind: "browser_snapshot", args: {}, userRequest: "read it", origin: "user", source: "task" },
    { resolveNav: async () => ({ private: true, host: "x" }) },
  );
  assert.equal(snapshot.verdict, "allow");
});

test("a destructive action never reaches the model, even for a yes", async () => {
  let called = 0;
  const judge = async () => {
    called += 1;
    return "yes";
  };
  const withIntent = await reviewAction(
    { kind: "delete_note", args: { id: "n1" }, userRequest: "delete the note about taxes", origin: "user", source: "chat" },
    { judge, dataDir: null },
  );
  assert.equal(withIntent.verdict, "ask");
  assert.equal(called, 0, "the model was not consulted");
  const withoutIntent = await reviewAction(
    { kind: "delete_file", args: { path: "a.md" }, userRequest: "summarise my notes", origin: "user", source: "chat" },
    { judge, dataDir: null },
  );
  assert.equal(withoutIntent.verdict, "block");
  assert.equal(called, 0);
});

test("approval tokens: single use, 60 s, bound to the exact action", () => {
  const approvals = createApprovals({ now: () => 1_000_000 });
  const act = writeAction();
  const token = approvals.grant(act);
  assert.equal(approvals.take(act, token), true);
  assert.equal(approvals.take(act, token), false, "single use only");
  const token2 = approvals.grant(act);
  const changed = { ...act, args: { title: "other" } };
  assert.equal(approvals.take(changed, token2), false, "a changed action fails");
  const token3 = approvals.grant(act);
  const later = createApprovals({ now: () => 1_000_000 + 61_000 });
  assert.equal(later.take(act, token3), false, "expired after 60 s");
});

test("guardedRun: allow runs, ask needs an approval, block never runs", async () => {
  let ran = 0;
  const fn = async () => {
    ran += 1;
    return "done";
  };
  const read = { kind: "read_file", args: { path: "/Volumes/Agent/agent/notes/a.md" }, userRequest: "read my notes", origin: "user", source: "task" };
  const allowed = await guardedRun(read, { dataDir: null }, fn);
  assert.equal(allowed.ran, true);
  assert.equal(allowed.result, "done");

  const control = { kind: "computer_click", args: { target: "Finder" }, userRequest: "open Finder", origin: "user", source: "chat" };
  const asked = await guardedRun(control, { dataDir: null }, fn);
  assert.equal(asked.ran, false);
  assert.equal(asked.verdict, "ask");

  const approvals = createApprovals({ now: () => Date.now() });
  const token = approvals.grant(control);
  const approved = await guardedRun({ ...control, approvalToken: token }, { dataDir: null, approvals }, fn);
  assert.equal(approved.ran, true, "a valid one-time approval runs it");
  assert.equal(ran, 2);

  const blocked = await guardedRun({ kind: "hack_mainframe", args: {}, userRequest: "x", origin: "user", source: "chat" }, { dataDir: null }, fn);
  assert.equal(blocked.ran, false);
  assert.equal(blocked.verdict, "block");
});

test("hashAction is stable and sensitive", () => {
  assert.equal(hashAction(writeAction()), hashAction(writeAction()));
  assert.notEqual(hashAction(writeAction()), hashAction({ ...writeAction(), args: { title: "other" } }));
});

test("llamaJudge parses strict JSON and falls back to unsure", async () => {
  const fake = (content) => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content } }] }),
  });
  const yes = await llamaJudge({ llamaUrl: "http://llama", fetchImpl: async () => fake('{"match":"yes","why":"it fits"}') })(writeAction());
  assert.equal(yes, "yes");
  const junk = await llamaJudge({ llamaUrl: "http://llama", fetchImpl: async () => fake("no json here") })(writeAction());
  assert.equal(junk, "unsure");
  const broken = await llamaJudge({
    llamaUrl: "http://llama",
    fetchImpl: async () => {
      throw new Error("down");
    },
  })(writeAction());
  assert.equal(broken, "unsure");
  assert.equal(await llamaJudge({ llamaUrl: "" })(writeAction()), "unsure");
  assert.ok(tieBreakPrompt(writeAction()).length <= 1500);
});

test("task runner: a secrets read is blocked and the next step still runs", async () => {
  const root = tempDir();
  try {
    const task = newTask(root, {
      title: "check the files",
      steps: [
        { text: "read the env file", tool: { name: "read_file", path: "/Volumes/Agent/agent/secrets/.env" } },
        { text: "write the summary" },
      ],
    });
    const calls = [];
    const impl = async (url, init) => {
      calls.push(JSON.parse(init.body));
      return { ok: true, json: async () => ({ choices: [{ message: { content: "second result" } }] }) };
    };
    const finished = await runTask(root, task, { llamaUrl: "http://llama", fetchImpl: impl });
    assert.equal(finished.status, "done");
    assert.match(finished.steps[0].result, /^Blocked by the guard:/);
    assert.equal(finished.steps[0].status, "done");
    assert.equal(finished.steps[1].result, "second result", "the task goes on after a block");
    assert.equal(calls.length, 1, "the model ran only for the surviving step");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
