import type { Mood } from "../../../../packages/mood/src/index.ts";

/** Hermes does not always ship AbortSignal.timeout. */
function abortAfter(ms: number): AbortSignal {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

let studioUrl: string | null = null;
let audio: AudioContext | null = null;
let current: AudioBufferSourceNode | null = null;

/** One health check. Empty string means bubbles only. */
export async function probeStudio(): Promise<string | null> {
  const fromEnv = process.env.EXPO_PUBLIC_STUDIO_URL;
  const url =
    fromEnv ||
    (typeof window !== "undefined" && window.location?.hostname
      ? "http://127.0.0.1:8787"
      : "");
  if (!url) return null;
  try {
    const response = await fetch(`${url.replace(/\/$/, "")}/v1/health`, {
      signal: abortAfter(700),
    });
    if (!response.ok) return null;
    studioUrl = url.replace(/\/$/, "");
    return studioUrl;
  } catch {
    studioUrl = null;
    return null;
  }
}

/**
 * Text is always shown by the caller. If Home Studio TTS is up, also play
 * the wav. No bundled voice, no anime audio.
 */
export function speakLine(text: string, mood: Mood): void {
  if (!studioUrl || typeof fetch !== "function") return;
  const url = studioUrl;
  void (async () => {
    try {
      const response = await fetch(`${url}/v1/tts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, mood }),
      });
      if (!response.ok) return;
      const Ctor =
        typeof AudioContext !== "undefined"
          ? AudioContext
          : (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      if (!audio || audio.state === "closed") audio = new Ctor();
      if (audio.state === "suspended") await audio.resume();
      const decoded = await audio.decodeAudioData((await response.arrayBuffer()).slice(0));
      try {
        current?.stop();
      } catch {
        /* already stopped */
      }
      const source = audio.createBufferSource();
      source.buffer = decoded;
      source.connect(audio.destination);
      current = source;
      source.start();
    } catch {
      /* bubble already showed the line */
    }
  })();
}
