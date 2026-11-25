import assert from "node:assert/strict";
import test from "node:test";
import { cueForBodyState } from "./presenceCue.ts";

test("presence maps honest activity to one quiet cue", () => {
  assert.equal(cueForBodyState("listening"), "pop-open");
  assert.equal(cueForBodyState("thinking"), "hmm");
  assert.equal(cueForBodyState("working"), "hmm");
  assert.equal(cueForBodyState("speaking"), "whoop");
  assert.equal(cueForBodyState("resting"), null);
});
