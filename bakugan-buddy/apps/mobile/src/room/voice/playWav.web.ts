let context: AudioContext | null = null;

export async function playWav(bytes: Uint8Array): Promise<{ stop: () => void }> {
  if (!context) context = new AudioContext();
  if (context.state === "suspended") await context.resume();
  const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const audio = await context.decodeAudioData(copy as ArrayBuffer);
  const source = context.createBufferSource();
  source.buffer = audio;
  source.connect(context.destination);
  source.start();
  return {
    stop: () => {
      try {
        source.stop();
      } catch {
        /* already stopped */
      }
    },
  };
}
