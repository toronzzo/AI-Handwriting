import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";
import { AliveController } from "./controller.ts";
import { createBrainAdvisor } from "./brain.ts";
import type { AdvisorInput } from "./advisor.ts";
import type { AliveInput } from "./types.ts";

function sse(content: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n`;
}

function advisorInput(): AdvisorInput {
  return {
    nowMs: 0,
    skill: "idle-roll",
    mood: "neutral",
    noticedPlayer: true,
    playerMoving: false,
    distance: 1,
    sleepRequested: false,
    settled: true,
    events: [{ t: 1, name: "explore", detail: "window" }],
    facts: ["The partner likes the window."],
    partnerName: "partner",
  };
}

function tickInput(nowMs: number): AliveInput {
  return {
    nowMs,
    dt: 0.016,
    playerX: 0.2,
    playerZ: 0.2,
    playerVisible: true,
    camForwardX: 0,
    camForwardZ: -1,
    sleepRequested: false,
    summon: false,
    moodOverride: null,
  };
}

test("a fake brain answers in character, dies, and never stalls the sim tick", async () => {
  let hits = 0;
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const line = "Corner's mine. Don't rush me.";
  const server = http.createServer((req, res) => {
    if (req.method === "GET" && req.url === "/v1/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ service: "bakugan-brain", ok: true }));
      return;
    }
    hits += 1;
    if (hits === 1) {
      void gate.then(() => {
        const body = sse(
          JSON.stringify({ line, goal: "explore", mood: "happy", moodDelta: 1 }),
        );
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.end(body);
      });
      return;
    }
    if (hits === 2) {
      res.writeHead(500, { "content-type": "text/plain" });
      res.end("dead");
      return;
    }
    req.socket.destroy();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no port");
  const advisor = createBrainAdvisor({
    baseUrl: `http://127.0.0.1:${address.port}`,
    minIntervalMs: 0,
    timeoutMs: 2000,
  });
  const sim = new AliveController({ x: 0, z: 0, seed: 3 });

  const pending = advisor.advise(advisorInput());
  const started = performance.now();
  for (let i = 0; i < 200; i++) sim.tick(tickInput(1_000 + i * 16));
  const elapsed = performance.now() - started;
  assert.ok(elapsed < 100, `200 ticks took ${elapsed.toFixed(1)} ms while the brain was hung`);

  release();
  const suggestion = await pending;
  assert.ok(suggestion);
  assert.equal(suggestion.line, line);
  assert.equal(suggestion.goal, "explore");
  assert.equal(suggestion.mood, "happy");
  assert.equal(suggestion.line.toLowerCase().includes("as an ai"), false);

  sim.offerAdvice(suggestion, 5_000);
  const spoken = sim.tick(tickInput(5_000));
  assert.equal(spoken.bark, line);

  const fallen = await advisor.advise(advisorInput());
  assert.equal(fallen, null);
  const after = sim.tick(tickInput(6_000));
  assert.equal(typeof after.skill, "string");
  assert.equal(after.x === after.x, true);

  const dead = await advisor.advise(advisorInput());
  assert.equal(dead, null);
  server.close();
});
