/**
 * Pull notes out of a finished exchange with the local model. Called after the
 * reply is already on screen, so a slow model never delays an answer.
 */
import { NOTE_EXTRACT_PROMPT, parseExtractedNotes } from "../../packages/alive/src/notes.ts";

export { parseExtractedNotes };

/** The last few turns as plain lines for the extraction prompt. */
export function chatLines(messages, limit = 6) {
  return (Array.isArray(messages) ? messages : [])
    .slice(-limit)
    .map((message) => {
      const who = message.role === "assistant" ? "Preyas" : "Partner";
      return `${who}: ${String(message.content || "").replace(/\s+/g, " ").slice(0, 500)}`;
    })
    .join("\n");
}

/**
 * Ask llama-server for notes as JSON. Returns [] on any failure: extraction is
 * best-effort and must never surface as a chat error.
 */
export async function askForNotes(llamaUrl, lines, options = {}) {
  const { timeoutMs = 20000, fetchImpl = fetch } = options;
  if (!String(lines || "").trim()) return [];
  const body = {
    model: "preyas",
    stream: false,
    temperature: 0,
    max_tokens: 320,
    chat_template_kwargs: { enable_thinking: false },
    messages: [
      { role: "system", content: NOTE_EXTRACT_PROMPT },
      { role: "user", content: `${lines}\n\n/no_think` },
    ],
  };
  try {
    const res = await fetchImpl(`${llamaUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return [];
    const json = await res.json();
    return parseExtractedNotes(json?.choices?.[0]?.message?.content || "");
  } catch {
    return [];
  }
}
