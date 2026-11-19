import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { MAX_ART_BYTES, SLOT_IDS, artRoot, findArt, isSlot } from "./art.mjs";
import { UnsafePathError, resolveSafePath } from "./safeFs.mjs";

/**
 * Fake picture folders in a temp directory. Every lookup is still checked
 * against a drive boundary (that is the security property under test), so the
 * boundary is scoped to this test's own temp folder: `PREYAS_ART_ROOT` exists
 * for exactly this, because CI has no /Volumes/Agent. `folder()` makes a folder on
 * the allowed drive and `offDrive()` one off it, so a link from the first to the
 * second must be refused.
 */
const DRIVE = fs.mkdtempSync(path.join(os.tmpdir(), "preyas-art-drive-"));
const OUTSIDE = fs.mkdtempSync(path.join(os.tmpdir(), "preyas-art-outside-"));
process.env.PREYAS_ART_ROOT = DRIVE;

test.after(() => {
  fs.rmSync(DRIVE, { recursive: true, force: true });
  fs.rmSync(OUTSIDE, { recursive: true, force: true });
});

/** A fresh folder on the allowed drive. */
function folder() {
  return fs.mkdtempSync(path.join(DRIVE, "slot-"));
}

/** A fresh folder off the allowed drive. */
function offDrive() {
  return fs.mkdtempSync(path.join(OUTSIDE, "slot-"));
}

function put(root, name, bytes = 64) {
  fs.writeFileSync(path.join(root, name), Buffer.alloc(bytes, 7));
  return path.join(root, name);
}

test("the running app checks against the real Agent drive", () => {
  const saved = process.env.PREYAS_ART_ROOT;
  delete process.env.PREYAS_ART_ROOT;
  try {
    assert.equal(artRoot(), "/Volumes/Agent");
  } finally {
    if (saved !== undefined) process.env.PREYAS_ART_ROOT = saved;
  }
  assert.equal(artRoot(), DRIVE);
});

test("a png in the first folder is found with its type and size", () => {
  const root = folder();
  const file = put(root, "hero.png", 1234);
  const found = findArt("hero", [root]);
  assert.equal(found.type, "image/png");
  assert.equal(found.size, 1234);
  assert.equal(fs.realpathSync(found.path), fs.realpathSync(file));
});

test("every slot on the whitelist is looked up, and jpg/jpeg/png/webp are known", () => {
  const root = folder();
  for (const slot of SLOT_IDS) put(root, `${slot}.jpg`, 32);
  for (const slot of SLOT_IDS) assert.equal(findArt(slot, [root])?.type, "image/jpeg");
  // Each of the other extensions answers when it is the only one present.
  for (const [ext, type] of [["jpeg", "image/jpeg"], ["png", "image/png"], ["webp", "image/webp"]]) {
    const alone = folder();
    put(alone, `house.${ext}`, 40);
    assert.equal(findArt("house", [alone])?.type, type);
  }
  // jpg is preferred over the rest when a slot has several files.
  put(root, "house.webp", 40);
  assert.equal(findArt("house", [root])?.type, "image/jpeg");
});

test("the first folder wins over the second", () => {
  const first = folder();
  const second = folder();
  put(first, "car.jpg", 10);
  put(second, "car.jpg", 20);
  const found = findArt("car", [first, second]);
  assert.equal(found.size, 10);
  assert.ok(found.path.startsWith(fs.realpathSync(first)));
  // And when the first folder has nothing, the second one answers.
  assert.equal(findArt("studio", [first, second]), null);
  put(second, "studio.jpeg", 30);
  assert.equal(findArt("studio", [first, second]).size, 30);
});

test("a file over the 8 MB cap is ignored", () => {
  const root = folder();
  put(root, "bg.png", MAX_ART_BYTES + 1);
  assert.equal(findArt("bg", [root]), null);
  // Right at the cap is still a picture.
  put(root, "study.png", MAX_ART_BYTES);
  assert.equal(findArt("study", [root]).size, MAX_ART_BYTES);
});

test("traversal cannot reach a file outside the folder or the drive", () => {
  const root = folder();
  const traps = ["../etc/passwd", "../../../../etc/passwd", "/etc/passwd", "", "..", "hero/../bg"];
  for (const trap of traps) {
    assert.equal(isSlot(trap), false);
    assert.throws(() => findArt(trap, [root]), TypeError);
  }
  // A whitelisted slot whose file is a symlink pointing off the drive.
  const outside = put(offDrive(), "outside.png", 16);
  fs.symlinkSync(outside, path.join(root, "car.png"));
  assert.equal(findArt("car", [root]), null);
  // A folder off the drive is refused too, even for a whitelisted slot.
  const far = offDrive();
  put(far, "house.png");
  assert.equal(findArt("house", [far]), null);
  // resolveSafePath itself is what says no about the link.
  assert.throws(() => resolveSafePath(path.join(root, "car.png"), artRoot()), UnsafePathError);
});

test("an unknown slot is refused before the disk is touched", () => {
  assert.throws(() => findArt("../../secrets", ["/nonexistent"]), TypeError);
  assert.throws(() => findArt("HERO", ["/nonexistent"]), TypeError);
  assert.throws(() => findArt(undefined, ["/nonexistent"]), TypeError);
  assert.equal(isSlot("hero"), true);
  assert.equal(isSlot("bg"), true);
  assert.equal(isSlot("balance"), false);
});

test("a missing picture is null, not an error", () => {
  const root = folder();
  assert.equal(findArt("house", [root]), null);
  assert.equal(findArt("house", ["/nonexistent/folder"]), null);
  assert.equal(findArt("house", []), null);
});
