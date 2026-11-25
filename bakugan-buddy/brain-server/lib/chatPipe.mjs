/**
 * The chat passthrough: one model response piped from upstream to the client.
 *
 * - Stops paying for generation after the client leaves.
 * - With `events` (brain slice N2) reports thinking/done/error into the
 *   brain, reading usage tokens from the very bytes it forwards — a response
 *   is never changed for the feed.
 * - `events.onAnswered` fires once, only when the stream ran to the end and
 *   really carried answer content: a timeout, a client that left mid-reply
 *   (even while the final flush was still awaiting the RAM probe), an empty
 *   reply or an error never counts as chat activity (the idle auto-return
 *   window resets only on a real answer).
 *
 * Kept out of proxy.mjs so the wire behaviour is testable with a fake
 * upstream and a fake response.
 */
import { BACKUP_BRAIN, BACKUP_SOURCE } from "./llamaFallback.mjs";
import { paidCostUsd, parseJsonUsage, parseSseUsage, tokensPerSec } from "./os/brainUsage.mjs";

export const CHAT_PROXY_TIMEOUT_MS = Number(process.env.BRAIN_UPSTREAM_TIMEOUT_MS || 90_000);
/** Response header the app reads to label a backup-brain reply. Value is "backup". */
export const BRAIN_SOURCE_HEADER = "X-Preyas-Brain";

function pipeResult(fields = {}) {
  return {
    ok: fields.ok === true,
    wrote: fields.wrote === true,
    timedOut: fields.timedOut === true,
    clientClosed: fields.clientClosed === true,
  };
}

function backupDetail(events) {
  return events && events.brainSource === BACKUP_SOURCE ? BACKUP_BRAIN : null;
}

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

/** One SSE delta that puts the news sentence in front of the model's answer. */
export function introSseChunk(prefix) {
  const text = String(prefix || "").trim();
  if (!text) return "";
  return `data: ${JSON.stringify({ choices: [{ delta: { content: `${text}\n\n` } }] })}\n\n`;
}

/** The same sentence, spliced into a non-streaming chat JSON body. */
export function prefixJsonAnswer(bodyText, prefix) {
  const text = String(prefix || "").trim();
  const raw = String(bodyText ?? "");
  if (!text) return raw;
  try {
    const json = JSON.parse(raw);
    const message = json && json.choices && json.choices[0] && json.choices[0].message;
    if (!message || typeof message.content !== "string") return raw;
    message.content = `${text}\n\n${message.content}`;
    return JSON.stringify(json);
  } catch {
    return raw;
  }
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
  let introWritten = false;
  let introDelivered = false;
  const deliverIntro = () => {
    if (!introWritten || introDelivered) return;
    introDelivered = true;
    if (!events || typeof events.onIntroDelivered !== "function") return;
    try {
      events.onIntroDelivered();
    } catch {
      /* remembering the note is a nicety */
    }
  };
  const writeStreamIntro = () => {
    if (introWritten || clientClosed || !upstream || !upstream.ok || !streamed) return;
    const chunk = introSseChunk(events && events.introPrefix);
    if (!chunk) return;
    introWritten = true;
    if (buffered < MAX_BUFFER) {
      chunks.push(Buffer.from(chunk));
      buffered += Buffer.byteLength(chunk);
    }
    res.write(chunk);
  };
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
      const why = `upstream answered ${upstream ? upstream.status : "?"}`;
      const sourceDetail = backupDetail(events);
      brainOut({ state: "error", detail: sourceDetail ? `${sourceDetail}: ${why}` : why });
      return;
    }
    const text = Buffer.concat(chunks).toString("utf8");
    const usage = streamed ? parseSseUsage(text) : parseJsonUsage(text);
    const stats = usage
      ? { tps: tokensPerSec(usage, startedAt, Date.now()), costUsd: events.paid ? paidCostUsd(usage, Date.now()) : null }
      : {};
    // The money is spent whether or not the reply reaches the phone, so this
    // runs before the client-closed check below. A reply with no usage carries
    // no exact figure; then the estimate the gate already allowed stands in,
    // so the daily ledger never quietly loses a paid turn.
    if (events.paid) {
      const exact = Number(stats.costUsd) > 0;
      const spentUsd = exact ? Number(stats.costUsd) : Number(events.paidEstimateUsd);
      if (Number.isFinite(spentUsd) && spentUsd > 0 && typeof events.onPaidCost === "function") {
        try {
          events.onPaidCost(spentUsd, exact);
        } catch {
          /* recording a finished turn must never break the reply */
        }
      }
    }
    const ramMb =
      events.local && events.ramPromise
        ? await Promise.race([events.ramPromise, new Promise((resolve) => setTimeout(() => resolve(null), 800))])
        : null;
    // Race guard: the client may have left while we awaited the RAM probe.
    // A reply the user never received is not chat activity, and the brain
    // must not record it as done.
    if (clientClosed) {
      brainOut({ state: "off", detail: "stopped: the client left" });
      return;
    }
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
    brainOut({ state: "done", ...stats, ramMb, detail: backupDetail(events) });
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
      if (clientClosed) {
        if (events?.local) brainOut({ state: "off", detail: "stopped: the client left" });
        return pipeResult({ clientClosed: true, timedOut });
      }
      // The caller can retry a backup brain only when the client has seen nothing.
      if (events && events.deferError) return pipeResult({ timedOut });
      const failDetail = timedOut ? "model timed out" : downError;
      const sourceDetail = backupDetail(events);
      brainOut({ state: "error", detail: sourceDetail ? `${sourceDetail}: ${failDetail}` : failDetail });
      sendJson(res, timedOut ? 504 : 503, { error: failDetail });
      return pipeResult({ wrote: true, timedOut });
    }
    if (!upstream.ok && events && events.deferError && !clientClosed) {
      try {
        if (upstream.body && typeof upstream.body.cancel === "function") await upstream.body.cancel();
      } catch {
        /* the failed local body is discarded so the backup can answer */
      }
      return pipeResult({});
    }
    const sourceDetail = backupDetail(events);
    const headers = {
      "Content-Type": upstream.headers.get("content-type") || (streamed ? "text/event-stream" : "application/json"),
      "Cache-Control": "no-cache",
    };
    if (sourceDetail) {
      headers[BRAIN_SOURCE_HEADER] = BACKUP_SOURCE;
      brainOut({ state: "thinking", detail: sourceDetail });
    }
    res.writeHead(upstream.status, headers);
    writeStreamIntro();
    if (!upstream.body) {
      let text = await upstream.text();
      if (!streamed && upstream.ok && events && events.introPrefix && !clientClosed) {
        const next = prefixJsonAnswer(text, events.introPrefix);
        if (next !== text) {
          text = next;
          introWritten = true;
        }
      }
      if (buffered < MAX_BUFFER) {
        chunks.push(Buffer.from(text));
        buffered += text.length;
      }
      await finishEvents(upstream.ok);
      deliverIntro();
      res.end(text);
      return pipeResult({ ok: upstream.ok, wrote: true, clientClosed });
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
      deliverIntro();
      return pipeResult({ wrote: true, clientClosed: true, timedOut });
    }
    await finishEvents(upstream.ok);
    deliverIntro();
    res.end();
    return pipeResult({ ok: upstream.ok, wrote: true, timedOut });
  } catch {
    if (clientClosed && events?.local) brainOut({ state: "off", detail: "stopped: the client left" });
    if (!clientClosed && !res.writableEnded) {
      if (!res.headersSent) {
        if (events && events.deferError) return pipeResult({ timedOut });
        sendJson(res, timedOut ? 504 : 503, { error: timedOut ? "model timed out" : downError });
        return pipeResult({ wrote: true, timedOut });
      }
      res.end();
    }
    return pipeResult({ wrote: res.headersSent === true, timedOut, clientClosed });
  } finally {
    clearTimeout(timer);
    res.off("close", onClose);
    controller.abort();
  }
}
