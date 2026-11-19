import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { MAX_ART_BYTES, SLOT_IDS, findArt, isSlot } from "./art.mjs";
import { UnsafePathError, resolveSafePath } from "./safeFs.mjs";

/**
 * Fake picture folders. They live in a temp folder INSIDE the Agent drive,
 * because art.mjs refuses any file whose real path is outside it (the same
 * hard rule the rest of the brain follows); os.tmpdir() is outside and would
 * make every lookup look like a traversal. Each folder is removed afterwards.
 */
const DRIVE = "/Volumes/Agent";
const made = [];

function folder(isDriveOn = true) {
  const base = isDriveOn ? DRIVE : undefined;
  const root = fs.mkdtempSync(path.join(base || "/tmp", "preyas-art-test-"));
  made.push(root);
  return root;
}

test.after(() => {
  for (const dir of made) fs.rmSync(dir, { recursive: true, force: true });
});

function put(root, name, bytes = 64) {
  fs.writeFileSync(path.join(root, name), Buffer.alloc(bytes, 7));
  return path.join(root, name);
}

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
  // A whitelisted slot whose file is a symlink pointing out of the drive.
  const outside = path.join(folder(false), "outside.png");
  fs.writeFileSync(outside, Buffer.alloc(16, 1));
  fs.symlinkSync(outside, path.join(root, "car.png"));
  assert.equal(findArt("car", [root]), null);
  // A folder outside the drive is refused too, even for a whitelisted slot.
  const outsideFolder = folder(false);
  put(outsideFolder, "house.png");
  assert.equal(findArt("house", [outsideFolder]), null);
  // resolveSafePath itself is what says no.
  assert.throws(() => resolveInDrive(path.join(root, "car.png")), UnsafePathError);
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

/** The drive-boundary check art.mjs applies to every picture it hands out. */
function resolveInDrive(file) {
  return resolveSafePath(file, DRIVE);
}
