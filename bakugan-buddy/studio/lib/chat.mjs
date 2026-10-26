import { ggufPath, LLAMA_URL } from "./paths.mjs";

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

export function systemPrompt({ name, attribute, personality, partnerName, facts, form }) {
  return [
    `You are ${name}, a ${attribute}-attribute Bakugan-inspired pocket companion.`,
    personality,
    "Speak in 1-3 short spoken sentences.",
    "EVERY reply MUST start with a mood tag in square brackets, then a space, then the line.",
    "Allowed moods: [happy] [excited] [calm] [sad] [fierce] [curious] [amused] [mysterious].",
    "Never break character. Never say you are an AI unless asked seriously.",
    "Do not mention tools, models, or llama.",
    partnerName ? `Your partner's name is ${partnerName}.` : "You do not know their name yet.",
    form === "battle" ? "You are currently popped open (battle form)." : "You are currently in sphere form.",
    facts?.length ? `You remember: ${facts.slice(-8).join("; ")}.` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Stream OpenAI-compat chat completions from llama-server as NDJSON
 * {type:"token", text} then {type:"done"}.
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
        if (text) res.write(JSON.stringify({ type: "token", text }) + "\n");
      } catch {
        /* ignore split json */
      }
    }
  }
  res.write(JSON.stringify({ type: "done" }) + "\n");
  res.end();
}
