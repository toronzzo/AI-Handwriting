import { createAudioPlayer } from "expo-audio";
import { File, Paths } from "expo-file-system";

export async function playWav(bytes: Uint8Array): Promise<{ stop: () => void }> {
  const file = new File(Paths.cache, `preyas-say-${Date.now()}.wav`);
  await file.write(bytes);
  const player = createAudioPlayer(file.uri);
  player.play();
  return {
    stop: () => {
      player.pause();
      player.remove();
    },
  };
}
