/**
 * On-device advisor for a dev client (`npx expo run:ios` / `run:android`).
 * Metro only bundles this file when EXPO_PUBLIC_ON_DEVICE_BRAIN=1.
 * Install `llama.rn` in that build. Expo Go keeps the stub and uses the Mac.
 *
 * The GGUF is downloaded on first use into the app documents folder.
 * It is not in the git repo and not inside the app binary.
 * https://huggingface.co/bartowski/mlabonne_Qwen3-1.7B-abliterated-GGUF
 */
import { File, Paths } from "expo-file-system";
import { initLlama, type LlamaContext } from "llama.rn";
import {
  PREYAS_SYSTEM_PROMPT,
  brainReplyToSuggestion,
  brainUserPrompt,
  parseBrainReply,
} from "../../../../../packages/alive/src/brain.ts";
import type { AdvisorInput, AdvisorSuggestion } from "../../../../../packages/alive/src/advisor.ts";

export const onDeviceBrainEnabled = true;

const FILE = "mlabonne_Qwen3-1.7B-abliterated-Q4_K_M.gguf";
const URL =
  "https://huggingface.co/bartowski/mlabonne_Qwen3-1.7B-abliterated-GGUF/resolve/main/mlabonne_Qwen3-1.7B-abliterated-Q4_K_M.gguf";

let context: LlamaContext | null = null;
let loading: Promise<LlamaContext | null> | null = null;

async function modelFile(): Promise<File> {
  const dest = new File(Paths.document, FILE);
  if (dest.exists) return dest;
  return File.downloadFileAsync(URL, dest, { idempotent: true });
}

function loadContext(): Promise<LlamaContext | null> {
  if (context) return Promise.resolve(context);
  if (loading) return loading;
  loading = (async () => {
    try {
      const file = await modelFile();
      context = await initLlama({ model: file.uri, n_ctx: 2048, n_gpu_layers: 99 });
      return context;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`on-device brain unavailable: ${message}`);
      return null;
    } finally {
      loading = null;
    }
  })();
  return loading;
}

export async function adviseOnDevice(input: AdvisorInput): Promise<AdvisorSuggestion | null> {
  const llama = await loadContext();
  if (!llama) return null;
  try {
    const result = await llama.completion({
      messages: [
        { role: "system", content: PREYAS_SYSTEM_PROMPT },
        { role: "user", content: brainUserPrompt(input) },
      ],
      n_predict: 160,
      temperature: 0.8,
    });
    const reply = parseBrainReply(result.text);
    if (!reply) return null;
    return brainReplyToSuggestion(reply);
  } catch {
    return null;
  }
}
