/// <reference types="node" />
import assert from "node:assert/strict";
import test from "node:test";
import {
  patchVoiceSettings,
  readVoiceSettings,
  VOICE_SETTINGS_KEY,
  writeVoiceSettings,
  type StorageLike,
} from "./voiceSettings.ts";

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

test("both voice switches start OFF when nothing is saved", () => {
  assert.deepEqual(readVoiceSettings(fakeStorage()), { autoSend: false, handsFree: false });
  assert.deepEqual(readVoiceSettings(null), { autoSend: false, handsFree: false });
});

test("saved switches are read back and land under the same key", () => {
  const store = fakeStorage();
  writeVoiceSettings({ autoSend: true, handsFree: false }, store);
  assert.deepEqual(readVoiceSettings(store), { autoSend: true, handsFree: false });
  assert.deepEqual([...store.rows.keys()], [VOICE_SETTINGS_KEY]);
  assert.ok(store.rows.get(VOICE_SETTINGS_KEY)!.includes("autoSend"));
});

test("a stored value that is not true never switches a feature on", () => {
  const store = fakeStorage({ [VOICE_SETTINGS_KEY]: JSON.stringify({ autoSend: "yes", handsFree: 1 }) });
  assert.deepEqual(readVoiceSettings(store), { autoSend: false, handsFree: false });
});

test("torn or nonsense storage falls back to OFF instead of crashing", () => {
  assert.deepEqual(readVoiceSettings(fakeStorage({ [VOICE_SETTINGS_KEY]: "{not json" })), {
    autoSend: false,
    handsFree: false,
  });
  assert.deepEqual(readVoiceSettings(fakeStorage({ [VOICE_SETTINGS_KEY]: "null" })), {
    autoSend: false,
    handsFree: false,
  });
  const throwing: StorageLike = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
  };
  assert.deepEqual(readVoiceSettings(throwing), { autoSend: false, handsFree: false });
  assert.deepEqual(writeVoiceSettings({ autoSend: true, handsFree: true }, throwing), {
    autoSend: true,
    handsFree: true,
  });
});

test("a patch changes one switch and keeps the other", () => {
  const store = fakeStorage();
  let now = readVoiceSettings(store);
  now = patchVoiceSettings(now, { autoSend: true }, store);
  assert.deepEqual(now, { autoSend: true, handsFree: false });
  now = patchVoiceSettings(now, { handsFree: true }, store);
  assert.deepEqual(now, { autoSend: true, handsFree: true });
  now = patchVoiceSettings(now, { autoSend: false }, store);
  assert.deepEqual(now, { autoSend: false, handsFree: true });
  assert.deepEqual(readVoiceSettings(store), { autoSend: false, handsFree: true });
});
