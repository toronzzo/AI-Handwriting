/** llama-server defaults repeat_penalty to 1, so a line can stutter the same word. */
export function withSampling(body) {
  let json;
  try {
    json = JSON.parse(Buffer.isBuffer(body) ? body.toString("utf8") : String(body));
  } catch {
    return body;
  }
  if (!json || typeof json !== "object" || Array.isArray(json)) return body;
  if (json.repeat_penalty == null) json.repeat_penalty = 1.1;
  if (json.presence_penalty == null) json.presence_penalty = 0.3;
  if (json.frequency_penalty == null) json.frequency_penalty = 0.3;
  return Buffer.from(JSON.stringify(json));
}
