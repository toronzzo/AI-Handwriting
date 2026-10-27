#!/usr/bin/env node
/**
 * Bench Home Studio on this Mac:
 *   - time to first [mood] tag (llama stream)
 *   - time to first audio (warm TTS first sentence)
 *   - full reply wall time
 *
 * Prerequisites:
 *   llama-server -m models/qwen2.5-3b-instruct-q4_k_m.gguf --host 127.0.0.1 --port 8080
 *   cd bakugan-buddy/studio && npm start
 *   ./download-models.sh   # voices; --llm for GGUF
 *
 * Usage: node scripts/bench-sidecar.mjs ["your prompt"]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const STUDIO = process.env.STUDIO_URL || "http://127.0.0.1:8787";
const prompt = process.argv[2] || "Hey partner — you ready to make a splash?";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const docsBench = path.resolve(root, "..", "docs", "BENCH.md");

async function health() {
  const r = await fetch(`${STUDIO}/v1/health`);
  return r.json();
}

async function benchChat(text) {
  const t0 = Date.now();
  let firstMoodMs = null;
  let firstTokenMs = null;
  let full = "";
  const r = await fetch(`${STUDIO}/v1/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!r.ok) throw new Error(`chat_${r.status}: ${await r.text()}`);
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
      if (!line.trim()) continue;
      const ev = JSON.parse(line);
      if (ev.type === "timing" && ev.firstMoodMs != null) firstMoodMs = ev.firstMoodMs;
      if (ev.type === "token") {
        if (firstTokenMs == null) firstTokenMs = Date.now() - t0;
        full += ev.text;
      }
      if (ev.type === "done" && ev.timing?.firstMoodMs != null) {
        firstMoodMs = ev.timing.firstMoodMs;
      }
    }
  }
  return {
    firstMoodMs,
    firstTokenMs,
    totalMs: Date.now() - t0,
    reply: full.trim(),
  };
}

async function benchTts(text, mood) {
  const t0 = Date.now();
  const r = await fetch(`${STUDIO}/v1/tts/sentences`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, mood }),
  });
  if (!r.ok) throw new Error(`tts_${r.status}: ${await r.text()}`);
  let firstAudioMs = null;
  let sentences = 0;
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
      if (!line.trim()) continue;
      const ev = JSON.parse(line);
      if (ev.type === "sentence") {
        sentences += 1;
        if (firstAudioMs == null) firstAudioMs = Date.now() - t0;
      }
    }
  }
  return { firstAudioMs, totalMs: Date.now() - t0, sentences };
}

function moodFrom(reply) {
  const m = reply.match(/^\[([a-z]+)\]/i);
  return m ? m[1].toLowerCase() : "happy";
}

const h = await health();
console.log("health.llm.ready =", h.llm?.ready, "tts =", h.tts?.engine, "prompt =", h.prompt);

const row = {
  when: new Date().toISOString(),
  host: `${process.platform}/${process.arch}`,
  prompt,
  llmReady: Boolean(h.llm?.ready),
  ttsEngine: h.tts?.engine,
};

if (!h.llm?.ready) {
  console.warn("LLM not ready — chat timings skipped. Start llama-server with Qwen2.5-3B Q4_K_M.");
  row.note = "llm_unavailable";
} else {
  const chat = await benchChat(prompt);
  Object.assign(row, {
    firstMoodMs: chat.firstMoodMs,
    firstTokenMs: chat.firstTokenMs,
    chatTotalMs: chat.totalMs,
    reply: chat.reply,
  });
  console.log("reply:", chat.reply);
  console.log("firstMoodMs:", chat.firstMoodMs, "chatTotalMs:", chat.totalMs);

  if (h.tts?.ready) {
    const speak = chat.reply.replace(/^\[[a-z]+\]\s*/i, "");
    const tts = await benchTts(speak || "Say now!", moodFrom(chat.reply));
    row.firstAudioMs = tts.firstAudioMs;
    row.ttsTotalMs = tts.totalMs;
    row.ttsSentences = tts.sentences;
    console.log("firstAudioMs:", tts.firstAudioMs, "tts sentences:", tts.sentences);
  }
}

const line = `| ${row.when.slice(0, 19)} | ${row.host} | ${row.firstMoodMs ?? "—"} | ${row.firstAudioMs ?? "—"} | ${row.chatTotalMs ?? "—"} | ${row.ttsEngine ?? "—"} | ${row.llmReady ? "yes" : "no"} |`;
console.log("\nBENCH row:\n" + line);

if (fs.existsSync(docsBench)) {
  let md = fs.readFileSync(docsBench, "utf8");
  if (!md.includes(row.when.slice(0, 19))) {
    md = md.replace(
      /(<!-- BENCH_ROWS -->)/,
      `$1\n${line}`,
    );
    fs.writeFileSync(docsBench, md);
    console.log("appended to", docsBench);
  }
}
