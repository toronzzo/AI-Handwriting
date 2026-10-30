import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";
import { AliveController } from "./controller.ts";
import {
  envelopeFromPcm16,
  freshVad,
  prosodyFor,
  stepVad,
  synthesizeLine,
  takeSentences,
  transcribeClip,
} from "./speech.ts";
import type { AliveInput } from "./types.ts";

test("vad endpoints when he stops talking and barges in on the next start", () => {
  let state = freshVad();
  let step = stepVad(state, 0.01, 50);
  assert.equal(step.bargeIn, false);
  step = stepVad(step.state, 0.2, 100);
  assert.equal(step.bargeIn, true);
  state = step.state;
  step = stepVad(state, 0.2, 200);
  assert.equal(step.endpoint, false);
  step = stepVad(step.state, 0.01, 500);
  assert.equal(step.endpoint, true);
  const again = stepVad(step.state, 0.3, 40);
  assert.equal(again.bargeIn, true);
});

test("sentences split in English and Russian and keep a partial tail", () => {
  const split = takeSentences("Corner's mine. Привет! Still going");
  assert.deepEqual(split.ready, ["Corner's mine.", "Привет!"]);
  assert.equal(split.rest, "Still going");
});

test("excited is faster than sleepy, and Russian picks the Russian voice", () => {
  const excited = prosodyFor("excited", "en");
  const sleepy = prosodyFor("sleepy", "ru");
  assert.ok(excited.lengthScale < sleepy.lengthScale);
  assert.equal(excited.voiceId, "am_puck");
  assert.equal(sleepy.voiceId, "ru_RU-dmitri-medium");
});

test("envelope stays in 0..1", () => {
  const samples = new Int16Array(640);
  for (let i = 0; i < samples.length; i++) samples[i] = i < 320 ? 16000 : 0;
  const env = envelopeFromPcm16(samples, 320);
  assert.equal(env.length, 2);
  assert.ok(env[0]! > env[1]!);
  assert.ok(env[0]! <= 1);
});

function wavHeader(): Buffer {
  const buf = Buffer.alloc(44);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(16000, 24);
  buf.write("data", 36);
  return buf;
}

test("fake stt and tts answer, then a dead speech server falls back", async () => {
  let alive = true;
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const server = http.createServer((req, res) => {
    if (!alive) {
      req.socket.destroy();
      return;
    }
    if (req.url === "/v1/stt") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ text: "Привет, Преяс", language: "ru" }));
      return;
    }
    if (req.url === "/v1/tts") {
      void gate.then(() => {
        res.writeHead(200, { "content-type": "audio/wav" });
        res.end(wavHeader());
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no port");
  const base = `http://127.0.0.1:${address.port}`;

  const t0 = performance.now();
  const heard = await transcribeClip(base, new Uint8Array([1, 2, 3]));
  const sttMs = performance.now() - t0;
  console.log(`fake stt roundtrip ${sttMs.toFixed(1)} ms (VM overhead, not a model)`);
  assert.ok(sttMs < 500);
  assert.equal(heard?.text, "Привет, Преяс");
  assert.equal(heard?.language, "ru");

  const pending = synthesizeLine(base, "Hey.", "excited", "en");
  const sim = new AliveController({ x: 0, z: 0, seed: 1 });
  const input: AliveInput = {
    nowMs: 0,
    dt: 0.016,
    playerX: 0,
    playerZ: 0,
    playerVisible: true,
    camForwardX: 0,
    camForwardZ: -1,
    sleepRequested: false,
    summon: false,
    moodOverride: null,
  };
  const started = performance.now();
  for (let i = 0; i < 200; i++) {
    input.nowMs = i * 16;
    sim.tick(input);
  }
  const elapsed = performance.now() - started;
  assert.ok(elapsed < 100, `ticks took ${elapsed.toFixed(1)} ms while tts hung`);
  release();
  const wav = await pending;
  assert.ok(wav);
  assert.equal(String.fromCharCode(wav[0]!, wav[1]!, wav[2]!, wav[3]!), "RIFF");

  alive = false;
  assert.equal(await transcribeClip(base, new Uint8Array([1]), 300), null);
  assert.equal(await synthesizeLine(base, "Hi", "happy", "en", undefined, 300), null);
  server.close();
});
