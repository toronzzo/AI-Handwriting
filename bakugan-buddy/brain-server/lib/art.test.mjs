import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { MAX_ART_BYTES, SLOT_IDS, artRoot, findArt, isSlot, saveArt } from "./art.mjs";
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

/* ---------------------------------------------------------------------------
 * Slice 10b: saving a picture from inside the app. Every test writes only
 * inside its own temp folder; nothing here touches the real art folder.
 * ------------------------------------------------------------------------- */

/** Real magic numbers, so the type is judged the way the brain judges it. */
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(120, 3),
]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 9)]);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.from([36, 0, 0, 0]), Buffer.from("WEBP"), Buffer.alloc(80, 5)]);
/** One fixed moment for the backup names, in local time. */
const AT = new Date(2026, 10, 19, 14, 30, 5);

/** A fresh empty art folder plus the list of everything around it. */
function artFolder() {
  return fs.mkdtempSync(path.join(DRIVE, "art-"));
}

function names(dir) {
  return fs.readdirSync(dir).sort();
}

test("saveArt saves a png and the folder then has exactly that png", () => {
  const dir = artFolder();
  const saved = saveArt("hero", PNG, { dir, now: () => AT });
  assert.equal(saved.type, "image/png");
  assert.equal(saved.size, PNG.length);
  assert.equal(fs.realpathSync(saved.path), fs.realpathSync(path.join(dir, "hero.png")));
  assert.deepEqual(fs.readFileSync(path.join(dir, "hero.png")), PNG);
  assert.deepEqual(names(dir), ["hero.png", "old"]);
  // And the ordinary read path finds it.
  assert.equal(findArt("hero", [dir]).type, "image/png");
});

test("an older jpg is moved to old/ with a timestamp name and the same bytes", () => {
  const dir = artFolder();
  fs.writeFileSync(path.join(dir, "hero.jpg"), JPEG);
  saveArt("hero", PNG, { dir, now: () => AT });
  assert.deepEqual(fs.readFileSync(path.join(dir, "old", "hero-20261119-143005.jpg")), JPEG);
  assert.deepEqual(fs.readFileSync(path.join(dir, "hero.png")), PNG);
  assert.equal(fs.existsSync(path.join(dir, "hero.jpg")), false);
  // Nothing was deleted: old/ holds the backup.
  assert.deepEqual(names(path.join(dir, "old")), ["hero-20261119-143005.jpg"]);
});

test("every extension of the slot is parked, not just the one being replaced", () => {
  const dir = artFolder();
  fs.writeFileSync(path.join(dir, "car.jpeg"), JPEG);
  fs.writeFileSync(path.join(dir, "car.webp"), WEBP);
  saveArt("car", JPEG, { dir, now: () => AT });
  assert.deepEqual(names(dir), ["car.jpg", "old"]);
  assert.deepEqual(names(path.join(dir, "old")), ["car-20261119-143005.jpeg", "car-20261119-143005.webp"]);
});

test("a second save in the same second gets -2, a third -3", () => {
  const dir = artFolder();
  fs.writeFileSync(path.join(dir, "study.jpg"), JPEG);
  // All three land in the same second: the same timestamp name is asked for
  // three times, so the second and third backups need a suffix.
  saveArt("study", PNG, { dir, now: () => AT });
  saveArt("study", PNG, { dir, now: () => AT });
  saveArt("study", PNG, { dir, now: () => AT });
  // study.jpg was parked first (the 2nd save, "-2"), then study.png twice.
  assert.deepEqual(names(path.join(dir, "old")), [
    "study-20261119-143005-2.png",
    "study-20261119-143005.jpg",
    "study-20261119-143005.png",
  ]);
  // A different second needs no suffix at all.
  const later = new Date(2026, 10, 19, 14, 30, 6);
  saveArt("study", PNG, { dir, now: () => later });
  assert.ok(names(path.join(dir, "old")).includes("study-20261119-143006.png"));
  // Every backup is still a picture and nothing was lost.
  for (const name of names(path.join(dir, "old"))) {
    assert.ok(fs.readFileSync(path.join(dir, "old", name)).length > 12, name);
  }
  assert.deepEqual(names(dir), ["old", "study.png"]);
});

test("a text file renamed .png is refused, and the old picture stays", () => {
  const dir = artFolder();
  fs.writeFileSync(path.join(dir, "bg.png"), PNG);
  assert.throws(() => saveArt("bg", Buffer.from("<html>not a picture</html>"), { dir, now: () => AT }), TypeError);
  // A png header plus garbage is a png: the type is the bytes, not the name.
  const fakePng = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(40, 1)]);
  assert.equal(saveArt("bg", fakePng, { dir, now: () => AT }).type, "image/png");
  // An html file with a jpg name is refused the same way.
  assert.throws(() => saveArt("bg", Buffer.from("<!doctype html>"), { dir, now: () => AT }), TypeError);
});

test("a picture over 8 MB is refused before anything is written", () => {
  const dir = artFolder();
  const huge = Buffer.concat([PNG, Buffer.alloc(MAX_ART_BYTES)]);
  assert.ok(huge.length > MAX_ART_BYTES);
  assert.throws(() => saveArt("house", huge, { dir, now: () => AT }), RangeError);
  assert.deepEqual(names(dir), []);
  // Exactly 8 MB is still fine.
  const atCap = Buffer.concat([PNG, Buffer.alloc(MAX_ART_BYTES - PNG.length)]);
  assert.equal(saveArt("house", atCap, { dir, now: () => AT }).size, MAX_ART_BYTES);
});

test("an empty file is refused", () => {
  const dir = artFolder();
  assert.throws(() => saveArt("studio", Buffer.alloc(0), { dir, now: () => AT }), RangeError);
  assert.deepEqual(names(dir), []);
});

test("an unknown slot or a ../ path is refused before the disk is touched", () => {
  const missing = path.join(DRIVE, "never-made");
  for (const slot of ["../x", "../../../etc/passwd", "/etc/passwd", "HERO", "balance", "", "hero/../bg"]) {
    assert.throws(() => saveArt(slot, PNG, { dir: missing, now: () => AT }), TypeError);
  }
  assert.throws(() => saveArt(undefined, PNG, { dir: missing }), TypeError);
  // Not one mkdir happened for the refused slots.
  assert.equal(fs.existsSync(missing), false);
});

test("nothing outside the folder or the drive is created or moved", () => {
  // Outside the folder first, then the folder itself: a folder made inside the
  // drive must be the only new name.
  const before = fs.readdirSync(DRIVE).sort();
  const dir = artFolder();
  fs.writeFileSync(path.join(dir, "studio.jpg"), JPEG);
  saveArt("studio", PNG, { dir, now: () => AT });
  // Inside the folder: the new picture and the backup, nothing else.
  assert.deepEqual(names(dir), ["old", "studio.png"]);
  assert.deepEqual(names(path.join(dir, "old")), ["studio-20261119-143005.jpg"]);
  // Around it, the drive is exactly as it was.
  // Sibling folders made by the other tests are already there, so the check
  // is that our own call added nothing new.
  const now = fs.readdirSync(DRIVE).sort();
  assert.deepEqual(now.filter((name) => !before.includes(name)), [path.basename(dir)]);
  // And a symlinked slot file cannot pull a write out of the folder.
  const outside = path.join(offDrive(), "target.png");
  fs.writeFileSync(outside, Buffer.from("untouched"));
  const other = artFolder();
  fs.symlinkSync(outside, path.join(other, "house.png"));
  assert.throws(() => saveArt("house", PNG, { dir: other, now: () => AT }), UnsafePathError);
  assert.equal(fs.readFileSync(outside, "utf8"), "untouched");
  // Only the empty old/ folder was made; no picture was written or moved.
  assert.deepEqual(names(other), ["house.png", "old"]);
  assert.deepEqual(names(path.join(other, "old")), []);
});
