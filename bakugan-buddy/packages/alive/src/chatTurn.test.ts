import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CHAT_MAX_TOKENS,
  HISTORY_TOKEN_BUDGET,
  LOCAL_TIMEOUT_MS,
  chooseRoute,
  completionExtras,
  deepseekIsPeak,
  estimatePaidCost,
  estimateTokens,
  paidButton,
  parseSseBlock,
  stripThinking,
  visibleReply,
  partnerFromTurns,
  resolveChatBase,
  trimHistory,
  type ChatMessage,
} from "./chatTurn.ts";

test("history keeps the newest turns inside the 8B window", () => {
  const messages: ChatMessage[] = [];
  for (let i = 0; i < 40; i++) {
    messages.push({ role: "user", content: `turn ${i} `.repeat(80) });
    messages.push({ role: "assistant", content: `reply ${i} `.repeat(80), who: "preyas" });
  }
  const trimmed = trimHistory(messages, HISTORY_TOKEN_BUDGET);
  let tokens = 0;
  for (let i = 0; i < trimmed.length; i++) tokens += estimateTokens(trimmed[i]!.content) + 4;
  assert.ok(tokens <= HISTORY_TOKEN_BUDGET);
  assert.ok(trimmed.length < messages.length);
  assert.equal(trimmed[trimmed.length - 1]!.content.includes("reply 39"), true);
  assert.equal(trimmed[0]!.content.includes("turn 0"), false);
  assert.equal(CHAT_MAX_TOKENS, 512);
  assert.equal(LOCAL_TIMEOUT_MS, 60_000);
});

test("routing stays local unless asked or the local brain failed", () => {
  const base = { askPaid: false, localFailed: false, paidAvailable: true, allowPaidOnFailure: false };
  assert.equal(chooseRoute(base).route, "local");
  assert.equal(chooseRoute({ ...base, askPaid: true }).route, "paid");
  assert.equal(chooseRoute({ ...base, askPaid: true, paidAvailable: false }).route, "local");
  assert.equal(chooseRoute({ ...base, localFailed: true, allowPaidOnFailure: false }).route, "local");
  assert.equal(chooseRoute({ ...base, localFailed: true, allowPaidOnFailure: true }).route, "paid");
  assert.equal(chooseRoute({ ...base, localFailed: true, allowPaidOnFailure: true, paidAvailable: false }).route, "local");
});

test("paid cost uses flash cache-miss rates and peak is double", () => {
  const off = estimatePaidCost({ prompt_tokens: 1_000_000, completion_tokens: 1_000_000 }, false);
  const peak = estimatePaidCost({ prompt_tokens: 1_000_000, completion_tokens: 1_000_000 }, true);
  assert.equal(off, 0.75);
  assert.equal(peak, 1.5);
  assert.equal(estimatePaidCost(null), null);
});

test("the paid button stays off without a key and during off-peak-only peak hours", () => {
  const weekdayPeak = new Date("2026-11-02T02:30:00Z");
  const weekend = new Date("2026-11-01T02:30:00Z");
  assert.equal(deepseekIsPeak(weekdayPeak), true);
  assert.equal(deepseekIsPeak(weekend), false);
  assert.equal(paidButton({ available: false, offPeakOnly: false, now: weekend }).enabled, false);
  assert.match(paidButton({ available: false, offPeakOnly: false, now: weekend }).reason, /key/i);
  const held = paidButton({ available: true, offPeakOnly: true, now: weekdayPeak });
  assert.equal(held.enabled, false);
  assert.match(held.reason, /peak/i);
  assert.equal(paidButton({ available: true, offPeakOnly: true, now: weekend }).enabled, true);
});

test("bond and level grow only from stored turns", () => {
  const fresh = partnerFromTurns(0);
  assert.equal(fresh.level, 1);
  assert.equal(fresh.bond, 0);
  const later = partnerFromTurns(10);
  assert.equal(later.level, 4);
  assert.equal(later.bond, 40);
  assert.equal(partnerFromTurns(80).bond, 100);
});

test("the chat base falls back to the proxy when the gateway is down", async () => {
  const found = await resolveChatBase("http://127.0.0.1:8788", async () => {
    throw new Error("down");
  });
  assert.equal(found.via, "proxy");
  assert.equal(found.base, "http://127.0.0.1:8788");
});

test("sse usage is kept and text deltas join", () => {
  const block = [
    'data: {"choices":[{"delta":{"content":"Hi"}}]}',
    'data: {"choices":[{"delta":{"content":" there"}}],"usage":{"prompt_tokens":10,"completion_tokens":2}}',
    "data: [DONE]",
  ].join("\n");
  const piece = parseSseBlock(block);
  assert.equal(piece.text, "Hi there");
  assert.equal(piece.usage?.completion_tokens, 2);
});

test("thinking is stripped before the answer is spoken, including a split tag", () => {
  const extras = completionExtras("preyas");
  assert.equal(extras.chat_template_kwargs?.enable_thinking, false);
  assert.equal(completionExtras("paid").thinking?.type, "disabled");

  const whole = stripThinking("Hello <think>secret plan</think> there.");
  assert.equal(whole.answer, "Hello there.");
  assert.equal(whole.thinking, "secret plan");
  assert.equal(whole.inThink, false);

  const split = "Hello <thi" + "nk>secret</thi" + "nk> there.";
  const joined = stripThinking(split);
  assert.equal(joined.answer, "Hello there.");
  assert.equal(joined.thinking, "secret");
  assert.equal(stripThinking("Hello <thi").answer, "Hello");
  assert.equal(stripThinking("Hello <thi").inThink, false);

  const open = stripThinking("Before <think>still going");
  assert.equal(open.answer, "Before");
  assert.equal(open.thinking, "still going");
  assert.equal(open.inThink, true);

  const onlyReasoning = parseSseBlock(
    'data: {"choices":[{"delta":{"reasoning_content":"The window is east.","content":""}}]}',
  );
  const hidden = visibleReply(onlyReasoning.text, onlyReasoning.reasoning);
  assert.equal(hidden.answer, "");
  assert.equal(hidden.thinking, "The window is east.");
  const answered = parseSseBlock(
    'data: {"choices":[{"delta":{"reasoning_content":"draft","content":"East window."}}]}',
  );
  assert.equal(visibleReply(answered.text, answered.reasoning).answer, "East window.");
});
