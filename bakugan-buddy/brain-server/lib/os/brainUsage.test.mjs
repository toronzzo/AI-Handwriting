import { test } from "node:test";
import assert from "node:assert/strict";
import { paidCostUsd, parseJsonUsage, parseSseUsage, tokensPerSec } from "./brainUsage.mjs";

test("parseSseUsage takes the usage chunk out of a streamed reply", () => {
  const stream = [
    'data: {"choices":[{"delta":{"content":"hi"}}]}',
    'data: {"choices":[{"delta":{"content":"!"}}],"usage":{"prompt_tokens":10,"completion_tokens":4}}',
    "data: [DONE]",
  ].join("\n");
  assert.deepEqual(parseSseUsage(stream), { prompt_tokens: 10, completion_tokens: 4 });
});

test("parseSseUsage ignores torn lines and streams without usage", () => {
  assert.equal(parseSseUsage("data: [DONE]\ndata: {broken"), null);
  assert.equal(parseSseUsage('data: {"choices":[{"delta":{"content":"x"}}]}'), null);
  assert.equal(parseSseUsage(""), null);
});

test("parseJsonUsage reads a non-stream body", () => {
  const body = JSON.stringify({ choices: [{ message: { content: "hi" } }], usage: { prompt_tokens: 3, completion_tokens: 7 } });
  assert.deepEqual(parseJsonUsage(body), { prompt_tokens: 3, completion_tokens: 7 });
  assert.equal(parseJsonUsage('{"error": "down"}'), null);
  assert.equal(parseJsonUsage("not json"), null);
});

test("tokensPerSec divides completion tokens by wall time, one decimal", () => {
  assert.equal(tokensPerSec({ completion_tokens: 20 }, 1_000, 3_000), 10);
  assert.equal(tokensPerSec({ completion_tokens: 5 }, 1_000, 2_000), 5);
  assert.equal(tokensPerSec({ completion_tokens: 0 }, 1_000, 3_000), null);
  assert.equal(tokensPerSec({}, 1_000, 3_000), null);
  assert.equal(tokensPerSec(null, 1_000, 3_000), null);
  assert.equal(tokensPerSec({ completion_tokens: 20 }, 3_000, 1_000), null, "time never runs backwards");
});

test("paidCostUsd follows the app's DeepSeek Flash pricing", () => {
  // 2026-11-20 is a Friday; 03:00 UTC is peak time, 12:00 UTC is off-peak.
  const peak = paidCostUsd({ prompt_tokens: 1_000, completion_tokens: 500 }, Date.UTC(2026, 10, 20, 3, 0, 0));
  const offPeak = paidCostUsd({ prompt_tokens: 1_000, completion_tokens: 500 }, Date.UTC(2026, 10, 20, 12, 0, 0));
  assert.equal(typeof peak, "number");
  assert.ok(peak > 0.0005 && peak < 0.002, `peak cost sane: ${peak}`);
  assert.equal(typeof offPeak, "number");
  assert.ok(offPeak > 0 && offPeak < peak, "off-peak costs less than peak");
  assert.equal(paidCostUsd(null), null);
  assert.equal(paidCostUsd({ prompt_tokens: 0, completion_tokens: 0 }), null);
});
