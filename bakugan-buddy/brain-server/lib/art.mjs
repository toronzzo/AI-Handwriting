/**
 * The user's own pictures (slice 10): a fixed whitelist of slots, each one
 * file named <slot>.jpg|jpeg|png|webp, looked for in a fixed list of folders.
 * Preyas never writes an image and nothing here ever leaves the Agent drive.
 *
 * Slice 10b adds one write and only one: `saveArt` takes a picture the user
 * picked in the app and puts it in the art folder as <slot>.<ext>. An older
 * picture is never deleted; it is moved to art/old/ with the time in its name,
 * so the user can always get it back.
 *
 * The whitelist is checked BEFORE the disk is touched, and every path goes
 * through resolveSafePath so a symlink or `../` cannot escape the drive.
 * Nothing is cached: drop a picture in and it shows up on the next request.
 */
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { resolveSafePath } from "./safeFs.mjs";

/** The seven fixed slots, in display order. Anything else is a bad request. */
export const SLOT_IDS = ["hero", "bg", "house", "car", "study", "bakugan-buddy", "studio"];

/** The folders searched for a picture, first match wins. */
export const ART_ROOTS = ["/Volumes/Agent/agent/art", "/Volumes/Agent/agent/prototypes/images"];

/** Extensions tried for a slot, in this order. */
export const ART_EXTENSIONS = ["jpg", "jpeg", "png", "webp"];

/**
 * The drive a picture must really live on. A slot name has no separator, so
 * `../../etc/passwd` is refused before the disk; within a folder the file name
 * is fixed too, so `..` is impossible there. The file itself is then
 * re-resolved under this boundary with resolveSafePath, which is what stops a
 * symlink pointing out of the drive.
 *
 * It is `/Volumes/Agent` on the Mac, and the only reason it can be anything
 * else is a test that has no drive (CI): `ART_ROOT` lets the test scope the
 * boundary to its own temp folder, so the check still runs, just inside a
 * folder the test owns. Set it once, at the top of a test file, never in the
 * running app.
 */
export const ART_ROOT = "/Volumes/Agent";

/** The drive boundary in force; see ART_ROOT. */
export function artRoot() {
  return process.env.PREYAS_ART_ROOT || ART_ROOT;
}

/** 8 MB: bigger files are ignored rather than streamed. */
export const MAX_ART_BYTES = 8 * 1024 * 1024;

const TYPES = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

/** True for a slot name on the whitelist. Never looks at the disk. */
export function isSlot(slot) {
  return typeof slot === "string" && SLOT_IDS.includes(slot);
}

/**
 * Find the picture for one slot.
 * @returns {{ path: string, type: string, size: number } | null} The file to
 *   stream, or null when the slot has no picture (missing, too big, or a
 *   folder that escapes the drive).
 * @throws {UnsafePathError} only for a slot name that is not on the whitelist;
 *   callers turn that into a 400. Slot names are checked before any fs call.
 */
export function findArt(slot, roots = ART_ROOTS) {
  if (!isSlot(slot)) throw new TypeError(`unknown art slot: ${String(slot)}`);
  for (const root of roots) {
    for (const ext of ART_EXTENSIONS) {
      const name = `${slot}.${ext}`;
      let file;
      try {
        file = resolveSafePath(name, root);
        // Second lock: the real file must still sit inside the drive.
        resolveSafePath(file, artRoot());
      } catch {
        // A link outside the drive, or a path we cannot read: no picture here.
        continue;
      }
      let stat;
      try {
        stat = fs.statSync(file);
      } catch {
        continue;
      }
      if (!stat.isFile()) continue;
      if (stat.size <= 0 || stat.size > MAX_ART_BYTES) continue;
      return { path: file, type: TYPES[ext], size: stat.size };
    }
  }
  return null;
}

/**
 * The one folder the app may write to (slice 10b). The read roots above are
 * looked at as well, but a new picture always lands here, because this is the
 * first root findArt searches.
 */
export const ART_WRITE_DIR = "/Volumes/Agent/agent/art";

/** Where an older picture is parked instead of being deleted. */
export const ART_OLD_DIR = "old";

/**
 * What the file really is, judged by the first bytes only. The client's
 * Content-Type and its file name are never trusted: a text file renamed .png
 * is still a text file, and a .jpg full of HTML is refused.
 * @returns {{ ext: string, type: string } | null} null for anything that is not a picture.
 */
export function sniffImageType(bytes) {
  if (!bytes || typeof bytes.length !== "number" || bytes.length < 12) return null;
  const at = (index) => bytes[index];
  // jpeg: FF D8 FF
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return { ext: "jpg", type: TYPES.jpg };
  // png: 89 50 4E 47
  if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) {
    return { ext: "png", type: TYPES.png };
  }
  // webp: "RIFF" .... "WEBP"
  const word = (start, text) => {
    for (let i = 0; i < text.length; i++) {
      if (at(start + i) !== text.charCodeAt(i)) return false;
    }
    return true;
  };
  if (word(0, "RIFF") && word(8, "WEBP")) return { ext: "webp", type: TYPES.webp };
  return null;
}

/** <slot>-YYYYMMDD-HHMMSS in local time: 20261119-143005. */
function stampName(slot, ext, when) {
  const pad = (n) => String(n).padStart(2, "0");
  const day = `${when.getFullYear()}${pad(when.getMonth() + 1)}${pad(when.getDate())}`;
  const clock = `${pad(when.getHours())}${pad(when.getMinutes())}${pad(when.getSeconds())}`;
  return `${slot}-${day}-${clock}.${ext}`;
}

/**
 * Keep a picture the user picked: write it as <slot>.<ext> in the art folder,
 * moving any older picture of that slot into art/old/ first.
 *
 * Rules, in order:
 * - a slot not on the whitelist is a TypeError before any fs call;
 * - the type comes from the first bytes only (jpeg, png, webp), anything else
 *   is refused, as is an empty file or one over MAX_ART_BYTES;
 * - every path goes through resolveSafePath and must stay inside `dir`;
 * - an older file is renamed to dir/old/<slot>-<time>.<ext>, never unlinked,
 *   and when that name is taken the next free "-2", "-3" … is used;
 * - the new bytes go to a temp name inside `dir` first and are then renamed,
 *   so a half-written file is never served.
 *
 * @returns {{ path: string, type: string, size: number }} the new picture.
 */
export function saveArt(slot, bytes, options = {}) {
  const { dir = ART_WRITE_DIR, now = () => new Date() } = options;
  if (!isSlot(slot)) throw new TypeError(`unknown art slot: ${String(slot)}`);

  const buffer =
    bytes instanceof Uint8Array
      ? Buffer.isBuffer(bytes)
        ? bytes
        : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
      : null;
  if (!buffer) throw new TypeError("picture bytes expected");
  if (buffer.length === 0) throw new RangeError("picture is empty");
  if (buffer.length > MAX_ART_BYTES) throw new RangeError(`picture is over ${MAX_ART_BYTES} bytes`);
  const kind = sniffImageType(buffer);
  if (!kind) throw new TypeError("not a jpeg, png or webp picture");

  fs.mkdirSync(dir, { recursive: true });
  const root = resolveSafePath(dir, dir);
  const oldDir = resolveSafePath(ART_OLD_DIR, root);
  fs.mkdirSync(oldDir, { recursive: true });

  // Park every older picture of this slot, whatever its extension.
  const when = now();
  for (const ext of ART_EXTENSIONS) {
    const target = resolveSafePath(`${slot}.${ext}`, root);
    let stat;
    try {
      stat = fs.lstatSync(target);
    } catch {
      continue; // nothing there
    }
    if (stat.isDirectory()) continue; // not ours to move
    let name = stampName(slot, ext, when);
    let parked = resolveSafePath(path.join(ART_OLD_DIR, name), root);
    for (let n = 2; fs.existsSync(parked); n++) {
      name = `${stampName(slot, ext, when).slice(0, -(ext.length + 1))}-${n}.${ext}`;
      parked = resolveSafePath(path.join(ART_OLD_DIR, name), root);
    }
    fs.renameSync(target, parked);
  }

  // Write next to the target, then rename: no reader ever sees a partial file.
  const final = resolveSafePath(`${slot}.${kind.ext}`, root);
  const temp = resolveSafePath(`${slot}.${kind.ext}.${randomUUID()}.tmp`, root);
  try {
    fs.writeFileSync(temp, buffer, { mode: 0o644 });
    fs.renameSync(temp, final);
  } finally {
    try {
      if (fs.existsSync(temp)) fs.unlinkSync(temp);
    } catch {
      /* a leftover temp file is harmless and is the only thing we would remove */
    }
  }
  return { path: final, type: kind.type, size: buffer.length };
}
