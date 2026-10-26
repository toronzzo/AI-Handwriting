import type { BakuganProfile } from "../bakugans";
import { fetchTtsWav, pingStudio } from "../studio";

export type SpeakHandle = {
  cancel: () => void;
  done: Promise<void>;
};

let ctx: AudioContext | null = null;
let currentSource: AudioBufferSourceNode | null = null;

function audioCtx(): AudioContext {
  if (!ctx || ctx.state === "closed") ctx = new AudioContext();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

export function warmVoices() {
  void pingStudio();
  try {
    audioCtx();
  } catch {
    /* ignore */
  }
}

export function bargeInAudio() {
  try {
    currentSource?.stop();
  } catch {
    /* already stopped */
  }
  currentSource = null;
}

export async function playWav(
  wav: ArrayBuffer,
  opts?: {
    cancelled?: () => boolean;
    onVolume?: (v: number) => void;
    onSpeakingChange?: (on: boolean) => void;
  },
): Promise<void> {
  const ac = audioCtx();
  const buf = await ac.decodeAudioData(wav.slice(0));
  if (opts?.cancelled?.()) {
    opts?.onVolume?.(0);
    return;
  }

  const src = ac.createBufferSource();
  const analyser = ac.createAnalyser();
  analyser.fftSize = 256;
  src.buffer = buf;
  src.connect(analyser);
  analyser.connect(ac.destination);
  currentSource = src;
  opts?.onSpeakingChange?.(true);

  const data = new Uint8Array(analyser.fftSize);
  let raf = 0;
  const tick = () => {
    analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      const v = (data[i]! - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / data.length);
    opts?.onVolume?.(Math.min(1, rms * 4));
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  await new Promise<void>((resolve) => {
    src.onended = () => resolve();
    try {
      src.start();
    } catch {
      resolve();
    }
  });
  cancelAnimationFrame(raf);
  if (currentSource === src) currentSource = null;
  opts?.onSpeakingChange?.(false);
  opts?.onVolume?.(0);
}

/**
 * Speak sentences via studio Piper/Kokoro (one setting per mood).
 */
export function speakSentences(
  sentences: string[],
  _profile: BakuganProfile,
  opts?: {
    voiceOn?: boolean;
    mood?: string;
    onStartSentence?: (i: number) => void;
    onSpeakingChange?: (speaking: boolean) => void;
    onVolume?: (v: number) => void;
  },
): SpeakHandle {
  let cancelled = false;
  const mood = opts?.mood || "happy";
  const voiceOn = opts?.voiceOn !== false;

  const done = (async () => {
    if (!voiceOn || sentences.length === 0) {
      opts?.onSpeakingChange?.(false);
      return;
    }
    try {
      for (let i = 0; i < sentences.length; i++) {
        if (cancelled) break;
        opts?.onStartSentence?.(i);
        const wav = await fetchTtsWav(sentences[i]!, mood);
        if (cancelled) break;
        await playWav(wav, {
          cancelled: () => cancelled,
          onVolume: opts?.onVolume,
          onSpeakingChange: opts?.onSpeakingChange,
        });
      }
    } catch {
      opts?.onSpeakingChange?.(false);
    }
  })();

  return {
    cancel() {
      cancelled = true;
      bargeInAudio();
    },
    done,
  };
}
