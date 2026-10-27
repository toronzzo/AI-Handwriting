import { ggufPath, LLAMA_URL } from "./paths.mjs";
import { buildSystemPrompt } from "./prompt.mjs";

export function llmStatus() {
  return {
    gguf: Boolean(ggufPath()),
    llamaUrl: LLAMA_URL,
    ready: null,
  };
}

export async function llamaHealthy() {
  try {
    const r = await fetch(`${LLAMA_URL}/health`, { signal: AbortSignal.timeout(800) });
    if (r.ok) return true;
  } catch {
    /* try models endpoint */
  }
  try {
    const r = await fetch(`${LLAMA_URL}/v1/models`, { signal: AbortSignal.timeout(800) });
    return r.ok;
  } catch {
    return false;
  }
}

/** @deprecated prefer buildSystemPrompt — kept for callers that pass flat fields */
export function systemPrompt(opts) {
  return buildSystemPrompt({
    partnerName: opts.partnerName,
    facts: opts.facts,
    form: opts.form,
    userText: opts.userText,
    characterOverride: {
      name: opts.name,
      attribute: opts.attribute,
      personality: opts.personality,
    },
  }).prompt;
}

export { buildSystemPrompt };

/**
 * Stream OpenAI-compat chat completions from llama-server as NDJSON
 * {type:"token", text} then {type:"done"}.
 * Also emits {type:"timing", firstMoodMs} when the leading [mood] closes.
 */
export async function streamChat({ messages, signal, res }) {
  const r = await fetch(`${LLAMA_URL}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: signal instanceof AbortSignal ? signal : undefined,
    body: JSON.stringify({
      model: "qwen2.5-3b-instruct",
      messages,
      stream: true,
      temperature: 0.7,
      max_tokens: 120,
    }),
  });
  if (!r.ok || !r.body) {
    const err = await r.text().catch(() => r.statusText);
    throw new Error(`llama_${r.status}: ${err}`);
  }

  res.writeHead(200, {
    "Content-Type": "application/x-ndjson",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  const t0 = Date.now();
  let acc = "";
  let firstMoodMs = null;

  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === "[DONE]") continue;
      try {
        const json = JSON.parse(payload);
        const text = json.choices?.[0]?.delta?.content || "";
        if (text) {
          acc += text;
          if (firstMoodMs == null) {
            const m = acc.match(/^\s*\[([a-z]+)\]/i);
            if (m) {
              firstMoodMs = Date.now() - t0;
              res.write(
                JSON.stringify({ type: "timing", firstMoodMs, mood: m[1].toLowerCase() }) + "\n",
              );
            }
          }
          res.write(JSON.stringify({ type: "token", text }) + "\n");
        }
      } catch {
        /* ignore split json */
      }
    }
  }
  res.write(
    JSON.stringify({
      type: "done",
      timing: { firstMoodMs, totalMs: Date.now() - t0 },
    }) + "\n",
  );
  res.end();
}
