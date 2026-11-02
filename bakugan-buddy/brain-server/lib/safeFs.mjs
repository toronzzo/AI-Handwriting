/**
 * The only filesystem door Preyas gets: list and read text under the Agent
 * drive. Reads only, no writes, no deletes, a hard size cap, and a path check
 * that also follows symlinks so `../` or a link cannot escape the drive.
 */
import fs from "node:fs";
import path from "node:path";

export const SAFE_ROOT = "/Volumes/Agent";
export const MAX_TEXT_BYTES = 200 * 1024;
export const MAX_LIST = 200;

export class UnsafePathError extends Error {
  constructor(message) {
    super(message);
    this.name = "UnsafePathError";
  }
}

function realRoot(root) {
  try {
    return fs.realpathSync(root);
  } catch {
    return path.resolve(root);
  }
}

/** Resolve `target` under `root`, following symlinks, and refuse anything outside. */
export function resolveSafePath(target, root = SAFE_ROOT) {
  if (typeof target !== "string" || !target.trim()) throw new UnsafePathError("empty path");
  if (target.includes("\0")) throw new UnsafePathError("bad path");
  const base = realRoot(root);
  const candidate = path.resolve(base, target);
  let check = candidate;
  const tail = [];
  while (!fs.existsSync(check)) {
    const parent = path.dirname(check);
    if (parent === check) break;
    tail.unshift(path.basename(check));
    check = parent;
  }
  let real;
  try {
    real = fs.realpathSync(check);
  } catch {
    throw new UnsafePathError("path is not readable");
  }
  const resolved = tail.length ? path.join(real, ...tail) : real;
  if (resolved !== base && !resolved.startsWith(base + path.sep)) {
    throw new UnsafePathError("path is outside the Agent drive");
  }
  return resolved;
}

export function listDir(target, options = {}) {
  const { root = SAFE_ROOT, limit = MAX_LIST } = options;
  const dir = resolveSafePath(target, root);
  if (!fs.existsSync(dir)) throw new UnsafePathError("path not found");
  const stat = fs.statSync(dir);
  if (!stat.isDirectory()) throw new UnsafePathError("not a folder");
  const entries = fs
    .readdirSync(dir, { withFileTypes: true })
    .slice(0, limit)
    .map((entry) => ({ name: entry.name, path: path.join(dir, entry.name), dir: entry.isDirectory() }));
  return { path: dir, entries };
}

export function readTextFile(target, options = {}) {
  const { root = SAFE_ROOT, maxBytes = MAX_TEXT_BYTES } = options;
  const file = resolveSafePath(target, root);
  if (!fs.existsSync(file)) throw new UnsafePathError("path not found");
  const stat = fs.statSync(file);
  if (!stat.isFile()) throw new UnsafePathError("not a file");
  if (stat.size > maxBytes) throw new UnsafePathError(`file is larger than ${maxBytes} bytes`);
  const buffer = fs.readFileSync(file);
  if (buffer.includes(0)) throw new UnsafePathError("file is not text");
  return { path: file, size: stat.size, text: buffer.toString("utf8") };
}
