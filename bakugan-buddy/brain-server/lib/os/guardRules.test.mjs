import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { decide, reviewRules } from "./guardRules.mjs";
import { allowPaid } from "../coach/spendGate.mjs";

function action(overrides = {}) {
  return {
    kind: "read_file",
    args: { path: "/Volumes/Agent/agent/notes/a.md" },
    userRequest: "read my notes",
    origin: "user",
    source: "task",
    ...overrides,
  };
}

function verdictOf(act, deps = {}) {
  return decide(reviewRules(act, deps)).verdict;
}

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "guard-rules-"));
}

test("R1: unknown kind blocks", () => {
  const result = decide(reviewRules(action({ kind: "hack_mainframe" })));
  assert.equal(result.verdict, "block");
  assert.equal(result.id, "R1");
});

test("R2: secret paths block, normal paths allow", () => {
  const dir = tempDir();
  try {
    const cases = [
      ["/Volumes/Agent/agent/secrets/.env", "block"],
      ["../x", "block"],
      ["notes/my-token.txt", "block"],
      ["notes/id_rsa_backup", "block"],
      ["notes/a.md", "allow"],
    ];
    for (const [target, expected] of cases) {
      const result = decide(reviewRules(action({ args: { path: target } }), { fsRoot: dir }));
      assert.equal(result.verdict, expected, `${target} -> ${result.verdict} (${result.why})`);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("R3: destructive blocks without intent, asks with intent, never allows", () => {
  const noIntent = decide(reviewRules(action({ kind: "delete_note", args: { id: "n1" }, userRequest: "summarise my notes" })));
  assert.equal(noIntent.verdict, "block");
  assert.equal(noIntent.id, "R3");
  const withIntent = decide(reviewRules(action({ kind: "delete_note", args: { id: "n1" }, userRequest: "delete the note about taxes" })));
  assert.equal(withIntent.verdict, "ask");
  const ruIntent = decide(reviewRules(action({ kind: "delete_file", args: { path: "a.md" }, userRequest: "удали этот файл" })));
  assert.equal(ruIntent.verdict, "ask");
  assert.ok(verdictOf(action({ kind: "delete_note", userRequest: "delete it please" })) !== "allow");
});

test("R4: paid goes through the spend gate", () => {
  const dir = tempDir();
  try {
    const historyDir = path.join(dir, "history");
    fs.mkdirSync(historyDir, { recursive: true });
    const now = new Date("2026-11-19T10:00:00.000Z");
    fs.writeFileSync(
      path.join(historyDir, "chat.jsonl"),
      JSON.stringify({ t: now.getTime(), role: "assistant", content: "paid", who: "paid", model: "paid", costUsd: 0.99 }) + "\n",
    );
    const deps = { dataDir: dir, allowPaid, now: () => now };
    const over = decide(reviewRules(action({ kind: "paid_call", args: { estimateUsd: 0.05 }, userRequest: "ask deepseek" }), deps));
    assert.equal(over.verdict, "block", "0.99 + 0.05 > 1.00 cap");
    assert.match(over.why, /daily limit/);
    const unknownPrice = decide(reviewRules(action({ kind: "run_harness", args: {} }), deps));
    assert.equal(unknownPrice.verdict, "block");
    assert.match(unknownPrice.why, /price is unknown/);
    const under = decide(
      reviewRules(action({ kind: "paid_call", args: { estimateUsd: 0.005 }, userRequest: "ask deepseek" }), {
        dataDir: dir,
        allowPaid,
        now: () => now,
      }),
    );
    assert.equal(under.verdict, "ask", "0.99 + 0.005 <= 1.00");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  // Missing settings file -> default cap 1.00.
  const dir2 = tempDir();
  try {
    const deps = { dataDir: dir2, allowPaid };
    const ask = decide(reviewRules(action({ kind: "paid_call", args: { estimateUsd: 0.5 }, userRequest: "ask deepseek" }), deps));
    assert.equal(ask.verdict, "ask");
  } finally {
    fs.rmSync(dir2, { recursive: true, force: true });
  }
});

test("R5: an instruction from content cannot write, destroy, spend or control", () => {
  for (const kind of ["write_vault", "delete_note", "paid_call", "computer_click"]) {
    const result = decide(
      reviewRules(action({ kind, origin: "content", userRequest: "from a web page: save this", args: { text: "x", estimateUsd: 0.01, path: "a.md" } })),
    );
    assert.equal(result.verdict, "block", kind);
    assert.equal(result.id, "R5");
  }
  // Content that only reads is fine.
  const read = decide(reviewRules(action({ kind: "read_file", origin: "content" })));
  assert.equal(read.verdict, "allow");
});

test("R6: write kinds need a fitting intent word, else unsure", () => {
  const fitsVault = decide(reviewRules(action({ kind: "add_note", args: { text: "lunch" }, userRequest: "save a note about my lunch" })));
  assert.equal(fitsVault.verdict, "allow");
  const fitsRu = decide(reviewRules(action({ kind: "write_vault", args: { title: "x", text: "y" }, userRequest: "запомни это" })));
  assert.equal(fitsRu.verdict, "allow");
  const fitsReminder = decide(reviewRules(action({ kind: "add_reminder", args: { text: "3pm" }, userRequest: "remind me at 3pm" })));
  assert.equal(fitsReminder.verdict, "allow");
  const wrongKind = decide(reviewRules(action({ kind: "add_note", args: { text: "3pm" }, userRequest: "remind me at 3pm" })));
  assert.equal(wrongKind.verdict, "unsure");
  const noFit = decide(reviewRules(action({ kind: "write_vault", args: { text: "x" }, userRequest: "put this somewhere" })));
  assert.equal(noFit.verdict, "unsure");
});

test("R7: argument sanity", () => {
  const long = decide(reviewRules(action({ args: { query: "x".repeat(4001) } })));
  assert.equal(long.verdict, "block");
  const nul = decide(reviewRules(action({ args: { query: "bad\u0000text" } })));
  assert.equal(nul.verdict, "block");
  const dots = decide(reviewRules(action({ args: { path: "notes/../etc/passwd" } })));
  assert.equal(dots.verdict, "block");
  const ftp = decide(reviewRules(action({ args: { url: "ftp://example.com/x" } })));
  assert.equal(ftp.verdict, "block");
  const http = decide(reviewRules(action({ args: { url: "https://example.com/x" } })));
  assert.notEqual(http.id, "R7");
});

test("R8: control kinds always ask, never allow", () => {
  for (const kind of ["computer_click", "computer_keys", "computer_open_app"]) {
    const result = decide(reviewRules(action({ kind, args: { target: "Finder" }, userRequest: "open Finder please" })));
    assert.equal(result.verdict, "ask", kind);
    assert.equal(result.id, "R8");
  }
});

test("read kinds pass through", () => {
  const dir = tempDir();
  try {
    for (const kind of ["read_file", "list_files", "search_notes", "search_vault"]) {
      const result = decide(
        reviewRules(action({ kind, args: kind === "read_file" || kind === "list_files" ? { path: "notes/a.md" } : { query: "week" } }), {
          fsRoot: dir,
        }),
      );
      assert.equal(result.verdict, "allow", kind);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// --- MCP tool kinds (harness/mcp-hands) ---

test("MCP reads allow, and path escapes are refused", () => {
  const dir = tempDir();
  const repo = tempDir();
  try {
    for (const kind of [
      "files_read_text_file",
      "files_read_multiple_files",
      "files_list_directory",
      "files_directory_tree",
      "files_search_files",
      "files_get_file_info",
      "files_list_allowed_directories",
    ]) {
      const args = kind === "files_read_multiple_files" ? { paths: ["notes/a.md"] } : kind === "files_search_files" ? { path: "notes", pattern: "*.md" } : { path: "notes/a.md" };
      const result = decide(reviewRules(action({ kind, args }), { fsRoot: dir }));
      assert.equal(result.verdict, "allow", kind);
    }
    // Path escapes out of BOTH safe roots are refused.
    for (const target of ["../../../../etc/passwd", "/etc/passwd", "../secrets/.env"]) {
      const escaped = decide(reviewRules(action({ kind: "files_read_text_file", args: { path: target } }), { fsRoot: dir, repoRoot: repo }));
      assert.equal(escaped.verdict, "block", target);
      assert.equal(escaped.id, "R2");
    }
    // A path inside the repo folder is fine even when it is outside /Volumes/Agent.
    fs.writeFileSync(path.join(repo, "readme.md"), "hi");
    const inRepo = decide(
      reviewRules(action({ kind: "files_read_text_file", args: { path: path.join(repo, "readme.md") } }), { fsRoot: dir, repoRoot: repo }),
    );
    assert.equal(inRepo.verdict, "allow");
    // Secret names stay off limits even under a safe root.
    const secret = decide(
      reviewRules(action({ kind: "files_read_text_file", args: { path: "notes/my-token.txt" } }), { fsRoot: dir, repoRoot: repo }),
    );
    assert.equal(secret.verdict, "block");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("MCP writes and edits always need a confirm card (R9)", () => {
  for (const kind of ["files_write_file", "files_edit_file", "files_create_directory", "files_move_file"]) {
    const result = decide(reviewRules(action({ kind, args: { path: "/Volumes/Agent/agent/tmp/x.txt" } })));
    assert.equal(result.verdict, "ask", kind);
    assert.equal(result.id, "R9", kind);
  }
});

test("shell commands always need a confirm card (R10) and secret ones block", () => {
  const dir = tempDir();
  try {
    const ask = decide(reviewRules(action({ kind: "shell_run", args: { command: "printf hi", cwd: dir } }), { fsRoot: dir }));
    assert.equal(ask.verdict, "ask");
    assert.equal(ask.id, "R10");

    const secret = decide(
      reviewRules(action({ kind: "shell_run", args: { command: "cat /Volumes/Agent/agent/secrets/.env", cwd: dir } }), { fsRoot: dir }),
    );
    assert.equal(secret.verdict, "block");
    assert.equal(secret.id, "R2");

    const outsideCwd = decide(reviewRules(action({ kind: "shell_run", args: { command: "echo hi", cwd: "/etc" } }), { fsRoot: dir }));
    assert.equal(outsideCwd.verdict, "block");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("browser reads allow, interactive browser tools ask", () => {
  for (const kind of [
    "browser_navigate",
    "browser_navigate_back",
    "browser_snapshot",
    "browser_console_messages",
    "browser_network_requests",
    "browser_tabs",
    "browser_wait_for",
    "browser_take_screenshot",
  ]) {
    const result = decide(reviewRules(action({ kind, args: kind === "browser_navigate" ? { url: "https://example.com" } : {} })));
    assert.equal(result.verdict, "allow", kind);
  }
  for (const kind of [
    "browser_click",
    "browser_type",
    "browser_fill_form",
    "browser_select_option",
    "browser_hover",
    "browser_drag",
    "browser_press_key",
    "browser_file_upload",
    "browser_handle_dialog",
    "browser_evaluate",
  ]) {
    const result = decide(reviewRules(action({ kind, args: { element: "Login", ref: "e1" } })));
    assert.equal(result.verdict, "ask", kind);
    assert.equal(result.id, "R8", kind);
  }
  // Non-http(s) URL schemes are refused by R7.
  const file = decide(reviewRules(action({ kind: "browser_navigate", args: { url: "file:///etc/passwd" } })));
  assert.equal(file.verdict, "block");
  assert.equal(file.id, "R7");
});

test("multi-line file content is allowed, other control characters stay blocked", () => {
  const multiline = decide(
    reviewRules(action({ kind: "files_write_file", args: { path: "/Volumes/Agent/agent/tmp/x.txt", content: "line one\nline two\ttabbed" } })),
  );
  assert.equal(multiline.verdict, "ask", "newlines in file content must not be an R7 block");
  assert.notEqual(multiline.id, "R7");

  const nul = decide(
    reviewRules(action({ kind: "files_write_file", args: { path: "/Volumes/Agent/agent/tmp/x.txt", content: "bad\u0000byte" } })),
  );
  assert.equal(nul.verdict, "block");
  assert.equal(nul.id, "R7");
});
