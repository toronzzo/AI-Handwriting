import assert from "node:assert/strict";
import { test } from "node:test";
import { AliveController } from "./controller.ts";
import { createBrainAdvisor, parseBrainReply, type BrainReply } from "./brain.ts";
import type { AdvisorInput } from "./advisor.ts";
import type { AliveInput } from "./types.ts";

const good: BrainReply = {
  line: "Your pace, my pride. We're even.",
  goal: "follow",
  mood: "happy",
  moodDelta: 1,
};

function sse(content: string): string {
  const payload = JSON.stringify({ choices: [{ delta: { content } }] });
  return `data: ${payload}\n\ndata: [DONE]\n`;
}

function input(over: Partial<AdvisorInput> = {}): AdvisorInput {
  return {
    nowMs: 0,
    skill: "idle-roll",
    mood: "neutral",
    noticedPlayer: true,
    playerMoving: false,
    distance: 1,
    sleepRequested: false,
    settled: true,
    events: [],
    ...over,
  };
}

function frameInput(over: Partial<AliveInput> = {}): AliveInput {
  return {
    nowMs: 0,
    dt: 0.05,
    playerX: 0,
    playerZ: 0,
    playerVisible: false,
    camForwardX: 0,
    camForwardZ: -1,
    sleepRequested: false,
    summon: false,
    moodOverride: null,
    ...over,
  };
}

test("parseBrainReply accepts one JSON object and ignores a think tag", () => {
  const raw = `<think>planning</think>\n\`\`\`json\n${JSON.stringify(good)}\n\`\`\``;
  const parsed = parseBrainReply(raw);
  assert.deepEqual(parsed, good);
});

test("parseBrainReply rejects a bad goal, a missing delta, and an assistant refusal", () => {
  assert.equal(parseBrainReply('{"line":"Hi","goal":"fly","mood":"happy","moodDelta":1}'), null);
  assert.equal(parseBrainReply('{"line":"Hi","goal":"follow","mood":"happy"}'), null);
  assert.equal(parseBrainReply("not json"), null);
  assert.equal(
    parseBrainReply(
      '{"line":"As an AI I cannot assist","goal":"idle-roll","mood":"neutral","moodDelta":0}',
    ),
    null,
  );
});

test("a dead brain returns null and does not throw", async () => {
  const down = createBrainAdvisor({
    baseUrl: "http://brain.local",
    minIntervalMs: 0,
    fetchImpl: async () => new Response("nope", { status: 503 }),
  });
  assert.equal(await down.advise(input()), null);

  const junk = createBrainAdvisor({
    baseUrl: "http://brain.local",
    minIntervalMs: 0,
    fetchImpl: async () => new Response(sse("hello there"), { status: 200 }),
  });
  assert.equal(await junk.advise(input()), null);

  const boom = createBrainAdvisor({
    baseUrl: "http://brain.local",
    minIntervalMs: 0,
    fetchImpl: async () => {
      throw new Error("offline");
    },
  });
  assert.equal(await boom.advise(input()), null);
});

test("the brain is rate limited and a busy call does not start another request", async () => {
  let now = 10_000;
  let calls = 0;
  let release: (value: Response) => void = () => {};
  const gate = new Promise<Response>((resolve) => {
    release = resolve;
  });
  const advisor = createBrainAdvisor({
    baseUrl: "http://brain.local",
    minIntervalMs: 8_000,
    now: () => now,
    fetchImpl: () => {
      calls += 1;
      if (calls === 1) return gate;
      return Promise.resolve(new Response(sse(JSON.stringify(good)), { status: 200 }));
    },
  });
  const first = advisor.advise(input());
  const second = await advisor.advise(input());
  assert.equal(second, null);
  assert.equal(calls, 1);
  release(new Response(sse(JSON.stringify(good)), { status: 200 }));
  const suggestion = await first;
  assert.equal(suggestion?.line, good.line);
  assert.equal(suggestion?.moodDelta, 1);
  now += 1_000;
  assert.equal(await advisor.advise(input()), null);
  assert.equal(calls, 1);
  now += 8_000;
  const third = await advisor.advise(input());
  assert.equal(calls, 2);
  assert.equal(third?.goal, "follow");
});

test("a hung brain times out and returns null", async () => {
  const advisor = createBrainAdvisor({
    baseUrl: "http://brain.local",
    minIntervalMs: 0,
    timeoutMs: 30,
    fetchImpl: (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(new Error("aborted")));
      }),
  });
  const suggestion = await advisor.advise(input());
  assert.equal(suggestion, null);
});

test("moodDelta 0 leaves the mood to the body, and a line replaces the bark", () => {
  const held = new AliveController({ x: 0, z: 0, seed: 1, mood: "sad" });
  held.offerAdvice({ goal: "explore", mood: "angry", because: "no", moodDelta: 0 }, 5_000);
  const quiet = held.tick(frameInput({ nowMs: 5_000, playerVisible: false }));
  assert.notEqual(quiet.mood, "angry");

  const pushed = new AliveController({ x: 0, z: 0, seed: 1, mood: "sad" });
  pushed.offerAdvice({ goal: "explore", mood: "angry", because: "yes", moodDelta: 1, line: "Watch this." }, 5_000);
  const loud = pushed.tick(frameInput({ nowMs: 5_000, playerVisible: false }));
  assert.equal(loud.mood, "angry");
  assert.equal(loud.bark, "Watch this.");
});
