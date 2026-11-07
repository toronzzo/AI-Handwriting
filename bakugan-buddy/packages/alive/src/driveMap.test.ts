import assert from "node:assert/strict";
import test from "node:test";
import {
  driveMapPrompt,
  isDriveQuestion,
  isScanDriveCommand,
  isSpaceQuestion,
  searchDriveMap,
  whereIsQuery,
  type DriveMap,
} from "./driveMap.ts";
import { shouldWebSearch } from "./webSearch.ts";

const map: DriveMap = {
  root: "/Volumes/Agent",
  scanned: 1699000000000,
  totalSize: 10 * 1024 * 1024 * 1024,
  totalFiles: 1234,
  folders: [
    { name: "agent", path: "agent", size: 5000, files: 40, modified: 1, examples: ["env.sh"] },
    { name: "models", path: "agent/models", size: 1000, files: 3, modified: 1, examples: ["ripple-body/weights.npz"] },
    { name: "BakuganBuddy", path: "BakuganBuddy", size: 8000, files: 120, modified: 1, examples: ["README.txt"] },
    { name: "vault", path: "BakuganBuddy/vault", size: 700, files: 130, modified: 1, examples: ["Preyas.md", "Reminders.md"] },
  ],
  models: [
    { name: "Huihui-Qwen3-8B-abliterated-v2.Q4_K_M.gguf", path: "BakuganBuddy/models/Huihui-Qwen3-8B-abliterated-v2.Q4_K_M.gguf", size: 5027780352, type: "gguf" },
    { name: "weights.npz", path: "agent/models/ripple-body/weights.npz", size: 123, type: "npz" },
  ],
};

test("scan my drive is a refresh command, not a web question", () => {
  assert.equal(isScanDriveCommand("scan my drive"), true);
  assert.equal(isScanDriveCommand("please scan the drive"), true);
  assert.equal(isScanDriveCommand("scan my vault"), false);
  assert.equal(isDriveQuestion("scan my drive"), true);
});

test("space questions are recognised", () => {
  assert.equal(isSpaceQuestion("how much space is left"), true);
  assert.equal(isSpaceQuestion("how much free space do I have"), true);
  assert.equal(isDriveQuestion("how much space is left"), true);
});

test("where is X pulls out the target", () => {
  assert.equal(whereIsQuery("where is my model"), "model");
  assert.equal(whereIsQuery("where are my datasets?"), "datasets");
  assert.equal(whereIsQuery("what's on my drive"), null);
});

test("drive questions are detected", () => {
  for (const text of [
    "what's on my drive",
    "what is on my drive",
    "scan my drive",
    "how much space is left",
    "where is my model",
    "what models do I have",
    "list my datasets",
    "what files are on the drive",
    "show my folders",
  ]) {
    assert.equal(isDriveQuestion(text), true, text);
  }
  for (const text of ["how are you", "what's the weather", "tell me a joke", "remember to buy milk"]) {
    assert.equal(isDriveQuestion(text), false, text);
  }
});

test("drive questions never trigger a web search", () => {
  for (const text of [
    "what's on my drive",
    "where is my model",
    "how much space is left",
    "scan my drive",
    "what datasets do I have",
    "where is the latest model", // "latest" is a web hint, but the drive wins
  ]) {
    assert.equal(shouldWebSearch(text), false, text);
  }
  // A genuine fresh-fact question still searches.
  assert.equal(shouldWebSearch("what is the latest news"), true);
});

test("where is X searches folder names, example files and models", () => {
  const hits = searchDriveMap(map, "model");
  const names = hits.map((hit) => `${hit.path}/${hit.name}`);
  assert.ok(names.some((n) => n.includes("agent/models")), "finds the models folder");
  assert.ok(names.some((n) => n.includes(".gguf")), "finds the gguf model");
  assert.equal(searchDriveMap(map, "does-not-exist").length, 0);
});

test("the prompt snippet is small and names the folders and models", () => {
  const text = driveMapPrompt(map);
  assert.ok(text.includes("BakuganBuddy/vault"));
  assert.ok(text.includes(".gguf"));
  assert.ok(text.length < 4000, `prompt should stay small, got ${text.length}`);
});

test("a where-is focus lists the matches first", () => {
  const text = driveMapPrompt(map, "model");
  assert.ok(text.includes('matching "model"'));
});
