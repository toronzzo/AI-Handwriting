import { encodeWav } from "./wav";

export type Ear = {
  start: () => Promise<void>;
  stop: () => Promise<Uint8Array | null>;
  rms: () => number;
};

export async function createEar(): Promise<Ear | null> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) return null;
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const context = new AudioContext();
  const source = context.createMediaStreamSource(stream);
  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  source.connect(analyser);
  const bins = new Float32Array(analyser.fftSize);
  const chunks: Float32Array[] = [];
  const processor = context.createScriptProcessor(1024, 1, 1);
  const silent = context.createGain();
  silent.gain.value = 0;
  source.connect(processor);
  processor.connect(silent);
  silent.connect(context.destination);
  let level = 0;
  processor.onaudioprocess = (event) => {
    const input = event.inputBuffer.getChannelData(0);
    chunks.push(new Float32Array(input));
    if (chunks.length > 400) chunks.shift();
    let sum = 0;
    for (let i = 0; i < input.length; i++) sum += input[i]! * input[i]!;
    level = Math.sqrt(sum / input.length);
  };
  void bins;
  return {
    async start() {
      chunks.length = 0;
      if (context.state === "suspended") await context.resume();
    },
    rms() {
      return level > 1 ? 1 : level;
    },
    async stop() {
      const rate = context.sampleRate || 48000;
      let count = 0;
      for (const chunk of chunks) count += chunk.length;
      const merged = new Float32Array(count);
      let offset = 0;
      for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.length;
      }
      chunks.length = 0;
      return encodeWav(merged, rate);
    },
  };
}
