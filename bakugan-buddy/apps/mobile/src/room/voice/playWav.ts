import { createAudioPlayer } from "expo-audio";
import { File, Paths } from "expo-file-system";

export async function playWav(bytes: Uint8Array, onEnded?: () => void): Promise<{ stop: () => void }> {
  const file = new File(Paths.cache, `preyas-say-${Date.now()}.wav`);
  await file.write(bytes);
  const player = createAudioPlayer(file.uri);
  player.play();
  let ended = false;
  const finish = () => {
    if (ended) return;
    ended = true;
    clearTimeout(cap);
    onEnded?.();
  };
  const bytesPerSecond = 16000 * 2;
  const seconds = Math.min(20, Math.max(0.4, (bytes.length - 44) / bytesPerSecond));
  const cap = setTimeout(finish, seconds * 1000 + 700);
  return {
    stop: () => {
      player.pause();
      player.remove();
      finish();
    },
  };
}
