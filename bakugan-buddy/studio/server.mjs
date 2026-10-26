#!/usr/bin/env node
/**
 * Bakugan Buddy Home Studio v0 — loopback only.
 *   GET  /v1/health
 *   POST /v1/chat     NDJSON token stream via llama.cpp (llama-server)
 *   POST /v1/tts      WAV bytes (Piper / Kokoro / espeak-ng)
 *   WS   /v1/stt      Int16 PCM 16 kHz → sherpa-onnx
 */
import http from "node:http";
import { WebSocketServer } from "ws";
import { llamaHealthy, llmStatus, streamChat, systemPrompt } from "./lib/chat.mjs";
import { attachSttSocket, ensureStt, sttStatus } from "./lib/stt.mjs";
import { synthesize, ttsStatus } from "./lib/tts.mjs";
import { STUDIO_PORT } from "./lib/paths.mjs";

const HOST = process.env.STUDIO_HOST || "127.0.0.1";

async function health() {
  const llm = llmStatus();
  llm.ready = await llamaHealthy();
  const tts = ttsStatus();
  await ensureStt();
  const stt = sttStatus();
  return {
    ok: true,
    bind: `${HOST}:${STUDIO_PORT}`,
    llm,
    tts,
    stt,
    offline: true,
  };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
}

const server = http.createServer(async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }
  const url = new URL(req.url || "/", `http://${HOST}`);

  try {
    if (req.method === "GET" && url.pathname === "/v1/health") {
      const h = await health();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(h));
      return;
    }

    if (req.method === "POST" && url.pathname === "/v1/chat") {
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      const ok = await llamaHealthy();
      if (!ok) {
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "llm_unavailable", code: "llm_unavailable" }));
        return;
      }
      const character = body.character || {};
      const messages = [
        {
          role: "system",
          content: systemPrompt({
            name: character.name || "Ripple",
            attribute: character.attribute || "aquos",
            personality: character.personality || "witty joker, loyal underneath",
            partnerName: body.partnerName,
            facts: body.facts || [],
            form: body.form || "sphere",
          }),
        },
        ...(body.messages || [{ role: "user", content: body.text || "" }]),
      ];
      const ac = new AbortController();
      req.on("close", () => ac.abort());
      await streamChat({ messages, signal: ac.signal, res });
      return;
    }

    if (req.method === "POST" && url.pathname === "/v1/tts") {
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      try {
        const { wav, engine } = await synthesize({
          text: body.text,
          mood: body.mood,
          engine: body.engine,
        });
        res.writeHead(200, {
          "Content-Type": "audio/wav",
          "X-TTS-Engine": engine,
        });
        res.end(wav);
      } catch (err) {
        const code = err.message === "tts_unavailable" ? 503 : 400;
        res.writeHead(code, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not_found" }));
  } catch (err) {
    console.error("[studio]", err);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message || "failed" }));
    }
  }
});

const wss = new WebSocketServer({ noServer: true });
server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url || "/", `http://${HOST}`);
  if (url.pathname !== "/v1/stt") {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    attachSttSocket(ws);
  });
});

server.listen(STUDIO_PORT, HOST, () => {
  console.info(`[studio] loopback http://${HOST}:${STUDIO_PORT}`);
  console.info("[studio] GET /v1/health  POST /v1/chat  POST /v1/tts  WS /v1/stt");
});
