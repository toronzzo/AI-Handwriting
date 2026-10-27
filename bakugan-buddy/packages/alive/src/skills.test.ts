import assert from "node:assert/strict";
import { test } from "node:test";
import { CANONICAL_MOODS, type Mood } from "../../mood/src/index.ts";
import { AliveController } from "./controller.ts";
import { SKILL_LIST } from "./data/skills.ts";
import { pickSkill } from "./skills.ts";
import { sampleIdle, type PoseSample } from "./pose.ts";
import { POSE_LIMITS } from "./tuning.ts";
import type { AliveInput, SkillContext, SkillId } from "./types.ts";

function ctx(over: Partial<SkillContext> = {}): SkillContext {
  return {
    noticedPlayer: false,
    playerVisible: false,
    distance: 0,
    playerMoving: false,
    summon: false,
    sleepRequested: false,
    settled: false,
    explorePoints: 5,
    adviceGoal: null,
    ...over,
  };
}

function input(over: Partial<AliveInput> = {}): AliveInput {
  return {
    nowMs: 0,
    dt: 0.05,
    playerX: 0,
    playerZ: 0,
    playerVisible: true,
    camForwardX: 0,
    camForwardZ: -1,
    sleepRequested: false,
    summon: false,
    moodOverride: null,
    ...over,
  };
}

test("skill list is data: four skills, one always-valid fallback", () => {
  assert.equal(SKILL_LIST.length, 4);
  const ids = SKILL_LIST.map((skill) => skill.id).sort();
  assert.deepEqual(ids, ["explore", "follow", "idle-roll", "sleep"]);
  const fallbacks = SKILL_LIST.filter((skill) => skill.fallback);
  assert.equal(fallbacks.length, 1);
  assert.equal(fallbacks[0]!.id, "idle-roll");
  const idle = SKILL_LIST.find((skill) => skill.id === "idle-roll")!;
  for (const skill of SKILL_LIST) {
    if (skill.id !== "idle-roll") assert.ok(skill.priority > idle.priority);
  }
});

test("nothing else valid falls through to idle-roll", () => {
  assert.equal(pickSkill(SKILL_LIST, ctx({ explorePoints: 0 })), "idle-roll");
  assert.equal(pickSkill([], ctx()), "idle-roll");
});

test("he does not follow or wander during the notice window", () => {
  assert.equal(
    pickSkill(SKILL_LIST, ctx({ playerVisible: true, noticedPlayer: false, distance: 3 })),
    "idle-roll",
  );
});

test("follow wins when the partner is moving, and explore advice is ignored", () => {
  const moving = ctx({
    noticedPlayer: true,
    playerVisible: true,
    playerMoving: true,
    distance: 2,
    adviceGoal: "explore",
  });
  assert.equal(pickSkill(SKILL_LIST, moving), "follow");
});

test("sleep beats explore when asked, and loses when the partner moves", () => {
  const napping = ctx({
    noticedPlayer: true,
    playerVisible: true,
    sleepRequested: true,
    settled: true,
    distance: 1,
  });
  assert.equal(pickSkill(SKILL_LIST, napping), "sleep");
  assert.equal(pickSkill(SKILL_LIST, { ...napping, playerMoving: true }), "follow");
});

test("explore runs once he has settled beside a still partner", () => {
  assert.equal(
    pickSkill(
      SKILL_LIST,
      ctx({ noticedPlayer: true, playerVisible: true, settled: true, distance: 1.1 }),
    ),
    "explore",
  );
});

test("sleep advice is ignored while the partner is moving", () => {
  assert.equal(
    pickSkill(
      SKILL_LIST,
      ctx({
        noticedPlayer: true,
        playerVisible: true,
        playerMoving: true,
        adviceGoal: "sleep",
        distance: 1,
      }),
    ),
    "follow",
  );
});

test("priority comes from the data list, not from source order", () => {
  const flipped = [
    { id: "follow" as SkillId, priority: 1, fallback: false },
    { id: "idle-roll" as SkillId, priority: 9, fallback: true },
  ];
  assert.equal(
    pickSkill(flipped, ctx({ noticedPlayer: true, playerVisible: true, playerMoving: true })),
    "idle-roll",
  );
});

test("tick is synchronous and reuses its frame and spot objects", () => {
  const sim = new AliveController({ x: 1.7, z: 0.5, seed: 2 });
  const first = sim.tick(input({ nowMs: 50 }));
  assert.ok(!(first instanceof Promise));
  const spot = sim.spots[0];
  const second = sim.tick(input({ nowMs: 100 }));
  assert.equal(first, second);
  assert.equal(sim.spots[0], spot);
  assert.equal(second.skill, "idle-roll");
  assert.equal(second.noticedPlayer, false);
});

test("a bad explore suggestion does not pull him off a follow", () => {
  const sim = new AliveController({ x: 0, z: 0, seed: 3, noticeMs: 100 });
  let now = 0;
  let frame = sim.tick(input({ nowMs: now }));
  for (let i = 0; i < 4; i++) {
    now += 50;
    frame = sim.tick(input({ nowMs: now, dt: 0.05 }));
  }
  assert.equal(frame.noticedPlayer, true);
  sim.offerAdvice({ goal: "explore", mood: "sad", because: "nope" }, now);
  now += 50;
  frame = sim.tick(
    input({ nowMs: now, dt: 0.05, playerX: 3, playerZ: 0, playerVisible: true }),
  );
  assert.equal(frame.skill, "follow");
  assert.equal(frame.adviceGoal, "explore");
});

test("idle-roll faces the partner instead of spinning", () => {
  const sim = new AliveController({ x: 0, z: 0, seed: 1, noticeMs: 200 });
  const seen = input({
    nowMs: 0,
    dt: 0.05,
    playerX: 1,
    playerZ: 0.2,
    playerVisible: true,
  });
  let frame = sim.tick(seen);
  for (let i = 0; i < 20; i++) {
    seen.nowMs += 50;
    frame = sim.tick(seen);
  }
  assert.equal(frame.skill, "idle-roll");
  assert.ok(frame.yaw > 0.6, `yaw ${frame.yaw}`);
});

test("stepping out clears the notice so he has to look again", () => {
  const sim = new AliveController({ x: 0, z: 0, seed: 2, noticeMs: 400 });
  const seen = input({ nowMs: 0, dt: 0.05, playerX: 0.2, playerZ: 0.2, playerVisible: true });
  let frame = sim.tick(seen);
  for (let i = 0; i < 12; i++) {
    seen.nowMs += 50;
    frame = sim.tick(seen);
  }
  assert.equal(frame.noticedPlayer, true);
  seen.playerVisible = false;
  seen.nowMs += 50;
  frame = sim.tick(seen);
  assert.equal(frame.noticedPlayer, false);
  seen.playerVisible = true;
  seen.nowMs += 50;
  frame = sim.tick(seen);
  assert.equal(frame.noticedPlayer, false);
  for (let i = 0; i < 10; i++) {
    seen.nowMs += 50;
    frame = sim.tick(seen);
  }
  assert.equal(frame.noticedPlayer, true);
});

test("clearing advice lets a wake stick instead of nodding off again", () => {
  const sim = new AliveController({ x: 0, z: 0, seed: 1, noticeMs: 50 });
  const seen = input({ nowMs: 0, dt: 0.05, playerX: 0.4, playerZ: 0, playerVisible: true });
  let frame = sim.tick(seen);
  for (let i = 0; i < 80; i++) {
    seen.nowMs += 50;
    frame = sim.tick(seen);
  }
  sim.offerAdvice({ goal: "sleep", mood: "neutral", because: "quiet" }, seen.nowMs);
  seen.nowMs += 50;
  frame = sim.tick(seen);
  assert.equal(frame.skill, "sleep");
  assert.equal(frame.clip, "closed");
  sim.clearAdvice();
  seen.nowMs += 50;
  frame = sim.tick(seen);
  assert.notEqual(frame.skill, "sleep");
  assert.notEqual(frame.clip, "closed");
});

test("pose offsets stay inside the clip-safe limits for every canonical mood", () => {
  const out: PoseSample = { bob: 0, hop: 0, roll: 0, flap: 0, headTilt: 0, eye: 0 };
  const clips = ["idle", "happy", "closed"] as const;
  for (const mood of CANONICAL_MOODS) {
    for (const clip of clips) {
      for (let step = 0; step < 8; step++) {
        sampleIdle(mood as Mood, step * 0.37, clip, out);
        assert.ok(out.bob >= 0 && out.bob <= POSE_LIMITS.bobMax + 1e-9, mood);
        assert.ok(out.hop >= 0 && out.hop <= POSE_LIMITS.hopMax + 1e-9, mood);
        assert.ok(Math.abs(out.roll) <= POSE_LIMITS.rollMax + 1e-9, mood);
        assert.ok(out.flap >= 0 && out.flap <= POSE_LIMITS.flapMax + 1e-9, mood);
        assert.ok(Math.abs(out.headTilt) <= POSE_LIMITS.headTiltMax + 1e-9, mood);
        assert.equal(out.flap, clip === "closed" ? 0 : out.flap);
      }
    }
  }
});
