#!/usr/bin/env node
/**
 * Tiny OpenAI-compat mock for llama-server (/v1/chat/completions + /health).
 * Used by CI smoke — deterministic in-character lines, no GGUF.
 */
import http from "node:http";

const PORT = Number(process.env.MOCK_LLAMA_PORT || 8080);
const HOST = process.env.MOCK_LLAMA_HOST || "127.0.0.1";

function pickReply(userText) {
  const t = String(userText || "").toLowerCase();
  if (/sad|alone|lonely/.test(t)) {
    return "[sad] Hey. I'm right here with you, partner.";
  }
  if (/battle|claws|protect|fight/.test(t)) {
    return "[battle] Claws out — nobody messes with my partner!";
  }
  if (/ai chatbot|are you an ai|language model/.test(t)) {
    return "[neutral] I'm your partner sphere. That's the whole story.";
  }
  if (/remember my name is\s+(\w+)/i.test(userText || "")) {
    const name = (userText || "").match(/remember my name is\s+(\w+)/i)?.[1] || "friend";
    return `[happy] ${name} it is. Locked into the core.`;
  }
  if (/joke/.test(t)) {
    return "[happy] Why did the sphere blush? Too much splash!";
  }
  if (/mad|angry/.test(t)) {
    return "[angry] Easy — we face it together.";
  }
  if (/whoa|what was that/.test(t)) {
    return "[surprised] Whoop! Felt that one in the core.";
  }
  if (/listening|you listen/.test(t)) {
    return "[listening] Flaps open. I'm with you.";
  }
  if (/amazing|great|morning|hey|hello|hi\b/.test(t)) {
    return "[happy] Say now! Good to see you, partner.";
  }
  return "[thinking] Hmm — give me a beat, partner.";
}

function lastUser(messages) {
  const list = Array.isArray(messages) ? messages : [];
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i]?.role === "user") return list[i].content || "";
  }
  return "";
}

function streamCompletion(res, content) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  // Emit one char-ish chunks so studio timing for first mood still works
  let i = 0;
  const tick = () => {
    if (i >= content.length) {
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }
    // push 1–3 chars
    const n = Math.min(3, content.length - i);
    const piece = content.slice(i, i + n);
    i += n;
    const payload = {
      choices: [{ delta: { content: piece }, index: 0 }],
    };
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
    setImmediate(tick);
  };
  tick();
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${HOST}`);
  if (req.method === "GET" && (url.pathname === "/health" || url.pathname === "/v1/models")) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", data: [{ id: "qwen2.5-3b-instruct" }] }));
    return;
  }
  if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
    const raw = await readBody(req);
    let body = {};
    try {
      body = JSON.parse(raw || "{}");
    } catch {
      /* ignore */
    }
    const reply = pickReply(lastUser(body.messages));
    if (body.stream) {
      streamCompletion(res, reply);
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        choices: [{ message: { role: "assistant", content: reply } }],
      }),
    );
    return;
  }
  res.writeHead(404);
  res.end("not found");
});

server.listen(PORT, HOST, () => {
  console.info(`[mock-llama] http://${HOST}:${PORT}`);
});
