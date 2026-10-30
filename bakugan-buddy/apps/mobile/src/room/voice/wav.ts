/** 16 kHz mono wav. Downsamples by dropping samples so the helper stays tiny. */
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const step = sampleRate > 16000 ? Math.round(sampleRate / 16000) : 1;
  const count = Math.ceil(samples.length / step);
  const bytes = new Uint8Array(44 + count * 2);
  const view = new DataView(bytes.buffer);
  const write = (at: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(at + i, text.charCodeAt(i));
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + count * 2, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true);
  view.setUint32(28, 32000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, count * 2, true);
  let out = 0;
  for (let i = 0; i < samples.length; i += step) {
    const clamped = Math.max(-1, Math.min(1, samples[i]!));
    view.setInt16(44 + out * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    out += 1;
  }
  return bytes;
}
