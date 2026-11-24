import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  MAX_CHARS,
  TRACKPAD_BIN,
  createTrackpad,
  readTrackpadEnabled,
  trackpadAvailableFor,
  trackpadBinFor,
  trackpadSettingsPath,
  trackpadText,
  writeTrackpadEnabled,
} from "./trackpad.mjs";

/** A spawn that records the programs it would have started. */
function fakeSpawn() {
  const calls = [];
  function spawnImpl(bin, args) {
    const child = {
      bin,
      args,
      killed: 0,
      handlers: {},
      on(event, cb) {
        this.handlers[event] = cb;
        return this;
      },
      kill() {
        this.killed += 1;
        this.handlers.exit?.();
        return true;
      },
    };
    calls.push(child);
    return child;
  }
  return { spawnImpl, calls };
}

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "preyas-trackpad-"));
}

test("the program is the one the installer wrote, or TRACKPAD_BIN when set", () => {
  const all = () => true;
  assert.equal(trackpadBinFor({}, all), TRACKPAD_BIN);
  assert.equal(trackpadBinFor({ TRACKPAD_BIN: "/opt/nospeaker" }, all), "/opt/nospeaker");
  assert.equal(trackpadBinFor({}, () => false), "");
  // A stale TRACKPAD_BIN is ignored, not an error.
  assert.equal(trackpadBinFor({ TRACKPAD_BIN: "/gone" }, (file) => file === TRACKPAD_BIN), TRACKPAD_BIN);
});

test("only a Mac with the program is available", () => {
  const all = () => true;
  assert.equal(trackpadAvailableFor({}, { exists: all, platform: "darwin" }), true);
  assert.equal(trackpadAvailableFor({}, { exists: all, platform: "linux" }), false);
  assert.equal(trackpadAvailableFor({}, { exists: () => false, platform: "darwin" }), false);
});

test("a line is flattened, de-dashed and capped", () => {
  assert.equal(trackpadText("  hello \n there  "), "hello there");
  assert.equal(trackpadText("--dark hello"), "dark hello");
  assert.equal(trackpadText(""), "");
  assert.equal(trackpadText(undefined), "");
  assert.equal(trackpadText("x".repeat(MAX_CHARS + 50)).length, MAX_CHARS);
});

test("say starts the motor once and a new line stops the old one", () => {
  const { spawnImpl, calls } = fakeSpawn();
  const trackpad = createTrackpad({ bin: "/x/nospeaker", platform: "darwin", spawn: spawnImpl });
  assert.deepEqual(trackpad.state(), { available: true, enabled: true, speaking: false });

  assert.equal(trackpad.say("hello\nthere"), true);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, ["hello there"]);
  assert.equal(trackpad.state().speaking, true);

  assert.equal(trackpad.say("again"), true);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].killed, 1, "the first line is stopped");

  assert.equal(trackpad.stop(), true);
  assert.equal(calls[1].killed, 1);
  assert.equal(trackpad.state().speaking, false);
  assert.equal(trackpad.stop(), false, "stopping twice is not an error");
});

test("silence when the switch is off, the Mac has no program, or there is nothing to say", () => {
  const off = fakeSpawn();
  const disabled = createTrackpad({ bin: "/x/nospeaker", platform: "darwin", spawn: off.spawnImpl, enabled: false });
  assert.equal(disabled.say("hello"), false);
  assert.equal(off.calls.length, 0);

  const missing = fakeSpawn();
  const unavailable = createTrackpad({ bin: "", platform: "darwin", spawn: missing.spawnImpl });
  assert.equal(unavailable.state().available, false);
  assert.equal(unavailable.say("hello"), false);
  assert.equal(missing.calls.length, 0);

  const empty = fakeSpawn();
  const speaking = createTrackpad({ bin: "/x/nospeaker", platform: "darwin", spawn: empty.spawnImpl });
  assert.equal(speaking.say("   "), false);
  assert.equal(empty.calls.length, 0);
});

test("the switch is saved on the drive and is ON when nothing is saved", () => {
  const root = tempRoot();
  try {
    assert.equal(readTrackpadEnabled(root), true);
    assert.equal(trackpadSettingsPath(root), path.join(root, "memory", "trackpad.json"));

    assert.equal(writeTrackpadEnabled(root, false), true);
    assert.equal(readTrackpadEnabled(root), false);
    assert.equal(writeTrackpadEnabled(root, true), true);
    assert.equal(readTrackpadEnabled(root), true);

    fs.writeFileSync(trackpadSettingsPath(root), "not json");
    assert.equal(readTrackpadEnabled(root), true, "an unreadable file cannot silence Preyas");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("turning the switch off stops a line that is still playing and is remembered", () => {
  const root = tempRoot();
  try {
    const { spawnImpl, calls } = fakeSpawn();
    const trackpad = createTrackpad({ bin: "/x/nospeaker", platform: "darwin", spawn: spawnImpl, dataDir: root });
    assert.equal(trackpad.say("hello"), true);
    assert.equal(trackpad.setEnabled(false), false);
    assert.equal(calls[0].killed, 1);
    assert.equal(trackpad.say("again"), false);
    assert.equal(readTrackpadEnabled(root), false);

    // A new process reads the switch back from the drive.
    const next = createTrackpad({ bin: "/x/nospeaker", platform: "darwin", spawn: spawnImpl, dataDir: root });
    assert.equal(next.state().enabled, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
