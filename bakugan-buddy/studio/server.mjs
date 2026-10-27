#!/usr/bin/env node
/**
 * Bakugan Buddy Home Studio — loopback only (M1 Mac friendly).
 *   GET  /v1/health
 *   POST /v1/chat          NDJSON token stream via llama-server
 *   POST /v1/tts           single WAV (warm Piper worker)
 *   POST /v1/tts/sentences NDJSON {index,sentence} + binary framing via base64 wav chunks
 *   WS   /v1/stt           Int16 PCM 16 kHz → sherpa-onnx
 */
import http from "node:http";
import { WebSocketServer } from "ws";
import { buildSystemPrompt, llamaHealthy, llmStatus, streamChat } from "./lib/chat.mjs";
import { attachSttSocket, ensureStt, sttStatus } from "./lib/stt.mjs";
import { shutdownTtsWorker, synthesize, synthesizeSentences, ttsStatus } from "./lib/tts.mjs";
import { STUDIO_PORT } from "./lib/paths.mjs";

const HOST = process.env.STUDIO_HOST || "127.0.0.1";

async function health() {
  const llm = llmStatus();
  llm.ready = await llamaHealthy();
  const tts = ttsStatus();
  await ensureStt();
  const stt = sttStatus();
  const promptMeta = buildSystemPrompt({ userText: "hello" }).meta;
  return {
    ok: true,
    bind: `${HOST}:${STUDIO_PORT}`,
    llm,
    tts,
    stt,
    prompt: promptMeta,
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
      const userText =
        body.text ||
        [...(body.messages || [])].reverse().find((m) => m.role === "user")?.content ||
        "";
      const { prompt, meta } = buildSystemPrompt({
        partnerName: body.partnerName,
        facts: body.facts || [],
        form: body.form || "sphere",
        userText,
        characterOverride: {
          name: character.name,
          attribute: character.attribute,
          personality: character.personality,
        },
      });
      const messages = [
        { role: "system", content: prompt },
        ...(body.messages || [{ role: "user", content: body.text || "" }]),
      ];
      res.setHeader("X-Prompt-Persona", meta.personaSource || "");
      res.setHeader("X-Prompt-Examples", String(meta.retrieved));
      const ac = new AbortController();
      req.on("close", () => ac.abort());
      await streamChat({ messages, signal: ac.signal, res });
      return;
    }

    if (req.method === "POST" && url.pathname === "/v1/tts") {
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      try {
        const t0 = Date.now();
        const { wav, engine, ms } = await synthesize({
          text: body.text,
          mood: body.mood,
          engine: body.engine,
        });
        res.writeHead(200, {
          "Content-Type": "audio/wav",
          "X-TTS-Engine": engine,
          "X-TTS-Ms": String(ms ?? Date.now() - t0),
        });
        res.end(wav);
      } catch (err) {
        const code = err.message === "tts_unavailable" ? 503 : 400;
        res.writeHead(code, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    if (req.method === "POST" && url.pathname === "/v1/tts/sentences") {
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      res.writeHead(200, {
        "Content-Type": "application/x-ndjson",
        "Cache-Control": "no-cache",
      });
      try {
        for await (const part of synthesizeSentences({
          text: body.text,
          mood: body.mood || "happy",
        })) {
          res.write(
            JSON.stringify({
              type: "sentence",
              index: part.index,
              sentence: part.sentence,
              engine: part.engine,
              ms: part.ms,
              wavBase64: part.wav.toString("base64"),
            }) + "\n",
          );
        }
        res.write(JSON.stringify({ type: "done" }) + "\n");
        res.end();
      } catch (err) {
        res.write(JSON.stringify({ type: "error", error: err.message }) + "\n");
        res.end();
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

function shutdown() {
  void shutdownTtsWorker();
  server.close(() => process.exit(0));
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

server.listen(STUDIO_PORT, HOST, () => {
  console.info(`[studio] loopback http://${HOST}:${STUDIO_PORT}`);
  console.info("[studio] GET /v1/health  POST /v1/chat  POST /v1/tts[/sentences]  WS /v1/stt");
});
