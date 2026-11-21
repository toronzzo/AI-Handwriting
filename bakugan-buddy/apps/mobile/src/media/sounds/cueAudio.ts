/**
 * The one expo-audio cue backend, shared by both platform files.
 *
 * Every platform plays a bundled asset id the same way, so this module holds
 * the create/play/stop code once: playCue.ts (web) and playCue.native.ts
 * (iPhone and Android) differ only in how they answer "is the page hidden?".
 * The house pattern for those small differences is one file per platform, not
 * two copies of the audio code.
 *
 * Nothing here throws: a null return means "could not start", and
 * cueSession.ts turns that into a silent skip.
 */
import { createAudioPlayer, type AudioPlayer } from "expo-audio";
import { CUE_VOLUME, clampVolume, type Cue } from "./cues.ts";
import { createCueSession, type CuePlayer, type CueSession } from "./cueSession.ts";
import { CUE_SOURCES } from "./sources.ts";
import { readSoundSettings } from "./soundSettings.ts";

/** Open one bundled cue at the quiet house volume. Null means no player. */
export function openCuePlayer(cue: Cue): CuePlayer | null {
  const assetId = CUE_SOURCES[cue.id];
  if (typeof assetId !== "number") return null;
  let player: AudioPlayer | null = null;
  try {
    player = createAudioPlayer(assetId, { updateInterval: 250 });
    player.volume = clampVolume(CUE_VOLUME);
    const opened = player;
    return {
      play: () => opened.play(),
      stop: () => {
        try {
          opened.pause();
        } finally {
          opened.remove();
        }
      },
    };
  } catch {
    try {
      player?.remove();
    } catch {
      /* nothing left to free */
    }
    return null;
  }
}

/**
 * A session for one platform. `hidden` is the only difference between web and
 * the phone; everything else, including the "Sounds" switch, is shared.
 */
export function createPlatformCueSession(hidden: () => boolean, reduce: () => boolean): CueSession {
  return createCueSession({
    enabled: () => readSoundSettings().sounds,
    // expo-audio's backend is linked on every platform this ships to; a
    // missing asset never reaches play() at all (openCuePlayer returns null).
    available: () => true,
    hidden,
    reduce,
    open: openCuePlayer,
  });
}
