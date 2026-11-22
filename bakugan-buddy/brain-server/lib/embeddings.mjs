/**
 * OpenAI-compatible embeddings client for an optional LAN helper.
 *
 * EMBEDDINGS_URL is the full `/v1/embeddings` endpoint, or a server root
 * (http://host:8792) which this appends `/v1/embeddings` to. The Windows
 * laptop serves Qwen3-Embedding-0.6B (1024-d) here. Nothing in memory search
 * calls this yet: a missing or unreachable helper returns null.
 */
import { CONNECT_TIMEOUT_MS, connectWithTimeout } from "./netTimeout.mjs";

export const EMBEDDINGS_TIMEOUT_MS = 15_000;

/**
 * The URL to POST, or "" when EMBEDDINGS_URL is unset.
 * A value that already ends in `/embeddings` is used as-is.
 */
export function embeddingsEndpoint(env = process.env) {
  const raw = String(env.EMBEDDINGS_URL || "").trim().replace(/\/$/, "");
  if (!raw) return "";
  if (/\/embeddings$/i.test(raw)) return raw;
  return `${raw}/v1/embeddings`;
}

function asVector(value) {
  if (!Array.isArray(value) || value.length === 0) return null;
  const numbers = [];
  for (const item of value) {
    const number = Number(item);
    if (!Number.isFinite(number)) return null;
    numbers.push(number);
  }
  return numbers;
}

function vectorsFrom(json) {
  const rows = Array.isArray(json && json.data) ? json.data.slice() : [];
  rows.sort((left, right) => Number(left && left.index) - Number(right && right.index));
  const vectors = [];
  for (const row of rows) {
    const vector = asVector(row && row.embedding);
    if (!vector) return null;
    vectors.push(vector);
  }
  return vectors.length ? vectors : null;
}

/**
 * One vector per input string, or null when the helper is unset, asleep,
 * or answers with something that is not a list of vectors. Never throws.
 */
export async function embedTexts(input, options = {}) {
  const {
    env = process.env,
    fetchImpl = fetch,
    connect = (url, timeoutMs) => connectWithTimeout(url, timeoutMs),
    connectTimeoutMs = CONNECT_TIMEOUT_MS,
    timeoutMs = EMBEDDINGS_TIMEOUT_MS,
    model = env.EMBEDDINGS_MODEL || "qwen3-embedding",
  } = options;
  const url = embeddingsEndpoint(env);
  if (!url) return null;
  const texts = (Array.isArray(input) ? input : [input]).map((text) => String(text ?? ""));
  if (texts.length === 0 || texts.every((text) => !text.trim())) return null;
  try {
    let open = false;
    try {
      open = await connect(url, connectTimeoutMs);
    } catch {
      open = false;
    }
    if (!open) return null;
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, input: texts }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res || !res.ok) return null;
    const json = await res.json();
    return vectorsFrom(json);
  } catch {
    return null;
  }
}

/** The first vector, or null. */
export async function embedText(text, options = {}) {
  const rows = await embedTexts([text], options);
  return rows ? rows[0] : null;
}
