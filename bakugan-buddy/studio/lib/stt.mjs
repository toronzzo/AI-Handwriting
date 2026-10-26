import fs from "node:fs";
import path from "node:path";
import { sherpaEncoder } from "./paths.mjs";

let recognizer = null;
let loadAttempted = false;

export function sttStatus() {
  return {
    sherpa: Boolean(sherpaEncoder()),
    ready: Boolean(recognizer),
    engine: recognizer ? "sherpa-onnx" : null,
  };
}

export async function ensureStt() {
  return loadSherpa();
}

async function loadSherpa() {
  if (loadAttempted) return recognizer;
  loadAttempted = true;
  const dir = sherpaEncoder();
  if (!dir) return null;
  try {
    const sherpa = await import("sherpa-onnx");
    const encoder = firstFile(dir, /encoder.*onnx$/i);
    const decoder = firstFile(dir, /decoder.*onnx$/i);
    const joiner = firstFile(dir, /joiner.*onnx$/i);
    const tokens = path.join(dir, "tokens.txt");
    if (!encoder || !decoder || !joiner || !fs.existsSync(tokens)) return null;
    recognizer = sherpa.createOnlineRecognizer({
      featConfig: { sampleRate: 16000, featureDim: 80 },
      modelConfig: {
        transducer: { encoder, decoder, joiner },
        tokens,
        numThreads: 2,
        provider: "cpu",
      },
      decodingMethod: "greedy_search",
      enableEndpoint: 1,
    });
    return recognizer;
  } catch (err) {
    console.warn("[studio] sherpa-onnx not loaded:", err.message);
    recognizer = null;
    return null;
  }
}

function firstFile(dir, re) {
  const hit = fs.readdirSync(dir).find((f) => re.test(f));
  return hit ? path.join(dir, hit) : null;
}

/**
 * Attach a WebSocket that receives Int16LE PCM @ 16 kHz (binary)
 * and JSON {type:"end"} to finish.
 */
export function attachSttSocket(ws) {
  let stream = null;
  let lastPartial = "";
  let samples = [];

  void loadSherpa().then((rec) => {
    if (rec) {
      try {
        stream = rec.createStream();
      } catch (err) {
        console.warn("[studio] sherpa stream:", err.message);
      }
    }
    ws.send(JSON.stringify({ type: "ready", engine: rec ? "sherpa-onnx" : "none" }));
  });

  ws.on("message", (data, isBinary) => {
    if (!isBinary) {
      let msg;
      try {
        msg = JSON.parse(String(data));
      } catch {
        return;
      }
      if (msg.type === "end") {
        finalize();
      }
      return;
    }
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const n = buf.length / 2;
    const f32 = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      f32[i] = buf.readInt16LE(i * 2) / 32768;
    }
    samples.push(f32);
    if (recognizer && stream) {
      try {
        stream.acceptWaveform(16000, f32);
        recognizer.decode(stream);
        const text = recognizer.getResult(stream).text || "";
        if (text && text !== lastPartial) {
          lastPartial = text;
          ws.send(JSON.stringify({ type: "partial", text }));
        }
        if (recognizer.isEndpoint(stream)) {
          const finalText = (recognizer.getResult(stream).text || lastPartial).trim();
          if (finalText) ws.send(JSON.stringify({ type: "final", text: finalText }));
          recognizer.reset(stream);
          lastPartial = "";
        }
      } catch (err) {
        ws.send(JSON.stringify({ type: "error", message: err.message }));
      }
    }
  });

  function finalize() {
    if (recognizer && stream) {
      try {
        const tail = new Float32Array(16000 * 0.4);
        stream.acceptWaveform(16000, tail);
        recognizer.decode(stream);
        const finalText = (recognizer.getResult(stream).text || lastPartial).trim();
        if (finalText) ws.send(JSON.stringify({ type: "final", text: finalText }));
        recognizer.reset(stream);
      } catch {
        /* ignore */
      }
    } else if (lastPartial.trim()) {
      ws.send(JSON.stringify({ type: "final", text: lastPartial.trim() }));
    } else {
      ws.send(
        JSON.stringify({
          type: "error",
          message: "stt_unavailable",
          hint: "Run studio/download-models.sh and npm i sherpa-onnx",
        }),
      );
    }
    lastPartial = "";
    samples = [];
  }

  ws.on("close", () => {
    stream = null;
  });
}
