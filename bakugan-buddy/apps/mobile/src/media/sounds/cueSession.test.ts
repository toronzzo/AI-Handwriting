/// <reference types="node" />
import assert from "node:assert/strict";
import test from "node:test";
import { CUE_MAX_MS, CUE_WINDOW_MS, type Cue } from "./cues.ts";
import { createCueSession, type CueDeps, type CuePlayer } from "./cueSession.ts";

/**
 * Every rule a cue passes through, driven by a fake player and a fake clock:
 * the switch, a missing backend, a hidden page, reduced motion, unknown ids,
 * the 3 s window, one-at-a-time playback, the failsafe stop and cleanup.
 */

type Fake = CuePlayer & { started: number; stopped: number; failPlay?: boolean };

function harness(overrides: Partial<CueDeps> = {}) {
  let now = 1000;
  let enabled = true;
  let available = true;
  let hidden = false;
  let reduce = false;
  const players: Fake[] = [];
  const ended: Cue[] = [];
  let failOpen = false;
  const deps: CueDeps = {
    enabled: () => enabled,
    available: () => available,
    hidden: () => hidden,
    reduce: () => reduce,
    now: () => now,
    open: () => {
      if (failOpen) return null;
      const fake: Fake = {
        started: 0,
        stopped: 0,
        play: () => {
          if (fake.failPlay) throw new Error("backend refused");
          fake.started += 1;
        },
        stop: () => {
          fake.stopped += 1;
        },
      };
      players.push(fake);
      return fake;
    },
    onEnded: (cue) => ended.push(cue),
    ...overrides,
  };
  const session = createCueSession(deps);
  return {
    session,
    players,
    ended,
    get now() {
      return now;
    },
    advance(ms: number) {
      now += ms;
    },
    set: (patch: { enabled?: boolean; available?: boolean; hidden?: boolean; reduce?: boolean; failOpen?: boolean }) => {
      if (patch.enabled !== undefined) enabled = patch.enabled;
      if (patch.available !== undefined) available = patch.available;
      if (patch.hidden !== undefined) hidden = patch.hidden;
      if (patch.reduce !== undefined) reduce = patch.reduce;
      if (patch.failOpen !== undefined) failOpen = patch.failOpen;
    },
  };
}

test("a known cue plays, quietly, once", () => {
  const h = harness();
  const result = h.session.play("laugh");
  assert.deepEqual(result, { played: true, id: "laugh" });
  assert.equal(h.players.length, 1);
  assert.equal(h.players[0].started, 1);
  assert.equal(h.session.current(), "laugh");
  h.session.stop();
});

test("an unknown cue is refused and never reaches the audio backend", () => {
  const h = harness();
  for (const id of ["nope", "", null, undefined, 7, { id: "laugh" }]) {
    assert.deepEqual(h.session.play(id), { played: false, reason: "unknown" });
  }
  assert.equal(h.players.length, 0);
});

test("the switch being off stops a cue that is already playing", () => {
  const h = harness();
  assert.equal(h.session.play("whoop").played, true);
  h.set({ enabled: false });
  assert.deepEqual(h.session.play("hmm"), { played: false, reason: "disabled" });
  // Turning the switch off is what the Settings row does: it stops playback.
  h.session.stop();
  assert.equal(h.session.current(), null);
  assert.equal(h.players[0].stopped, 1);
});

test("a hidden page gets no sound", () => {
  const h = harness();
  h.set({ hidden: true });
  assert.deepEqual(h.session.play("gasp"), { played: false, reason: "hidden" });
  assert.equal(h.players.length, 0);
});

test("reduced motion skips transition cues", () => {
  const h = harness();
  h.set({ reduce: true });
  assert.deepEqual(h.session.play("pop-open"), { played: false, reason: "reduced-motion" });
  assert.equal(h.players.length, 0);
});

test("a second cue inside the window is suppressed, one after it plays", () => {
  const h = harness();
  assert.equal(h.session.play("laugh").played, true);
  h.advance(CUE_WINDOW_MS - 1);
  assert.deepEqual(h.session.play("gasp"), { played: false, reason: "window" });
  h.advance(1);
  assert.equal(h.session.play("gasp").played, true);
  h.session.stop();
});

test("the window is measured from the last cue that actually played", () => {
  const h = harness();
  h.advance(10_000);
  assert.equal(h.session.play("laugh").played, true);
  // A refused cue (here: hidden) does not restart the window.
  h.set({ hidden: true });
  assert.equal(h.session.play("gasp").played, false);
  h.set({ hidden: false });
  assert.equal(h.session.play("droop").played, false, "still inside the window of the played cue");
  h.session.stop();
});

test("a new cue takes the speaker from the old one and frees it", () => {
  const h = harness();
  assert.equal(h.session.play("laugh").played, true);
  h.advance(CUE_WINDOW_MS);
  assert.equal(h.session.play("hmm").played, true);
  assert.equal(h.players.length, 2);
  assert.equal(h.players[0].stopped, 1, "the first player is released");
  assert.equal(h.session.current(), "hmm");
  h.session.stop();
  assert.equal(h.players[1].stopped, 1);
});

test("stop is idempotent and cleanup runs exactly once per player", () => {
  const h = harness();
  h.session.play("laugh");
  h.session.stop();
  h.session.stop();
  h.session.stop();
  assert.equal(h.players[0].stopped, 1);
  assert.equal(h.ended.length, 1);
  assert.equal(h.ended[0].id, "laugh");
});

test("a cue that never reports back is cut off by the failsafe timer", () => {
  const h = harness();
  h.session.play("droop");
  assert.equal(h.players[0].stopped, 0);
  // The player is bounded by CUE_MAX_MS even with no "ended" event.
  return new Promise<void>((resolve) => {
    setTimeout(() => {
      assert.equal(h.players[0].stopped, 1, "the failsafe stopped the player");
      assert.equal(h.session.current(), null);
      resolve();
    }, CUE_MAX_MS + 50);
  });
});

test("no audio backend is a silent skip, not an error", () => {
  const h = harness();
  h.set({ failOpen: true });
  assert.deepEqual(h.session.play("laugh"), { played: false, reason: "failed" });
  assert.equal(h.session.current(), null);
  h.set({ failOpen: false });
  assert.equal(h.session.play("laugh").played, true, "recovers when audio comes back");
  h.session.stop();
});

test("a backend that throws on play is caught and cleaned up", () => {
  const h = harness({
    open: () => ({
      play: () => {
        throw new Error("autoplay blocked");
      },
      stop: () => {},
    }),
  });
  assert.deepEqual(h.session.play("laugh"), { played: false, reason: "failed" });
  assert.equal(h.session.current(), null);
});

test("available() false means the platform has no audio", () => {
  const h = harness();
  h.set({ available: false });
  assert.deepEqual(h.session.play("laugh"), { played: false, reason: "unavailable" });
  assert.equal(h.players.length, 0);
});

test("a stop() that throws never escapes the session", () => {
  const h = harness({
    open: () => ({
      play: () => {},
      stop: () => {
        throw new Error("already gone");
      },
    }),
  });
  h.session.play("laugh");
  assert.doesNotThrow(() => h.session.stop());
  assert.equal(h.session.current(), null);
});
