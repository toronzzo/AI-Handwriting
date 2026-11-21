/**
 * The chat passthrough: one model response piped from upstream to the client.
 *
 * - Stops paying for generation after the client leaves.
 * - With `events` (brain slice N2) reports thinking/done/error into the
 *   brain, reading usage tokens from the very bytes it forwards — a response
 *   is never changed for the feed.
 * - `events.onAnswered` fires once, only when the stream ran to the end and
 *   really carried answer content: a timeout, a client that left mid-reply,
 *   an empty reply or an error never counts as chat activity (the idle
 *   auto-return window resets only on a real answer).
 *
 * Kept out of proxy.mjs so the wire behaviour is testable with a fake
 * upstream and a fake response.
 */
import { paidCostUsd, parseJsonUsage, parseSseUsage, tokensPerSec } from "./os/brainUsage.mjs";

export const CHAT_PROXY_TIMEOUT_MS = Number(process.env.BRAIN_UPSTREAM_TIMEOUT_MS || 90_000);

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

/**
 * Does the buffered response hold a real answer? For streams, any SSE data
 * block with non-empty answer text; for JSON, choices[0].message.content.
 * Usage chunks, `[DONE]`, reasoning-only replies and empty bodies are not
 * an answer.
 */
export function hasAnswerContent(text, streamed) {
  const body = String(text || "");
  if (!streamed) {
    try {
      const parsed = JSON.parse(body);
      const content = parsed && parsed.choices && parsed.choices[0] && parsed.choices[0].message?.content;
      return typeof content === "string" && content.trim().length > 0;
    } catch {
      return false;
    }
  }
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      const json = JSON.parse(payload);
      const choice = json && json.choices && json.choices[0];
      const content = choice && (choice.delta?.content ?? choice.message?.content ?? "");
      if (typeof content === "string" && content.trim().length > 0) return true;
    } catch {
      /* a torn chunk is not an answer */
    }
  }
  return false;
}

export async function pipeChatCompletion(brain, req, res, target, body, downError, timeoutMs = CHAT_PROXY_TIMEOUT_MS, events = null) {
  const controller = new AbortController();
  let timedOut = false;
  let clientClosed = false;
  let upstream = null;
  const startedAt = Date.now();
  const MAX_BUFFER = 4 * 1024 * 1024; // enough to hold a usage chunk, never a whole stream
  const chunks = [];
  let buffered = 0;
  const streamed = (() => {
    try {
      return JSON.parse(String(body)).stream === true;
    } catch {
      return false;
    }
  })();
  const brainOut = (record) => {
    if (!events || !events.neuron) return;
    try {
      brain.emit({ ...record, neuron: events.neuron });
    } catch {
      /* the feed is a nicety */
    }
  };
  const finishEvents = async (ok) => {
    if (!events) return;
    if (!ok) {
      brainOut({ state: "error", detail: `upstream answered ${upstream ? upstream.status : "?"}` });
      return;
    }
    const text = Buffer.concat(chunks).toString("utf8");
    const usage = streamed ? parseSseUsage(text) : parseJsonUsage(text);
    const stats = usage
      ? { tps: tokensPerSec(usage, startedAt, Date.now()), costUsd: events.paid ? paidCostUsd(usage, Date.now()) : null }
      : {};
    const ramMb =
      events.local && events.ramPromise
        ? await Promise.race([events.ramPromise, new Promise((resolve) => setTimeout(() => resolve(null), 800))])
        : null;
    // Only a fully received reply with real answer content is chat activity:
    // the 200 headers alone, a timeout, a client that left, or an empty
    // reply must never reset the idle auto-return window.
    if (typeof events.onAnswered === "function" && hasAnswerContent(text, streamed)) {
      try {
        events.onAnswered();
      } catch {
        /* the idle window is a nicety */
      }
    }
    brainOut({ state: "done", ...stats, ramMb });
  };
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onClose = () => {
    if (!res.writableEnded) {
      clientClosed = true;
      controller.abort();
    }
  };
  res.on("close", onClose);
  try {
    try {
      upstream = await fetch(target, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        signal: controller.signal,
      });
    } catch {
      if (clientClosed) return;
      brainOut({ state: "error", detail: timedOut ? "model timed out" : downError });
      sendJson(res, timedOut ? 504 : 503, { error: timedOut ? "model timed out" : downError });
      return;
    }
    res.writeHead(upstream.status, {
      "Content-Type": upstream.headers.get("content-type") || "text/event-stream",
      "Cache-Control": "no-cache",
    });
    if (!upstream.body) {
      const text = await upstream.text();
      if (buffered < MAX_BUFFER) {
        chunks.push(Buffer.from(text));
        buffered += text.length;
      }
      await finishEvents(upstream.ok);
      res.end(text);
      return;
    }
    const reader = upstream.body.getReader();
    for (;;) {
      const step = await reader.read();
      if (step.done || clientClosed) break;
      if (buffered < MAX_BUFFER) {
        chunks.push(step.value);
        buffered += step.value.length;
      }
      res.write(step.value);
    }
    if (clientClosed) {
      brainOut({ state: "off", detail: "stopped: the client left" });
    } else {
      await finishEvents(upstream.ok);
      res.end();
    }
  } catch {
    if (!clientClosed && !res.writableEnded) {
      if (!res.headersSent) sendJson(res, timedOut ? 504 : 503, { error: timedOut ? "model timed out" : downError });
      else res.end();
    }
  } finally {
    clearTimeout(timer);
    res.off("close", onClose);
    controller.abort();
  }
}
