/**
 * Restore Preyas's system-prompt slot, or warm it and save it on the drive.
 * The system string must match packages/alive PREYAS_SYSTEM_PROMPT byte for byte.
 * A prompt edit changes the hash and the slot is rebuilt.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PREYAS_SYSTEM_PROMPT } from "../../packages/alive/src/brain.ts";

const llama = (process.env.LLAMA_URL || "http://127.0.0.1:8790").replace(/\/$/, "");
const dataDir = process.env.BAKUGAN_DATA_DIR || "";
const cacheDir = path.join(dataDir, "cache", "llama-slots");
const slotName = "preyas-system.bin";
const hashPath = path.join(cacheDir, "preyas-system.sha256");

function hashPrompt() {
  return crypto.createHash("sha256").update(PREYAS_SYSTEM_PROMPT).digest("hex");
}

async function slot(action) {
  const res = await fetch(`${llama}/slots/0?action=${action}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ filename: slotName }),
  });
  return res.ok;
}

async function warm() {
  const res = await fetch(`${llama}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: "preyas",
      stream: false,
      temperature: 0,
      max_tokens: 8,
      cache_prompt: true,
      id_slot: 0,
      chat_template_kwargs: { enable_thinking: false },
      messages: [
        { role: "system", content: PREYAS_SYSTEM_PROMPT },
        { role: "user", content: "JSON only." },
      ],
    }),
  });
  if (!res.ok) throw new Error(`warmup ${res.status}`);
  await res.text();
}

try {
  if (!dataDir) throw new Error("BAKUGAN_DATA_DIR is unset");
  const hash = hashPrompt();
  fs.mkdirSync(cacheDir, { recursive: true });
  let saved = "";
  try {
    saved = fs.readFileSync(hashPath, "utf8").trim();
  } catch {
    saved = "";
  }
  if (saved === hash && (await slot("restore"))) {
    console.log(`restored prompt cache ${slotName}`);
  } else {
    await warm();
    const wrote = await slot("save");
    if (wrote) {
      fs.writeFileSync(hashPath, `${hash}\n`);
      console.log(`saved prompt cache ${slotName}`);
    } else {
      console.log("slot save is not available; --cache-reuse still reuses the prefix in this process");
    }
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.log(`prompt cache warmup skipped: ${message}`);
}
