/**
 * One short recording for tap-to-talk (web). The browser asks for the
 * microphone only when the user taps, never on page load.
 */
import { encodeWav } from "./wav";

export type TapEar = {
  /** Open the microphone for a few seconds and keep the samples. */
  start: () => Promise<boolean>;
  /** Close the microphone and hand back a 16 kHz wav, or null if it was empty. */
  stop: () => Promise<Uint8Array | null>;
  /** Throw the recording away without returning any audio. */
  cancel: () => void;
};

export type TapEarResult = { ear: TapEar } | { denied: true };

export async function openTapEar(): Promise<TapEarResult> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) return { denied: true };
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch {
    return { denied: true };
  }
  const context = new AudioContext();
  if (context.state === "suspended") await context.resume();
  const source = context.createMediaStreamSource(stream);
  const processor = context.createScriptProcessor(1024, 1, 1);
  const silent = context.createGain();
  silent.gain.value = 0;
  source.connect(processor);
  processor.connect(silent);
  silent.connect(context.destination);
  const chunks: Float32Array[] = [];
  processor.onaudioprocess = (event) => {
    const input = event.inputBuffer.getChannelData(0);
    // 60 seconds is the auto-stop, a little headroom keeps a late tick in range.
    if (chunks.length > 3000) return;
    chunks.push(new Float32Array(input));
  };
  const close = () => {
    processor.onaudioprocess = null;
    try {
      processor.disconnect();
      source.disconnect();
      silent.disconnect();
    } catch {
      /* already gone */
    }
    for (const track of stream.getTracks()) track.stop();
    void context.close().catch(() => {});
  };
  return {
    ear: {
      async start() {
        chunks.length = 0;
        return true;
      },
      async stop() {
        const rate = context.sampleRate || 48000;
        close();
        let count = 0;
        for (const chunk of chunks) count += chunk.length;
        if (count === 0) return null;
        const merged = new Float32Array(count);
        let offset = 0;
        for (const chunk of chunks) {
          merged.set(chunk, offset);
          offset += chunk.length;
        }
        chunks.length = 0;
        return encodeWav(merged, rate);
      },
      cancel() {
        chunks.length = 0;
        close();
      },
    },
  };
}
