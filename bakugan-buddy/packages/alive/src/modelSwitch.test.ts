import assert from "node:assert/strict";
import test from "node:test";
import { confirmFor } from "./confirm.ts";
import { BIG_MIN_FREE_GB, LOCAL_MODEL_IDS, MODEL_LABELS, parseModelCommand, switchNeedsConfirm } from "./modelSwitch.ts";

test("parseModelCommand reads the three use commands", () => {
  assert.equal(parseModelCommand("use small"), "small");
  assert.equal(parseModelCommand("use big"), "big");
  assert.equal(parseModelCommand("use huge"), "huge");
  assert.equal(parseModelCommand("Use BIG please"), "big");
  assert.equal(parseModelCommand("use huge model now"), "huge");
  assert.equal(parseModelCommand("hello"), null);
  assert.equal(parseModelCommand("use medium"), null);
  assert.equal(parseModelCommand("please use small"), null);
  assert.equal(parseModelCommand("used small"), null);
  assert.equal(parseModelCommand(""), null);
});

test("small never needs a confirm card", () => {
  assert.equal(switchNeedsConfirm("small", 0), false);
  assert.equal(switchNeedsConfirm("small", 30), false);
  assert.equal(switchNeedsConfirm("small", null), false);
});

test("big needs a card under 10 GB free, and when memory is unknown", () => {
  assert.equal(switchNeedsConfirm("big", 9.9), true);
  assert.equal(switchNeedsConfirm("big", 0), true);
  assert.equal(switchNeedsConfirm("big", null), true);
  assert.equal(switchNeedsConfirm("big", 10), false);
  assert.equal(switchNeedsConfirm("big", BIG_MIN_FREE_GB), false);
  assert.equal(switchNeedsConfirm("big", 25.4), false);
});

test("huge always needs a card, even with plenty of memory", () => {
  assert.equal(switchNeedsConfirm("huge", 0), true);
  assert.equal(switchNeedsConfirm("huge", 50), true);
  assert.equal(switchNeedsConfirm("huge", null), true);
});

test("the slow-model card warns about slow replies and swap", () => {
  const big = confirmFor({ kind: "slow_model", target: "big", freeGb: 7.5 });
  assert.equal(big.kind, "slow_model");
  assert.equal(big.yes, "Yes");
  assert.equal(big.no, "No");
  assert.equal(big.danger, false);
  assert.match(big.title, /14B/);
  assert.match(big.body, /7\.5 GB free/);
  assert.match(big.body, /swap/);

  const huge = confirmFor({ kind: "slow_model", target: "huge", freeGb: null });
  assert.match(huge.title, /30B/);
  assert.doesNotMatch(huge.body, /GB free/);
  assert.match(huge.body, /very slow/);
});

test("every tier has a label and an id", () => {
  assert.deepEqual(LOCAL_MODEL_IDS, ["small", "big", "huge"]);
  for (const id of LOCAL_MODEL_IDS) {
    assert.equal(typeof MODEL_LABELS[id], "string");
    assert.ok(MODEL_LABELS[id].length > 0);
  }
});
