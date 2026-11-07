/**
 * The drive map: a read-only index of what lives on the Agent drive.
 *
 * Rules kept here:
 *  - never read file contents, only names, sizes and dates;
 *  - never write, move or delete anything on the drive except the map file
 *    itself (memory/drive-map.json);
 *  - skip hidden files and folders, node_modules, .git, secrets/ and cache
 *    internals, and never follow symlinks (so `secrets` and `venv` aliases are
 *    never entered);
 *  - stop at three levels deep.
 */
import fs from "node:fs";
import path from "node:path";

export const DRIVE_ROOT = "/Volumes/Agent";
export const MAX_DEPTH = 3;

const MODEL_EXT = new Set([".gguf", ".safetensors", ".ggml", ".onnx", ".pt", ".pth", ".npz", ".bin"]);
const SKIP_NAMES = new Set(["node_modules", ".git", ".obsidian", "secrets", "__pycache__"]);

// Top-level folders plus the key subfolders Preyas is expected to name.
const KEY_FOLDERS = [
  "agent/repos",
  "agent/models",
  "agent/datasets",
  "agent/training",
  "agent/cache",
  "BakuganBuddy/documents",
  "BakuganBuddy/vault",
];

function modelType(name) {
  const ext = path.extname(String(name || "")).toLowerCase();
  if (ext === ".gguf") return "gguf";
  if (ext === ".safetensors") return "safetensors";
  if (ext === ".ggml") return "ggml";
  if (ext === ".onnx") return "onnx";
  if (ext === ".pt" || ext === ".pth") return "pt";
  if (ext === ".npz") return "npz";
  if (ext === ".bin") return "bin";
  return "";
}

function isHidden(name) {
  return String(name).startsWith(".");
}

function shouldSkip(name, depth) {
  const lower = String(name).toLowerCase();
  if (isHidden(name) || SKIP_NAMES.has(lower)) return true;
  // Cache internals are skipped; a "cache" folder below the top is not walked.
  if (lower === "cache" && depth > 0) return true;
  return false;
}

/**
 * Walk one directory and aggregate size, file count, latest mtime, a few
 * example file names and any model files. Never follows symlinks. `base` is
 * the scan root, so model paths stay relative to the drive, not this folder.
 */
function aggregate(root, depth, base = root) {
  const out = { size: 0, files: 0, modified: 0, examples: [], models: [] };
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const name = entry.name;
    if (shouldSkip(name, depth)) continue;
    if (entry.isSymbolicLink()) continue; // never follow secrets/venv aliases
    const full = path.join(root, name);
    if (entry.isDirectory()) {
      if (depth >= MAX_DEPTH) continue;
      const sub = aggregate(full, depth + 1, base);
      out.size += sub.size;
      out.files += sub.files;
      out.modified = Math.max(out.modified, sub.modified);
      out.models.push(...sub.models);
      for (const example of sub.examples) {
        if (out.examples.length < 5) out.examples.push(`${name}/${example}`);
      }
    } else if (entry.isFile()) {
      let size = 0;
      let mtime = 0;
      try {
        const st = fs.statSync(full);
        size = st.size;
        mtime = st.mtimeMs;
      } catch {
        /* a file that vanished mid-scan is fine to skip */
      }
      out.size += size;
      out.files += 1;
      out.modified = Math.max(out.modified, mtime);
      if (out.examples.length < 5) out.examples.push(name);
      const type = modelType(name);
      if (type) out.models.push({ name, path: full.slice(base.length + 1), size, type });
    }
  }
  return out;
}

/**
 * One-level stat for a "cache" folder: count immediate files and their sizes,
 * but never descend into the cache internals.
 */
function shallowStat(root) {
  const out = { size: 0, files: 0, modified: 0, examples: [], models: [] };
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (isHidden(entry.name) || SKIP_NAMES.has(entry.name.toLowerCase())) continue;
    if (entry.isSymbolicLink() || entry.isDirectory()) continue;
    let size = 0;
    let mtime = 0;
    try {
      const st = fs.statSync(path.join(root, entry.name));
      size = st.size;
      mtime = st.mtimeMs;
    } catch {
      /* skip */
    }
    out.size += size;
    out.files += 1;
    out.modified = Math.max(out.modified, mtime);
    if (out.examples.length < 5) out.examples.push(entry.name);
  }
  return out;
}

/** Names of the non-hidden, non-skipped directories directly under `root`. */
function topLevelDirs(root) {
  const names = [];
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return names;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    if (isHidden(entry.name) || SKIP_NAMES.has(entry.name.toLowerCase())) continue;
    names.push(entry.name);
  }
  return names;
}

/**
 * Build the map object for one root. Pure over the filesystem, so tests run it
 * against a temp folder. Returns { root, scanned, totalSize, totalFiles,
 * folders, models }.
 */
export function scanDrive(root = DRIVE_ROOT, options = {}) {
  const now = options.now || Date.now();
  const folders = [];
  const models = [];
  let totalSize = 0;
  let totalFiles = 0;

  for (const name of topLevelDirs(root)) {
    const stats = aggregate(path.join(root, name), 1, root);
    folders.push({ name, path: name, size: stats.size, files: stats.files, modified: stats.modified, examples: stats.examples });
    models.push(...stats.models);
    totalSize += stats.size;
    totalFiles += stats.files;
  }

  for (const key of KEY_FOLDERS) {
    const full = path.join(root, key);
    let stats;
    try {
      // Key folders sit at a known depth; walk them with the same depth budget
      // as the top-level pass so they never look deeper than three levels.
      stats = key.endsWith("cache") ? shallowStat(full) : aggregate(full, key.split("/").length, root);
    } catch {
      continue;
    }
    folders.push({
      name: path.basename(key),
      path: key,
      size: stats.size,
      files: stats.files,
      modified: stats.modified,
      examples: stats.examples,
    });
    models.push(...stats.models);
  }

  // Models were collected twice (top level and key folders); keep one per path.
  const seenModels = new Map();
  for (const model of models) seenModels.set(model.path, model);

  return {
    root,
    scanned: now,
    totalSize,
    totalFiles,
    folders,
    models: [...seenModels.values()].sort((a, b) => b.size - a.size),
  };
}

/** Where the map is written, next to notes and tasks. */
export function driveMapFile(dataDir) {
  return path.join(dataDir, "memory", "drive-map.json");
}

/** Scan the drive and write memory/drive-map.json. Returns the map. */
export function buildDriveMap(root = DRIVE_ROOT, dataDir, options = {}) {
  const map = scanDrive(root, options);
  if (dataDir) {
    const file = driveMapFile(dataDir);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(map, null, 2));
  }
  return map;
}

/** Read the last written map, or null when it does not exist yet. */
export function loadDriveMap(dataDir) {
  if (!dataDir) return null;
  try {
    return JSON.parse(fs.readFileSync(driveMapFile(dataDir), "utf8"));
  } catch {
    return null;
  }
}
