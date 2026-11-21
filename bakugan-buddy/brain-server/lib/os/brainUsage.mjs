/**
 * Reading what a chat response cost and how fast it ran, from the very bytes
 * the proxy already forwards to the client. Purely additive: nothing here
 * changes a single byte of a response.
 *
 * The paid cost uses the same peak/off-peak DeepSeek Flash pricing as the
 * app (packages/alive/src/chatTurn.ts), so the brain and the chat bubble
 * always show the same number.
 */
import { deepseekIsPeak, estimatePaidCost } from "../../../packages/alive/src/chatTurn.ts";

/**
 * The last `usage` object in a streamed SSE body (OpenAI-style chunks), or
 * null. llama-server only sends the usage chunk because the app already asks
 * for stream_options.include_usage; when it is absent the caller falls back
 * to a null tps rather than guessing.
 */
export function parseSseUsage(text) {
  const lines = String(text || "").split("\n");
  let usage = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      const json = JSON.parse(payload);
      if (json && typeof json === "object" && json.usage && typeof json.usage === "object") {
        usage = json.usage;
      }
    } catch {
      /* a torn chunk is not an answer */
    }
  }
  return usage;
}

/** The `usage` object of a non-stream JSON body, or null. */
export function parseJsonUsage(text) {
  try {
    const json = JSON.parse(String(text || ""));
    if (json && typeof json === "object" && json.usage && typeof json.usage === "object") {
      return json.usage;
    }
  } catch {
    /* not JSON (or torn): no usage */
  }
  return null;
}

/** Completion tokens per second, one decimal; null when unusable. */
export function tokensPerSec(usage, startMs, endMs) {
  const tokens = Number(usage && usage.completion_tokens);
  const seconds = (Number(endMs) - Number(startMs)) / 1000;
  if (!Number.isFinite(tokens) || tokens <= 0 || !Number.isFinite(seconds) || seconds <= 0) return null;
  return Math.round((tokens / seconds) * 10) / 10;
}

/** The DeepSeek Flash cost of one paid answer; null when usage is missing. */
export function paidCostUsd(usage, atMs = Date.now()) {
  const cost = estimatePaidCost(usage, deepseekIsPeak(new Date(atMs)));
  return typeof cost === "number" && cost >= 0 ? cost : null;
}
