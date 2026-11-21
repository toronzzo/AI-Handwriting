/// <reference types="node" />
import assert from "node:assert/strict";
import test from "node:test";
import {
  patchSoundSettings,
  readSoundSettings,
  SOUND_SETTINGS_KEY,
  SOUNDS_DEFAULT,
  writeSoundSettings,
  type StorageLike,
} from "./soundSettings.ts";

function fakeStorage(seed: Record<string, string> = {}): StorageLike & { rows: Map<string, string> } {
  const rows = new Map(Object.entries(seed));
  return {
    rows,
    getItem: (key) => rows.get(key) ?? null,
    setItem: (key, value) => {
      rows.set(key, value);
    },
  };
}

const throwing: StorageLike = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
};

test("Sounds starts OFF when nothing is saved, like the other small switches", () => {
  assert.equal(SOUNDS_DEFAULT, false);
  assert.deepEqual(readSoundSettings(fakeStorage()), { sounds: false });
  assert.deepEqual(readSoundSettings(null), { sounds: false });
});

test("the switch survives a reload under one key", () => {
  const store = fakeStorage();
  writeSoundSettings({ sounds: true }, store);
  assert.deepEqual(readSoundSettings(store), { sounds: true });
  assert.deepEqual([...store.rows.keys()], [SOUND_SETTINGS_KEY]);
  assert.equal(SOUND_SETTINGS_KEY, "preyas.sounds");
  // The stored value is JSON, so the next read parses it back.
  assert.deepEqual(JSON.parse(store.rows.get(SOUND_SETTINGS_KEY)!), { sounds: true });
});

test("turning it off is saved too, not just the default", () => {
  const store = fakeStorage({ [SOUND_SETTINGS_KEY]: JSON.stringify({ sounds: true }) });
  patchSoundSettings(readSoundSettings(store), { sounds: false }, store);
  assert.deepEqual(readSoundSettings(store), { sounds: false });
});

test("only a real boolean true switches sounds on", () => {
  for (const raw of ['{"sounds":"yes"}', '{"sounds":1}', '{"sounds":"true"}', "{}", "[]", '"on"']) {
    assert.deepEqual(readSoundSettings(fakeStorage({ [SOUND_SETTINGS_KEY]: raw })), { sounds: false }, raw);
  }
});

test("torn or blocked storage falls back to OFF instead of crashing", () => {
  assert.deepEqual(readSoundSettings(fakeStorage({ [SOUND_SETTINGS_KEY]: "{not json" })), { sounds: false });
  assert.deepEqual(readSoundSettings(fakeStorage({ [SOUND_SETTINGS_KEY]: "null" })), { sounds: false });
  assert.deepEqual(readSoundSettings(throwing), { sounds: false });
  assert.deepEqual(writeSoundSettings({ sounds: true }, throwing), { sounds: true });
});

test("a patch keeps the switch honest", () => {
  const store = fakeStorage();
  let now = readSoundSettings(store);
  now = patchSoundSettings(now, { sounds: true }, store);
  assert.deepEqual(now, { sounds: true });
  now = patchSoundSettings(now, { sounds: false }, store);
  assert.deepEqual(now, { sounds: false });
  assert.deepEqual(readSoundSettings(store), { sounds: false });
});
