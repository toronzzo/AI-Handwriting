/// <reference types="node" />
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import test from "node:test";
import { FACE_EXPRESSIONS, type FaceExpression } from "./expression.ts";
import {
  BODY_LABEL,
  BODY_STATES,
  bodyIsActive,
  bodyStateFor,
  haloFor,
  motionFor,
  type PreyasBodyState,
} from "./bodyState.ts";

const ROOT = process.cwd();
const SRC = join(ROOT, "src");

/** Every .ts/.tsx file under src, recursively. */
function srcFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name)) out.push(full);
    }
  };
  walk(SRC);
  return out;
}

function rel(file: string): string {
  return relative(ROOT, file).split(sep).join("/");
}

test("the mic, a reply in flight and his voice are the only active states", () => {
  assert.equal(bodyStateFor("listening"), "listening");
  assert.equal(bodyStateFor("thinking"), "thinking");
  assert.equal(bodyStateFor("talking"), "speaking");
  // Every feeling is a way of being at rest: nothing new is happening.
  for (const feeling of ["idle", "happy", "surprised", "sad", "excited", "sleepy"] as FaceExpression[]) {
    assert.equal(bodyStateFor(feeling), "resting", `${feeling} must not claim activity`);
  }
});

test("every face expression maps to one of the four body states", () => {
  for (const expression of FACE_EXPRESSIONS) {
    assert.ok(BODY_STATES.includes(bodyStateFor(expression)), `${expression} has no body state`);
  }
});

test("only the four real activities count as doing something", () => {
  const active = BODY_STATES.filter(bodyIsActive);
  assert.deepEqual(active, ["listening", "thinking", "working", "speaking"]);
  assert.equal(bodyIsActive("resting"), false);
});

test("working is its own body state, not a shade of thinking", () => {
  const still = haloFor("working", true);
  const thinking = haloFor("thinking", true);
  assert.notDeepEqual(still, thinking, "the still halo separates work from thought");
  assert.equal(BODY_LABEL.working, "Preyas is working");
  const motion = motionFor("working", false);
  assert.ok(motion.spin > motionFor("thinking", false).spin, "work turns a little quicker than thought");
  assert.equal(motion.bob, 0, "busy is not excited");
});

test("the label says what he is really doing, and never claims more", () => {
  for (const state of BODY_STATES) {
    assert.match(BODY_LABEL[state], /^Preyas is /, `${state} label must name the state`);
    assert.ok(BODY_LABEL[state].length <= 40, `${state} label stays short`);
    assert.ok(!/!/i.test(BODY_LABEL[state]), "a screen reader line is calm, not shouty");
  }
  assert.equal(BODY_LABEL.listening, "Preyas is listening");
  assert.equal(BODY_LABEL.thinking, "Preyas is thinking");
  assert.equal(BODY_LABEL.speaking, "Preyas is speaking");
  // Nothing claims a capability or a feeling the app cannot see.
  for (const state of BODY_STATES) {
    assert.ok(!/learning|smarter|improving|always/i.test(BODY_LABEL[state]), `${state} overclaims`);
  }
});

test("the halo tells states apart without animation", () => {
  const seen = new Set<string>();
  for (const state of BODY_STATES) {
    const halo = haloFor(state, true);
    assert.ok(halo.strength > 0 && halo.strength <= 1, `${state} strength in range`);
    assert.ok(halo.radius > 0, `${state} radius positive`);
    assert.equal(halo.pulseSeconds, 0, `${state} must not pulse with reduced motion`);
    seen.add(`${halo.strength}:${halo.radius}`);
  }
  assert.equal(seen.size, BODY_STATES.length, "each state has its own still halo");
});

test("reduced motion keeps the halo's information and drops the pulse", () => {
  for (const state of BODY_STATES) {
    const live = haloFor(state, false);
    const still = haloFor(state, true);
    assert.equal(still.strength, live.strength);
    assert.equal(still.radius, live.radius);
    assert.equal(motionFor(state, true).spin, 0, `${state} must not spin`);
    assert.equal(motionFor(state, true).bob, 0);
    assert.equal(motionFor(state, true).wobble, 0);
  }
});

test("speaking gets the bob, thinking wobbles, listening is the calmest", () => {
  const speaking = motionFor("speaking", false);
  const thinking = motionFor("thinking", false);
  const listening = motionFor("listening", false);
  assert.ok(speaking.bob > 0, "speaking bobs like it always did");
  assert.equal(thinking.bob, 0);
  assert.ok(thinking.wobble > 0, "thinking tilts");
  assert.ok(speaking.spin > thinking.spin, "speaking spins fastest");
  assert.ok(listening.spin < thinking.spin, "listening is the slowest turn");
});

test("no screen fakes the body: every one of them passes a real state", () => {
  // The old bug this guards: LevelCard passed talking={false} forever and the
  // Profile panel passed one hardcoded clip, so two of the four bodies could
  // not move at all. A boolean prop must never come back.
  for (const file of srcFiles()) {
    if (rel(file) === "src/face/bodyState.test.ts") continue;
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, index) => {
      assert.ok(
        !/talking=/.test(line),
        `${rel(file)}:${index + 1} passes a talking flag instead of a body state: ${line.trim()}`,
      );
    });
  }
});

test("the body components take a state, not a mood, so motion can follow it", () => {
  for (const file of ["src/screens/PreyasHero.tsx", "src/screens/Preyas3D.tsx", "src/today/PreyasHeroSwitch.tsx"]) {
    const source = readFileSync(join(ROOT, file), "utf8");
    assert.match(source, /PreyasBodyState/, `${file} imports the body state type`);
    assert.match(source, /state[?:]/, `${file} takes a state prop`);
  }
  // The 3D scene reads the shared tables instead of its own guesses.
  const hero = readFileSync(join(ROOT, "src/screens/PreyasHero.tsx"), "utf8");
  assert.match(hero, /motionFor\(state/, "the scene asks the table for motion");
  assert.match(hero, /haloFor\(state/, "the scene asks the table for the halo");
  assert.match(hero, /BODY_LABEL\[state\]/, "the frame is labelled with the state");
});
