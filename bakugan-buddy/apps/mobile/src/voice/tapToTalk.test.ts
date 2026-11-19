/// <reference types="node" />
import assert from "node:assert/strict";
import test from "node:test";
import {
  AUTO_STOP_MS,
  boxAfterTranscription,
  cancelsRecording,
  finishTranscribing,
  formatClock,
  idleTapState,
  recordedMs,
  shouldAutoSend,
  shouldAutoStop,
  startRecording,
  startTranscribing,
  tapAction,
} from "./tapToTalk.ts";

const T0 = 1_700_000_000_000;

test("a tap starts recording, the next tap stops it, a tap while waiting does nothing", () => {
  const idle = idleTapState();
  assert.equal(idle.phase, "idle");
  assert.equal(tapAction(idle), "start");

  const rec = startRecording(T0);
  assert.equal(rec.phase, "recording");
  assert.equal(rec.startedAt, T0);
  assert.equal(tapAction(rec), "stop");

  const wait = startTranscribing();
  assert.equal(wait.phase, "transcribing");
  assert.equal(tapAction(wait), "wait");
});

test("finishing the transcription always lands back on idle", () => {
  const done = finishTranscribing();
  assert.equal(done.phase, "idle");
  assert.equal(done.startedAt, 0);
});

test("the recording clock counts up and never goes negative", () => {
  const rec = startRecording(T0);
  assert.equal(recordedMs(rec, T0), 0);
  assert.equal(recordedMs(rec, T0 - 5000), 0);
  assert.equal(recordedMs(rec, T0 + 7000), 7000);
  assert.equal(recordedMs(idleTapState(), T0), 0);
  assert.equal(recordedMs(startTranscribing(), T0), 0);
});

test("the 60 second limit stops the recording by itself", () => {
  const rec = startRecording(T0);
  assert.equal(shouldAutoStop(rec, T0 + AUTO_STOP_MS - 1), false);
  assert.equal(shouldAutoStop(rec, T0 + AUTO_STOP_MS), true);
  // Only a running recording auto-stops; idle and waiting never do.
  assert.equal(shouldAutoStop(idleTapState(), T0 + AUTO_STOP_MS * 2), false);
  assert.equal(shouldAutoStop(startTranscribing(), T0 + AUTO_STOP_MS * 2), false);
});

test("the mm:ss formatter pads seconds and caps at one minute", () => {
  assert.equal(formatClock(0), "0:00");
  assert.equal(formatClock(-900), "0:00");
  assert.equal(formatClock(999), "0:00");
  assert.equal(formatClock(1000), "0:01");
  assert.equal(formatClock(9000), "0:09");
  assert.equal(formatClock(10_000), "0:10");
  assert.equal(formatClock(59_999), "0:59");
  assert.equal(formatClock(60_000), "1:00");
  assert.equal(formatClock(90_000), "1:00");
  assert.equal(formatClock(Number.NaN), "0:00");
});

test("send right away only sends when the switch is on and words were heard", () => {
  assert.equal(shouldAutoSend(false, "hello"), false);
  assert.equal(shouldAutoSend(true, "hello"), true);
  assert.equal(shouldAutoSend(true, "   "), false);
  assert.equal(shouldAutoSend(true, ""), false);
});

test("nothing heard keeps the message box exactly as it was", () => {
  const kept = boxAfterTranscription("", "half typed text");
  assert.equal(kept.text, "half typed text");
  assert.equal(kept.changed, false);
  // Whitespace is silence too.
  assert.deepEqual(boxAfterTranscription("   ", "draft"), { text: "draft", changed: false });
});

test("heard words are trimmed and replace the box", () => {
  assert.deepEqual(boxAfterTranscription("  привет Preyas  ", ""), { text: "привет Preyas", changed: true });
  assert.deepEqual(boxAfterTranscription("hello", "old draft"), { text: "hello", changed: true });
});

test("Esc and the x button throw away a recording, not a finished transcription", () => {
  assert.equal(cancelsRecording(startRecording(T0)), true);
  assert.equal(cancelsRecording(idleTapState()), false);
  assert.equal(cancelsRecording(startTranscribing()), false);
});

test("the whole happy path is one recording at a time", () => {
  let state = idleTapState();
  assert.equal(tapAction(state), "start");
  state = startRecording(T0);
  assert.equal(tapAction(state), "stop");
  state = startTranscribing();
  assert.equal(tapAction(state), "wait");
  state = finishTranscribing();
  assert.equal(tapAction(state), "start");
});
