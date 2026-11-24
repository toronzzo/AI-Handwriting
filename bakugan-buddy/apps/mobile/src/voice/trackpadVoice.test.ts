/// <reference types="node" />
import assert from "node:assert/strict";
import test from "node:test";
import { TRACKPAD_CACHE_MS, rememberTrackpadVoice, trackpadCarriesVoice } from "./trackpadVoice.ts";

test("the trackpad is not the speaker until the brain says so", () => {
  rememberTrackpadVoice(false, 1_000);
  assert.equal(trackpadCarriesVoice(1_000), false);
});

test("a recent answer is believed for a few seconds, then asked again", () => {
  rememberTrackpadVoice(true, 1_000);
  assert.equal(trackpadCarriesVoice(1_000), true);
  assert.equal(trackpadCarriesVoice(1_000 + TRACKPAD_CACHE_MS - 1), true);
  assert.equal(trackpadCarriesVoice(1_000 + TRACKPAD_CACHE_MS), false);
});

test("turning the switch off takes effect at once", () => {
  rememberTrackpadVoice(true, 5_000);
  rememberTrackpadVoice(false, 5_000);
  assert.equal(trackpadCarriesVoice(5_000), false);
});
