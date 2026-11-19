/**
 * Whisper model choice (slice V1): prefer the bigger ggml-small.bin the Mac
 * already has, but never override a model the user chose on purpose. Pure
 * functions and temp files only; nothing is downloaded.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  explicitWhisperModel,
  WHISPER_FALLBACK,
  WHISPER_PREFERRED,
  whisperArgs,
  whisperModelFor,
} from "./speech.mjs";

function drive() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "preyas-whisper-"));
  fs.mkdirSync(path.join(root, "models", "whisper"), { recursive: true });
  return root;
}

function touch(root, name) {
  const file = path.join(root, "models", "whisper", name);
  fs.writeFileSync(file, "");
  return file;
}

test("the bigger ggml-small.bin wins when it sits on the drive", () => {
  const root = drive();
  const small = touch(root, WHISPER_PREFERRED);
  const base = touch(root, WHISPER_FALLBACK);
  const picked = whisperModelFor({ BAKUGAN_DATA_DIR: root, WHISPER_MODEL: base });
  assert.equal(picked, small);
});

test("without ggml-small.bin the current ggml-base.bin stays", () => {
  const root = drive();
  const base = touch(root, WHISPER_FALLBACK);
  const picked = whisperModelFor({ BAKUGAN_DATA_DIR: root, WHISPER_MODEL: base });
  assert.equal(picked, base);
});

test("an unset WHISPER_MODEL still finds the fallback file", () => {
  const root = drive();
  const base = touch(root, WHISPER_FALLBACK);
  assert.equal(whisperModelFor({ BAKUGAN_DATA_DIR: root }), base);
});

test("a model chosen on purpose is never replaced", () => {
  const root = drive();
  touch(root, WHISPER_PREFERRED);
  const custom = path.join(root, "models", "whisper", "ggml-medium.bin");
  assert.equal(whisperModelFor({ BAKUGAN_DATA_DIR: root, WHISPER_MODEL: custom }), custom);
  const english = path.join(root, "models", "whisper", "ggml-small.en.bin");
  assert.equal(whisperModelFor({ BAKUGAN_DATA_DIR: root, WHISPER_MODEL: english }), english);
  assert.equal(explicitWhisperModel({ WHISPER_MODEL: "  " + custom + "  " }), custom);
});

test("the fallback file name is not treated as a deliberate choice", () => {
  assert.equal(explicitWhisperModel({ WHISPER_MODEL: "/somewhere/ggml-base.bin" }), null);
  assert.equal(explicitWhisperModel({ WHISPER_MODEL: "" }), null);
  assert.equal(explicitWhisperModel({}), null);
});

test("no drive and no setting chooses nothing", () => {
  assert.equal(whisperModelFor({}), "");
  const exists = whisperModelFor({}, () => false);
  assert.equal(exists, "");
});

test("listening keeps -l auto so Russian and English both work", () => {
  const args = whisperArgs("/w/ggml-small.bin", "/tmp/in.wav", "/tmp/in");
  assert.deepEqual(args, [
    "-m",
    "/w/ggml-small.bin",
    "-f",
    "/tmp/in.wav",
    "-l",
    "auto",
    "--no-timestamps",
    "-otxt",
    "-of",
    "/tmp/in",
  ]);
});
