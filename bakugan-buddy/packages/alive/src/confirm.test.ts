import assert from "node:assert/strict";
import test from "node:test";
import { confirmFor, estimatePaidCostUsd, formatUsd } from "./confirm.ts";

test("paid work always names a price and waits for a yes", () => {
  const card = confirmFor({ kind: "paid", promptChars: 400 });
  assert.equal(card.title, "Ask DeepSeek for this?");
  assert.match(card.body, /About \$0\.00\d/);
  assert.equal(card.yes, "Yes");
  assert.equal(card.no, "No");
  assert.equal(card.danger, false);
});

test("the price follows the prompt length and a known cost wins", () => {
  const small = estimatePaidCostUsd(400);
  const large = estimatePaidCostUsd(40_000);
  assert.ok(large > small);
  assert.equal(formatUsd(0.42), "$0.42");
  assert.equal(formatUsd(0.0013), "$0.001");
  assert.match(confirmFor({ kind: "paid", costUsd: 0.42 }).body, /\$0\.42/);
});

test("deleting notes asks with the count and a danger card", () => {
  const one = confirmFor({ kind: "delete_notes", count: 1 });
  assert.equal(one.title, "Delete 1 note?");
  assert.equal(one.danger, true);
  assert.equal(one.yes, "Yes");
  assert.equal(one.no, "No");
  assert.equal(confirmFor({ kind: "delete_notes", count: 3 }).title, "Delete 3 notes?");
});
