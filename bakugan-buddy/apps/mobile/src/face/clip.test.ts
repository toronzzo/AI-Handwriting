/// <reference types="node" />
import assert from "node:assert/strict";
import test from "node:test";
import { clipForExpression } from "./clip.ts";
import { FACE_EXPRESSIONS, type FaceExpression } from "./expression.ts";
import { PREYAS_CLIPS } from "../screens/preyasClips.ts";

test("every face expression maps to a clip the ball actually has", () => {
  for (const expression of FACE_EXPRESSIONS) {
    const clip = clipForExpression(expression as FaceExpression);
    assert.ok((PREYAS_CLIPS as readonly string[]).includes(clip), expression + " -> " + clip);
  }
});

test("talking opens the shell, happy hops, sad and sleepy close it", () => {
  assert.equal(clipForExpression("talking"), "open");
  assert.equal(clipForExpression("excited"), "open");
  assert.equal(clipForExpression("happy"), "happy");
  assert.equal(clipForExpression("sad"), "closed");
  assert.equal(clipForExpression("sleepy"), "closed");
  assert.equal(clipForExpression("listening"), "idle");
  assert.equal(clipForExpression("thinking"), "idle");
});
