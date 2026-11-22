/**
 * State → expression. Pure node tests, no React.
 */
/// <reference types="node" />
import assert from "node:assert/strict";
import test from "node:test";
import {
  applyPin,
  EXPRESSION_LABEL,
  FACE_EXPRESSIONS,
  liveExpression,
  readFace,
  readMoodTag,
  sentimentMood,
  speechMood,
  spokenText,
  type FaceSignals,
} from "./expression.ts";
import { blinkAmount, lerpPose, mouthFromEnvelope, poseFor, timedMouth } from "./pose.ts";

const quiet: FaceSignals = { recording: false, generating: false, speaking: false, reply: "" };

test("every expression has a short label", () => {
  for (const expression of FACE_EXPRESSIONS) {
    assert.ok(EXPRESSION_LABEL[expression].length > 0);
  }
});

test("an empty chat is idle", () => {
  const read = readFace(quiet);
  assert.equal(read.expression, "idle");
  assert.equal(read.mood, null);
  assert.equal(speechMood(""), "neutral");
});

test("the mic, the reply, and the voice take priority over the words", () => {
  const reply = "[happy] I love this 😄";
  assert.equal(readFace({ ...quiet, reply, recording: true }).expression, "listening");
  assert.equal(readFace({ ...quiet, reply, speaking: true }).expression, "talking");
  assert.equal(readFace({ ...quiet, reply, generating: true }).expression, "thinking");
  assert.equal(readFace({ ...quiet, reply, recording: true, speaking: true }).expression, "listening");
  assert.equal(readFace({ ...quiet, reply, speaking: true, generating: true }).expression, "talking");
});

test("a playing wav counts as talking even before the phase flag flips", () => {
  assert.equal(liveExpression({ ...quiet, reply: "[sad] oh" }, true), "talking");
  assert.equal(liveExpression({ ...quiet, generating: true, reply: "" }, false), "thinking");
  assert.equal(liveExpression({ ...quiet, recording: true, generating: true }, true), "listening");
});

test("a brain tag wins over emoji and phrases", () => {
  assert.equal(readFace({ ...quiet, reply: "[sad] I love this 😄" }).expression, "sad");
  assert.equal(readFace({ ...quiet, reply: "[happy] I'm tired" }).expression, "happy");
  assert.equal(readFace({ ...quiet, reply: "[battle] hold on" }).expression, "excited");
  assert.equal(readFace({ ...quiet, reply: "[amused] heh" }).expression, "happy");
  assert.equal(readFace({ ...quiet, reply: "[sleepy] night" }).expression, "sleepy");
  assert.equal(readMoodTag("[fierce] grr"), "angry");
  assert.equal(readFace({ ...quiet, reply: "[fierce] grr" }).expression, "excited");
});

test("an unknown or unfinished tag falls through to the words", () => {
  assert.equal(readMoodTag("[banana] hi"), null);
  assert.equal(readFace({ ...quiet, reply: "[banana] wow" }).expression, "surprised");
  assert.equal(readMoodTag("[hap"), null);
  assert.equal(readFace({ ...quiet, reply: "[hap" }).expression, "idle");
});

test("emoji are counted when there is no tag", () => {
  assert.equal(sentimentMood("Say now 😮"), "surprised");
  assert.equal(readFace({ ...quiet, reply: "no way 😢😢" }).expression, "sad");
  assert.equal(readFace({ ...quiet, reply: "❤️" }).expression, "happy");
  assert.equal(readFace({ ...quiet, reply: "let's splash 🔥" }).expression, "excited");
  assert.equal(readFace({ ...quiet, reply: "zzz 😴" }).expression, "sleepy");
  assert.equal(readFace({ ...quiet, reply: "hmm 🤔" }).expression, "thinking");
});

test("a tie between emoji prefers surprise over a smile", () => {
  assert.equal(readFace({ ...quiet, reply: "😄😮" }).expression, "surprised");
});

test("plain phrases cover the feelings emoji missed", () => {
  assert.equal(readFace({ ...quiet, reply: "I am so tired today" }).expression, "sleepy");
  assert.equal(readFace({ ...quiet, reply: "I am sorry, partner" }).expression, "sad");
  assert.equal(readFace({ ...quiet, reply: "wow, no way" }).expression, "surprised");
  assert.equal(readFace({ ...quiet, reply: "Let's go, battle time" }).expression, "excited");
  assert.equal(readFace({ ...quiet, reply: "hmm let me think" }).expression, "thinking");
  assert.equal(readFace({ ...quiet, reply: "I'm listening" }).expression, "listening");
  assert.equal(readFace({ ...quiet, reply: "haha nice one" }).expression, "happy");
  assert.equal(readFace({ ...quiet, reply: "the gate is blue" }).expression, "idle");
});

test("spoken text drops a real tag and keeps everything else", () => {
  assert.equal(spokenText("[happy] Say now!"), "Say now!");
  assert.equal(spokenText("no tag here"), "no tag here");
  assert.equal(spokenText("[banana] hi"), "[banana] hi");
});

test("speech mood follows the reply, and stays neutral when it has none", () => {
  assert.equal(speechMood("[excited] yeah"), "excited");
  assert.equal(speechMood("[sleepy] night"), "sleepy");
  assert.equal(speechMood("hello"), "neutral");
  assert.equal(speechMood("good night"), "sleepy");
});

test("a preview pin replaces the live expression, and talking keeps the mood", () => {
  const live = readFace({ ...quiet, reply: "[sad] oh" });
  assert.equal(applyPin(live, null).expression, "sad");
  assert.equal(applyPin(live, "happy").expression, "happy");
  assert.equal(applyPin(live, "happy").mood, "happy");
  assert.deepEqual(applyPin(live, "talking"), { expression: "talking", mood: "sad" });
});

test("happy smiles and flares more than sad, angry is battle-ready but not a grin", () => {
  const happy = poseFor(readFace({ ...quiet, reply: "[happy] hi" }), 0, null, true);
  const sad = poseFor(readFace({ ...quiet, reply: "[sad] hi" }), 0, null, true);
  const excited = poseFor(readFace({ ...quiet, reply: "[excited] hi" }), 0, null, true);
  const angry = poseFor(readFace({ ...quiet, reply: "[angry] hi" }), 0, null, true);
  const battle = poseFor(readFace({ ...quiet, reply: "[battle] hi" }), 0, null, true);
  assert.ok(happy.smile > sad.smile);
  assert.ok(happy.crest > sad.crest);
  assert.ok(excited.crest > happy.crest);
  assert.equal(readFace({ ...quiet, reply: "[angry] hi" }).expression, "excited");
  assert.ok(angry.smile < excited.smile);
  assert.ok(angry.brow < 0);
  assert.ok(battle.smile > 0.5);
  assert.equal(battle.crest, 1);
});

test("talking opens the mouth from the envelope, and from time when there is none", () => {
  const read = readFace({ ...quiet, reply: "[happy] hi", speaking: true });
  const shut = poseFor(read, 1000, 0, true);
  const open = poseFor(read, 1000, 1, true);
  const timed = poseFor(read, 1000, null, true);
  assert.ok(open.mouth > shut.mouth);
  assert.ok(open.mouth > 0.9);
  assert.ok(timed.mouth > 0.1);
  assert.ok(timed.smile > 0.5, "a happy line still smiles while he talks");
  const sadTalk = poseFor(readFace({ ...quiet, reply: "[sad] hi", speaking: true }), 1000, 0.4, true);
  assert.ok(sadTalk.smile < 0);
  assert.ok(sadTalk.mouth > 0.2);
});

test("the envelope hop is 20 ms and missing audio does not invent a mouth", () => {
  const envelope = [0, 0.12, 0.24];
  assert.equal(mouthFromEnvelope(envelope, 1000, 1000), 0);
  assert.equal(mouthFromEnvelope(envelope, 1000, 1020), 1);
  assert.equal(mouthFromEnvelope(envelope, 1000, 1040), 1);
  assert.equal(mouthFromEnvelope(envelope, 1000, 1060), null);
  assert.equal(mouthFromEnvelope(envelope, 0, 1000), null);
  assert.equal(mouthFromEnvelope([], 1000, 1000), null);
  assert.ok(timedMouth(0) >= 0 && timedMouth(0) <= 1);
});

test("reduced motion holds a still breath and open blink", () => {
  const moving = poseFor(readFace(quiet), 1000, null, false);
  const still = poseFor(readFace(quiet), 1000, null, true);
  assert.notEqual(moving.breath, 0);
  assert.equal(still.breath, 0);
  assert.equal(blinkAmount(2400 + 75, false), 0);
  assert.equal(blinkAmount(2400 + 75, true), 1);
  assert.equal(blinkAmount(0, false), 1);
  const sleepy = poseFor(readFace({ ...quiet, reply: "[sleepy] night" }), 0, null, true);
  assert.ok(sleepy.eyeOpen < 0.5);
  assert.ok(sleepy.crest < still.crest);
});

test("lerp moves the mouth faster than the brow and stays on the target at 1", () => {
  const from = poseFor(readFace(quiet), 0, null, true);
  const to = poseFor(readFace({ ...quiet, reply: "[surprised] oh" }), 0, null, true);
  const mid = lerpPose(from, to, 0.5, 1);
  assert.ok(Math.abs(mid.mouth - to.mouth) < 1e-9);
  assert.ok(mid.brow > from.brow && mid.brow < to.brow);
  const done = lerpPose(from, to, 1, 1);
  assert.equal(done.smile, to.smile);
  assert.equal(done.crest, to.crest);
});
