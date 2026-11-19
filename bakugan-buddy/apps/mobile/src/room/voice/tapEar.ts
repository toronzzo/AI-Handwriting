/**
 * One short recording for tap-to-talk.
 *
 * On the web (the Mac) it is the same browser capture the voice session uses,
 * so a tap gives a real 16 kHz wav and the mic permission is asked only then.
 * On the iPhone it falls back to expo-audio with the recording preset the ear
 * already uses.
 */
import { AudioModule, RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync } from "expo-audio";
import { File } from "expo-file-system";
import { openTapEar as openWebTapEar } from "./tapEar.web";

export type TapEar = {
  start: () => Promise<boolean>;
  stop: () => Promise<Uint8Array | null>;
  cancel: () => void;
};

export type TapEarResult = { ear: TapEar } | { denied: true };

async function openPhoneTapEar(): Promise<TapEarResult> {
  try {
    const permission = await requestRecordingPermissionsAsync();
    if (!permission.granted) return { denied: true };
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
  } catch {
    return { denied: true };
  }
  const recorder = new AudioModule.AudioRecorder(RecordingPresets.HIGH_QUALITY);
  let prepared = false;
  return {
    ear: {
      async start() {
        if (!prepared) {
          await recorder.prepareToRecordAsync();
          prepared = true;
        }
        recorder.record();
        return true;
      },
      async stop() {
        await recorder.stop();
        prepared = false;
        const uri = recorder.uri;
        if (!uri) return null;
        try {
          const bytes = await new File(uri).bytes();
          return bytes.length > 44 ? new Uint8Array(bytes) : null;
        } catch {
          return null;
        }
      },
      cancel() {
        prepared = false;
        void recorder.stop().catch(() => {});
      },
    },
  };
}

export async function openTapEar(): Promise<TapEarResult> {
  if (typeof document !== "undefined") {
    return openWebTapEar();
  }
  return openPhoneTapEar();
}
