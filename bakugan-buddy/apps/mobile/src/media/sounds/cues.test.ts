/// <reference types="node" />
import assert from "node:assert/strict";
import test from "node:test";
import {
  CUE_FILES,
  CUE_IDS,
  CUE_MAX_MS,
  CUE_VOLUME,
  CUE_WINDOW_MS,
  MAX_CUE_VOLUME,
  TIER0_CUES,
  clampVolume,
  cueById,
  cueForMood,
  isCueId,
} from "./cues.ts";

/**
 * The cue map is the contract the rest of the feature trusts: ids the app
 * calls, files the bundle ships and moods the body already shows. These tests
 * keep it small, unique and inside the Tier-0 boundary.
 */

test("the bank is the six predefined Tier-0 reactions", () => {
  assert.deepEqual(CUE_IDS, ["pop-open", "laugh", "gasp", "hmm", "whoop", "droop"]);
  // Media plan A.6: keep the bank small enough to review.
  assert.ok(TIER0_CUES.length <= 12);
});

test("every cue is complete and unique", () => {
  const ids = new Set<string>();
  const files = new Set<string>();
  for (const cue of TIER0_CUES) {
    assert.ok(cue.id.length > 0 && cue.label.length > 0 && cue.what.length > 10, cue.id);
    assert.ok(cue.file.length > 0, cue.id);
    // A bare file name, never a path: the assets all sit in assets/sounds/.
    assert.equal(cue.file, cue.file.replace(/[\\/]/g, ""), `${cue.id} file must be a bare name`);
    assert.ok(!ids.has(cue.id), `duplicate id ${cue.id}`);
    assert.ok(!files.has(cue.file), `duplicate file ${cue.file}`);
    ids.add(cue.id);
    files.add(cue.file);
  }
});

test("each cue maps to a mood the body already animates, one each", () => {
  const moods = TIER0_CUES.map((cue) => cue.mood);
  assert.equal(new Set(moods).size, moods.length, "one cue per mood");
  for (const mood of moods) {
    assert.ok(cueForMood(mood) !== null, mood);
  }
  assert.equal(cueForMood("listening"), null, "a mood with no cue returns null");
});

test("the cue file list matches the cue map", () => {
  assert.deepEqual(CUE_FILES, TIER0_CUES.map((cue) => cue.file));
  assert.equal(new Set(CUE_FILES).size, CUE_FILES.length);
});

test("lookup helpers answer only for real cues", () => {
  const cue = cueById("laugh");
  assert.equal(cue?.mood, "happy");
  assert.equal(cueById("nope"), null);
  assert.equal(cueById(null), null);
  assert.equal(cueById(undefined), null);
  assert.equal(cueById(42), null);
  assert.equal(cueById(""), null);
  assert.equal(cueById("LAUGH"), null, "ids are case-sensitive");
  assert.equal(isCueId("gasp"), true);
  assert.equal(isCueId("gasp "), false);
});

test("the window and the volume stay quiet and bounded", () => {
  assert.ok(CUE_WINDOW_MS >= 1000 && CUE_WINDOW_MS <= 5000, "a burst is suppressed");
  assert.ok(CUE_MAX_MS <= 3000, "a cue never holds the speaker for long");
  assert.ok(CUE_VOLUME > 0 && CUE_VOLUME <= 0.5, "restrained volume");
  assert.equal(clampVolume(CUE_VOLUME), CUE_VOLUME);
  assert.equal(clampVolume(0), 0);
  assert.equal(clampVolume(-1), 0);
  assert.equal(clampVolume(Number.NaN), 0);
  assert.equal(clampVolume(Number.POSITIVE_INFINITY), 0);
  assert.equal(clampVolume(10), MAX_CUE_VOLUME);
});
