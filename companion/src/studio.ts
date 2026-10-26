export type StudioHealth = {
  ok: boolean;
  llm?: { ready?: boolean | null; gguf?: boolean };
  tts?: { ready?: boolean; engine?: string | null; piper?: boolean; espeak?: boolean };
  stt?: { ready?: boolean; engine?: string | null; sherpa?: boolean };
};

const prefix = () => (import.meta.env.DEV ? "/studio" : "http://127.0.0.1:8787");

let cached: StudioHealth | null = null;

export function lastStudioHealth(): StudioHealth | null {
  return cached;
}

export async function pingStudio(): Promise<StudioHealth | null> {
  try {
    const r = await fetch(`${prefix()}/v1/health`, { signal: AbortSignal.timeout(1200) });
    if (!r.ok) {
      cached = null;
      return null;
    }
    cached = (await r.json()) as StudioHealth;
    return cached;
  } catch {
    cached = null;
    return null;
  }
}

export function studioChatUrl() {
  return `${prefix()}/v1/chat`;
}

export function studioTtsUrl() {
  return `${prefix()}/v1/tts`;
}

export function studioSttWsUrl() {
  const loc = window.location;
  if (import.meta.env.DEV) {
    const proto = loc.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${loc.host}/studio/v1/stt`;
  }
  return "ws://127.0.0.1:8787/v1/stt";
}

export async function* streamStudioTokens(
  body: Record<string, unknown>,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const r = await fetch(studioChatUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (r.status === 503) throw new Error("llm_unavailable");
  if (!r.ok || !r.body) throw new Error(`studio_chat_${r.status}`);
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
      if (!trimmed) continue;
      try {
        const ev = JSON.parse(trimmed) as { type: string; text?: string };
        if (ev.type === "token" && ev.text) yield ev.text;
      } catch {
        /* ignore */
      }
    }
  }
}

export async function fetchTtsWav(text: string, mood: string): Promise<ArrayBuffer> {
  const r = await fetch(studioTtsUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, mood }),
  });
  if (!r.ok) throw new Error(`tts_${r.status}`);
  return r.arrayBuffer();
}
