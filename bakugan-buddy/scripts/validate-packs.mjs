#!/usr/bin/env node
/**
 * Validate character packs against packages/mood/moods.schema.json + pack.schema.json rules.
 * No network. Zero deps — keeps CI light.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packsDir = path.join(root, "packages/character-packs");
const moodsSchema = JSON.parse(
  fs.readFileSync(path.join(root, "packages/mood/moods.schema.json"), "utf8"),
);
const packSchema = JSON.parse(
  fs.readFileSync(path.join(packsDir, "pack.schema.json"), "utf8"),
);

const MOODS = new Set(moodsSchema.enum);
const required = packSchema.required || ["id", "name", "allowedMoods"];
let errors = 0;

function fail(file, msg) {
  console.error(`FAIL ${file}: ${msg}`);
  errors += 1;
}

function ok(file, msg) {
  console.log(`OK   ${file}: ${msg}`);
}

function validatePack(file, data) {
  for (const key of required) {
    if (data[key] == null || data[key] === "") {
      fail(file, `missing required "${key}"`);
    }
  }
  if (typeof data.id !== "string" || !data.id.trim()) fail(file, "id must be non-empty string");
  if (typeof data.name !== "string" || !data.name.trim()) fail(file, "name must be non-empty string");

  const moods = data.allowedMoods;
  if (!Array.isArray(moods) || moods.length < 1) {
    fail(file, "allowedMoods must be a non-empty array");
    return;
  }
  const seen = new Set();
  for (const m of moods) {
    if (typeof m !== "string") {
      fail(file, `mood not a string: ${JSON.stringify(m)}`);
      continue;
    }
    if (!MOODS.has(m)) fail(file, `unknown mood "${m}" (not in moods.schema.json)`);
    if (seen.has(m)) fail(file, `duplicate mood "${m}"`);
    seen.add(m);
  }
  ok(file, `${moods.length} moods`);
}

function validateExamples(file) {
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean);
  let n = 0;
  for (const [i, line] of lines.entries()) {
    let row;
    try {
      row = JSON.parse(line);
    } catch (e) {
      fail(file, `line ${i + 1}: invalid JSON`);
      continue;
    }
    if (!row.mood || !MOODS.has(row.mood)) {
      fail(file, `line ${i + 1}: bad mood "${row.mood}"`);
    }
    if (typeof row.text !== "string" || !row.text.trim()) {
      fail(file, `line ${i + 1}: missing text`);
    }
    n += 1;
  }
  ok(path.relative(root, file), `${n} examples`);
}

function validateVoices(file, data) {
  const moods = data.moods || data;
  if (!moods || typeof moods !== "object") {
    fail(file, "expected moods object");
    return;
  }
  for (const key of Object.keys(moods)) {
    // skip non-mood top-level keys when file is a voice pack wrapper
    if (["id", "engineDefault", "kokoro", "engine"].includes(key) && !data.moods) continue;
  }
  const map = data.moods || {};
  for (const key of Object.keys(map)) {
    if (!MOODS.has(key)) fail(file, `voices mood key "${key}" not canonical`);
  }
  ok(file, `${Object.keys(map).length} voice moods`);
}

const packFiles = fs
  .readdirSync(packsDir)
  .filter((f) => f.endsWith(".json") && !f.endsWith(".schema.json") && !f.endsWith(".voices.json"));

for (const f of packFiles) {
  const full = path.join(packsDir, f);
  validatePack(f, JSON.parse(fs.readFileSync(full, "utf8")));
}

for (const f of fs.readdirSync(packsDir).filter((x) => x.endsWith(".voices.json"))) {
  validateVoices(f, JSON.parse(fs.readFileSync(path.join(packsDir, f), "utf8")));
}

const examplesDir = path.join(packsDir, "examples");
if (fs.existsSync(examplesDir)) {
  for (const f of fs.readdirSync(examplesDir).filter((x) => x.endsWith(".jsonl"))) {
    validateExamples(path.join(examplesDir, f));
  }
}

if (errors) {
  console.error(`\n${errors} pack schema error(s)`);
  process.exit(1);
}
console.log("\nAll character packs valid against mood schema.");
