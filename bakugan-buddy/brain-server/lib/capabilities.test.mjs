import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildSummary, createCapabilities, estimateTokens, SUMMARY_TOKEN_BUDGET } from "./capabilities.mjs";

function workspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "preyas-caps-"));
  const repoRoot = path.join(root, "bakugan-buddy");
  const buddyRoot = path.join(root, "BakuganBuddy");
  const agentRoot = path.join(root, "agent");
  const modelsDir = path.join(buddyRoot, "models");
  const zimDir = path.join(agentRoot, "knowledge", "zim");
  fs.mkdirSync(modelsDir, { recursive: true });
  fs.mkdirSync(zimDir, { recursive: true });
  fs.mkdirSync(path.join(agentRoot, "bin"), { recursive: true });
  fs.mkdirSync(path.join(agentRoot, "art"), { recursive: true });
  fs.mkdirSync(path.join(repoRoot, "apps", "mobile", "assets", "sounds"), { recursive: true });
  for (const file of [
    "Huihui-Qwen3-8B-abliterated-v2.Q4_K_M.gguf",
    "Huihui-Qwen3-14B-abliterated-v2.Q4_K_M.gguf",
    "Qwen3-30B-A3B.Q3_K_M.gguf",
    "Qwen3.5-0.8B-Q4_K_M.gguf",
  ]) {
    fs.writeFileSync(path.join(modelsDir, file), "test");
  }
  fs.writeFileSync(path.join(zimDir, "wiki.zim"), "test");
  fs.writeFileSync(path.join(agentRoot, "bin", "kiwix-serve"), "test");
  for (const slot of ["hero", "bg", "house"]) fs.writeFileSync(path.join(agentRoot, "art", slot + ".png"), "test");
  for (const sound of ["pop-open", "laugh", "gasp"]) fs.writeFileSync(path.join(repoRoot, "apps", "mobile", "assets", "sounds", sound + ".wav"), "test");
  return { root, repoRoot, buddyRoot, agentRoot, modelsDir, zimDir, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

function changelog() {
  return Array.from({ length: 6 }, (_, index) => ({
    id: "2026-11-21|I can now thing " + index + ".",
    date: "2026-11-21",
    text: "I can now thing " + index + ".",
    pr: 100 + index,
  }));
}

function build(w, overrides = {}) {
  const enabled = {
    servers: {
      files: { enabled: true },
      shell: { enabled: true },
      browser: { enabled: true },
    },
  };
  return createCapabilities({
    dataDir: path.join(w.root, "data"),
    repoRoot: w.repoRoot,
    buddyRoot: w.buddyRoot,
    agentRoot: w.agentRoot,
    modelsDir: w.modelsDir,
    zimDir: w.zimDir,
    changelogItems: changelog(),
    secretsText: "DEEPSEEK_API_KEY=sk-test\n",
    env: { PATH: "/usr/bin:/bin" },
    mcpConfig: enabled,
    browserReady: true,
    pathExists: (file) => !file.includes("server-filesystem"),
    checkService: async (spec) => spec.id !== "web",
    currentModel: () => "small",
    now: () => new Date("2026-11-21T12:00:00Z"),
    ...overrides,
  });
}

test("capabilities list only what is really there (a missing tool is not listed)", async () => {
  const w = workspace();
  try {
    const caps = await build(w).refresh();
    const tools = caps.tools.map((row) => row.id);
    assert.deepEqual(tools, ["terminal", "browser", "offline_search", "web_search"]);
    assert.ok(!tools.includes("files"), "the missing files package must not be listed");
    assert.equal(caps.tools.find((row) => row.id === "terminal").label, "Terminal");

    const modelIds = caps.models.map((row) => row.id);
    assert.deepEqual(modelIds, ["small", "big", "huge", "tiny", "paid"]);
    assert.equal(caps.models.find((row) => row.id === "small").current, true);
    assert.equal(caps.models.find((row) => row.id === "groq"), undefined, "no Groq key, so no Groq");

    const media = caps.media.map((row) => row.id);
    assert.deepEqual(media, ["sounds", "images"]);
    assert.equal(caps.services.find((row) => row.id === "web").running, false);
    assert.equal(caps.services.find((row) => row.id === "brain").running, true);
    assert.equal(caps.builtAt, "2026-11-21T12:00:00.000Z");
  } finally {
    w.cleanup();
  }
});

test("the compact summary stays under the token budget and keeps the honesty rule", async () => {
  const w = workspace();
  try {
    const caps = await build(w).refresh();
    assert.ok(caps.summary.includes('I can\'t do that yet.'));
    assert.ok(caps.summary.includes("Newest changes:"));
    assert.ok(caps.summary.includes("I can now thing 0."), "newest changelog entry");
    assert.ok(!caps.summary.includes("I can now thing 5."), "only the newest five ride along");
    assert.ok(estimateTokens(caps.summary) <= SUMMARY_TOKEN_BUDGET, estimateTokens(caps.summary) + " tokens");
  } finally {
    w.cleanup();
  }
});

test("a disabled tool and a missing model are not claimed", async () => {
  const w = workspace();
  try {
    fs.rmSync(path.join(w.modelsDir, "Qwen3-30B-A3B.Q3_K_M.gguf"));
    const caps = await build(w, {
      mcpConfig: { servers: { files: { enabled: true }, shell: { enabled: false }, browser: { enabled: true } } },
      pathExists: (file) =>
        file.includes("server-filesystem") || file.includes("terminalServer") || file.includes("@playwright") || fs.existsSync(file),
    }).refresh();
    const tools = caps.tools.map((row) => row.id);
    assert.ok(tools.includes("files"));
    assert.ok(!tools.includes("terminal"), "terminal is disabled in the config");
    assert.ok(!caps.models.some((row) => row.id === "huge"), "a missing 30B file is not listed");
  } finally {
    w.cleanup();
  }
});

test("offline search needs packs and the kiwix program; a Groq key adds Groq", async () => {
  const w = workspace();
  try {
    fs.rmSync(path.join(w.zimDir, "wiki.zim"));
    let caps = await build(w, { env: { PATH: "/usr/bin:/bin", GROQ_API_KEY: "gsk_abcdefghijklmnop" } }).refresh();
    assert.ok(!caps.tools.some((row) => row.id === "offline_search"), "no packs, no offline search");
    assert.ok(caps.models.some((row) => row.id === "groq"), "a valid Groq key is listed");
  } finally {
    w.cleanup();
  }
});

test("buildSummary never exceeds its character limit and keeps the instruction", () => {
  const long = "I can now do a very long thing that should perhaps not be in the prompt. ".repeat(30);
  const summary = buildSummary(
    {
      tools: [{ label: "Files" }],
      models: [{ label: "8B local" }],
      media: [{ label: "Reaction sounds" }],
      services: [{ label: "brain-server", running: true }],
      changelog: [{ text: long }],
    },
    500,
  );
  assert.ok(summary.length <= 500, summary.length);
  assert.ok(summary.includes("I can't do that yet."));
});
