let context: AudioContext | null = null;

export async function playWav(bytes: Uint8Array, onEnded?: () => void): Promise<{ stop: () => void }> {
  if (!context) context = new AudioContext();
  if (context.state === "suspended") await context.resume();
  const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const audio = await context.decodeAudioData(copy as ArrayBuffer);
  const source = context.createBufferSource();
  source.buffer = audio;
  source.connect(context.destination);
  let ended = false;
  const finish = () => {
    if (ended) return;
    ended = true;
    window.clearTimeout(cap);
    onEnded?.();
  };
  const cap = window.setTimeout(finish, (audio.duration > 0 ? audio.duration : 8) * 1000 + 700);
  source.onended = finish;
  source.start();
  return {
    stop: () => {
      try {
        source.stop();
      } catch {
        /* already stopped */
      }
      finish();
    },
  };
}
