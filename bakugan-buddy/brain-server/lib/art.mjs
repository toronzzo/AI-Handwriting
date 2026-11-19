/**
 * The user's own pictures (slice 10): a fixed whitelist of slots, each one
 * file named <slot>.jpg|jpeg|png|webp, looked for in a fixed list of folders.
 * Read-only. Preyas never writes an image and nothing here ever leaves the
 * Agent drive.
 *
 * The whitelist is checked BEFORE the disk is touched, and every path goes
 * through resolveSafePath so a symlink or `../` cannot escape the drive.
 * Nothing is cached: drop a picture in and it shows up on the next request.
 */
import fs from "node:fs";
import { resolveSafePath } from "./safeFs.mjs";

/** The seven fixed slots, in display order. Anything else is a bad request. */
export const SLOT_IDS = ["hero", "bg", "house", "car", "study", "bakugan-buddy", "studio"];

/** The folders searched for a picture, first match wins. */
export const ART_ROOTS = ["/Volumes/Agent/agent/art", "/Volumes/Agent/agent/prototypes/images"];

/** Extensions tried for a slot, in this order. */
export const ART_EXTENSIONS = ["jpg", "jpeg", "png", "webp"];

/**
 * The folders a picture may live in: the whitelist above, and nothing else.
 * A slot name has no separator, so `../../etc/passwd` is refused before the
 * disk; within a folder the file name is fixed too, so `..` is impossible
 * there. The file itself is then re-resolved under this boundary with
 * resolveSafePath, which is what stops a symlink pointing out of the drive.
 */
export const ART_ROOT = "/Volumes/Agent";

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
        // Second lock: the real file must still sit inside the Agent drive.
        resolveSafePath(file, ART_ROOT);
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
