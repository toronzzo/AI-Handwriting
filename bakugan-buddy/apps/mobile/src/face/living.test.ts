import assert from "node:assert/strict";
import test from "node:test";
import { livingMotion, moodLeads } from "./living.ts";

test("a neutral resting ball is still", () => {
  const pose = livingMotion("resting", "neutral");
  assert.equal(pose.tiltX, 0);
  assert.equal(pose.tiltZ, 0);
  assert.equal(pose.hop, 0);
  // It still breathes on the resting spin, which is its own slow value.
  assert.ok(pose.spin > 0);
});

test("no feeling is the same as neutral, never a guess", () => {
  assert.deepEqual(livingMotion("resting", null), livingMotion("resting", "neutral"));
  assert.deepEqual(livingMotion("resting", "sad", true), livingMotion("resting", "neutral", true));
  // An unknown mood is neutral rather than a random pose.
  assert.deepEqual(livingMotion("resting", "dragon"), livingMotion("resting", "neutral"));
});

test("happy and excited hop, sad and sleepy droop", () => {
  assert.ok(livingMotion("resting", "happy").hop > 0);
  assert.ok(livingMotion("resting", "excited").hop > livingMotion("resting", "happy").hop);
  assert.ok(livingMotion("resting", "sad").tiltX > 0);
  assert.ok(livingMotion("resting", "sleepy").tiltX > livingMotion("resting", "sad").tiltX);
  assert.equal(livingMotion("resting", "sad").hop, 0);
});

test("activity outranks feeling: the hop is cut while he is doing something", () => {
  const resting = livingMotion("resting", "excited");
  const speaking = livingMotion("speaking", "excited");
  assert.ok(speaking.hop < resting.hop, "the said bob leads, the hop does not take over");
  assert.ok(speaking.hop > 0, "the feeling is not erased");
  assert.ok(speaking.bob > 0, "the speaking bob is still the main movement");
  assert.equal(speaking.tiltX, resting.tiltX, "a tilt never changes mid-sentence");
});

test("every activity keeps its own motion whatever the feeling says", () => {
  for (const state of ["listening", "thinking", "working", "speaking"] as const) {
    const quiet = livingMotion(state, "neutral");
    const lively = livingMotion(state, "excited");
    assert.ok(quiet.spin > 0, `${state} still moves`);
    assert.equal(lively.bob, quiet.bob, `${state} bob does not follow the mood`);
  }
});

test("reduced motion is a still pose, and the state is carried elsewhere", () => {
  const pose = livingMotion("speaking", "excited", true);
  assert.deepEqual(pose, { spin: 0, bob: 0, wobble: 0, tiltX: 0, tiltZ: 0, hop: 0 });
});

test("moodLeads is true only while resting with a real feeling", () => {
  assert.equal(moodLeads("resting", "happy"), true);
  assert.equal(moodLeads("resting", "neutral"), false);
  assert.equal(moodLeads("resting", null), false);
  assert.equal(moodLeads("speaking", "happy"), false, "activity is still in charge");
});
