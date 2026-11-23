/**
 * Raw Qwen: a deliberately plain chat passthrough for the Raw Qwen screen.
 *
 * The Preyas chat route adds notes, the drive map, self-knowledge, emoji and
 * memory/chat writes. This route does none of that: it validates a small
 * settings payload, checks the same pairing token as every other /v1 route,
 * and streams llama-server's own /v1/chat/completions response (including its
 * per-token timings) straight back to the app.
 *
 * Kept out of proxy.mjs so the wire behaviour is testable with a fake upstream
 * and a fake response.
 */
import { authorizeRequest, readDevices } from "./pairing.mjs";

export const RAW_CHAT_PATH = "/v1/raw/chat";
export const RAW_CHAT_MAX_BODY_BYTES = 512 * 1024;
export const RAW_CHAT_TIMEOUT_MS = 120_000;

const MAX_MESSAGES = 200;
const MAX_MESSAGE_CHARS = 32_000;

class RawChatError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function sendJson(res, status, body) {
  if (res.headersSent) {
    res.end();
    return;
  }
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > RAW_CHAT_MAX_BODY_BYTES) throw new RawChatError(413, "request too large");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function numberIn(value, fallback, min, max) {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

/** Only the four settings the Raw Qwen panel owns reach llama. */
export function normalizeRawChatRequest(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { error: "invalid request" };
  }
  if (!Array.isArray(input.messages)) return { error: "messages must be a list" };

  const messages = [];
  for (const row of input.messages.slice(-MAX_MESSAGES)) {
    if (!row || typeof row !== "object") continue;
    const role = row.role;
    if (role !== "system" && role !== "user" && role !== "assistant") continue;
    if (typeof row.content !== "string") continue;
    const content = row.content.slice(0, MAX_MESSAGE_CHARS);
    if (!content.trim() && role !== "assistant") continue;
    messages.push({ role, content });
  }
  if (!messages.some((message) => message.role === "user")) {
    return { error: "a user message is required" };
  }

  const temperature = numberIn(input.temperature, 0.7, 0, 2);
  const topP = numberIn(input.top_p, 0.95, 0, 1);
  const maxTokens = Math.round(numberIn(input.max_tokens, 512, 1, 8192));

  return {
    body: JSON.stringify({
      messages,
      temperature,
      top_p: topP,
      max_tokens: maxTokens,
      stream: true,
      // llama-server reports a timings object per chunk, so the app can show
      // tokens/sec, token count and time while the reply is still growing.
      timings_per_token: true,
      chat_template_kwargs: { enable_thinking: true },
    }),
    temperature,
    topP,
    maxTokens,
  };
}

/** The same pairing rules as every other /v1 route, rechecked at the route. */
export function rawChatAuth(req, options = {}) {
  const book = options.book || (options.dataDir ? readDevices(options.dataDir) : { devices: [] });
  return authorizeRequest({
    path: RAW_CHAT_PATH,
    method: req.method || "POST",
    token: String(req.headers?.["x-preyas-token"] || ""),
    book,
    pairing: options.pairing ?? null,
    remoteAddress: req.socket?.remoteAddress || "",
    origin: req.headers?.origin || "",
    webOrigins: options.webOrigins || [],
  });
}

/**
 * Stream one raw reply. Never reads or writes Memory: no facts, notes or chat
 * files are touched anywhere in this module.
 */
export async function handleRawChat(req, res, options = {}) {
  if (req.method !== "POST") return sendJson(res, 405, { error: "method not allowed" });

  const gate = rawChatAuth(req, options);
  if (!gate.allow) {
    return sendJson(res, gate.status, { error: gate.error, pair: gate.status === 401 });
  }

  let payload;
  try {
    const raw = await readBody(req);
    payload = JSON.parse(raw.toString("utf8"));
  } catch (error) {
    const status = error instanceof RawChatError ? error.status : 400;
    return sendJson(res, status, { error: status === 413 ? "request too large" : "invalid json" });
  }

  const normalized = normalizeRawChatRequest(payload);
  if (normalized.error) return sendJson(res, 400, { error: normalized.error });

  const fetchImpl = options.fetchImpl || fetch;
  const base = String(options.llamaUrl || "http://127.0.0.1:8790").replace(/\/$/, "");
  const target = `${base}/v1/chat/completions`;
  const timeoutMs = Number(options.timeoutMs || RAW_CHAT_TIMEOUT_MS);
  const controller = new AbortController();
  let timedOut = false;
  let clientClosed = false;
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
  res.on?.("close", onClose);

  try {
    let upstream;
    try {
      upstream = await fetchImpl(target, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: normalized.body,
        signal: controller.signal,
      });
    } catch {
      if (!clientClosed) {
        sendJson(res, timedOut ? 504 : 503, { error: timedOut ? "model timed out" : "llama is down" });
      }
      return;
    }

    if (!upstream.ok) {
      let detail = "";
      try {
        detail = (await upstream.text()).slice(0, 600);
      } catch {
        detail = "";
      }
      let error = "llama is down";
      try {
        const parsed = JSON.parse(detail);
        if (parsed && typeof parsed.error === "string") error = parsed.error;
      } catch {
        if (detail.trim()) error = detail.trim();
      }
      if (!clientClosed) sendJson(res, upstream.status, { error });
      return;
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
    });

    if (!upstream.body) {
      res.end(await upstream.text());
      return;
    }

    const reader = upstream.body.getReader();
    for (;;) {
      const step = await reader.read();
      if (step.done || clientClosed) break;
      res.write(step.value);
    }
    if (!clientClosed && !res.writableEnded) res.end();
  } catch {
    if (!clientClosed) {
      if (!res.headersSent) {
        sendJson(res, timedOut ? 504 : 502, { error: timedOut ? "model timed out" : "raw chat failed" });
      } else if (!res.writableEnded) {
        res.end();
      }
    }
  } finally {
    clearTimeout(timer);
    res.off?.("close", onClose);
  }
}
