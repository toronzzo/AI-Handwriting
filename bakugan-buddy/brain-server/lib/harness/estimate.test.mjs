import assert from "node:assert/strict";
import test from "node:test";
import {
  CHARS_PER_TOKEN,
  DEFAULT_OUT_TOKENS_MAX,
  PRICE_MISSING_MESSAGE,
  estimatePrompt,
  outTokensMaxOf,
  priceConfigured,
  usdForTokens,
} from "./estimate.mjs";

const PRICES = {
  HARNESS_USD_PER_MTOK_IN: "0.14",
  HARNESS_USD_PER_MTOK_OUT: "0.28",
};

test("estimatePrompt: no prices means null (fail closed), never zero", () => {
  assert.equal(estimatePrompt("hello", {}), null);
  assert.equal(estimatePrompt("hello", { HARNESS_USD_PER_MTOK_IN: "0.14" }), null);
  assert.equal(estimatePrompt("hello", { HARNESS_USD_PER_MTOK_OUT: "0.28" }), null);
  assert.equal(PRICE_MISSING_MESSAGE, "Set HARNESS_USD_PER_MTOK_IN and _OUT in brain.env (check the DeepSeek price page)");
});

test("estimatePrompt: a blank or useless price counts as missing", () => {
  assert.equal(estimatePrompt("hello", { HARNESS_USD_PER_MTOK_IN: "", HARNESS_USD_PER_MTOK_OUT: "0.28" }), null);
  assert.equal(estimatePrompt("hello", { HARNESS_USD_PER_MTOK_IN: "abc", HARNESS_USD_PER_MTOK_OUT: "0.28" }), null);
  assert.equal(estimatePrompt("hello", { HARNESS_USD_PER_MTOK_IN: "0", HARNESS_USD_PER_MTOK_OUT: "0.28" }), null);
  assert.equal(estimatePrompt("hello", { HARNESS_USD_PER_MTOK_IN: "0.14", HARNESS_USD_PER_MTOK_OUT: "-1" }), null);
});

test("estimatePrompt: tokens are a rough chars/4 and the output cap defaults to 20000", () => {
  const prompt = "x".repeat(400);
  const estimate = estimatePrompt(prompt, PRICES);
  assert.equal(estimate.inTokens, Math.ceil(prompt.length / CHARS_PER_TOKEN));
  assert.equal(estimate.inTokens, 100);
  assert.equal(estimate.outTokensMax, DEFAULT_OUT_TOKENS_MAX);
  assert.equal(estimate.outTokensMax, 20000);
  assert.match(estimate.basis, /rough/i);
});

test("estimatePrompt: usdLow is the 25% output case, usdHigh the whole allowance", () => {
  const estimate = estimatePrompt("x".repeat(400), PRICES);
  const input = (100 * 0.14) / 1_000_000;
  assert.equal(estimate.usdLow, Math.round((input + (20000 * 0.25 * 0.28) / 1_000_000) * 1_000_000) / 1_000_000);
  assert.equal(estimate.usdHigh, Math.round((input + (20000 * 0.28) / 1_000_000) * 1_000_000) / 1_000_000);
  assert.ok(estimate.usdLow < estimate.usdHigh);
  assert.ok(estimate.usdHigh > 0);
});

test("estimatePrompt: HARNESS_OUT_TOKENS_MAX changes the allowance", () => {
  const estimate = estimatePrompt("x".repeat(4), { ...PRICES, HARNESS_OUT_TOKENS_MAX: "1000" });
  assert.equal(estimate.outTokensMax, 1000);
  assert.equal(estimatePrompt("x", { ...PRICES, HARNESS_OUT_TOKENS_MAX: "nope" }).outTokensMax, 20000);
  assert.equal(outTokensMaxOf({ HARNESS_OUT_TOKENS_MAX: "0" }), DEFAULT_OUT_TOKENS_MAX);
});

test("usdForTokens: actual cost when prices exist, null when they do not", () => {
  assert.equal(usdForTokens(1000, 500, PRICES), 0.00028);
  assert.equal(usdForTokens(1000, 500, {}), null);
  assert.equal(usdForTokens(-1, 5, PRICES), null);
  assert.equal(usdForTokens("x", 5, PRICES), null);
});

test("priceConfigured: only positive numbers count", () => {
  assert.equal(priceConfigured(PRICES), true);
  assert.equal(priceConfigured({ ...PRICES, HARNESS_USD_PER_MTOK_IN: "0" }), false);
});
