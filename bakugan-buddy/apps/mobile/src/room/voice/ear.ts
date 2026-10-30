import {
  AudioModule,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
} from "expo-audio";
import { File } from "expo-file-system";

export type Ear = {
  start: () => Promise<void>;
  stop: () => Promise<Uint8Array | null>;
  rms: () => number;
};

export async function createEar(): Promise<Ear | null> {
  const permission = await requestRecordingPermissionsAsync();
  if (!permission.granted) return null;
  await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
  const recorder = new AudioModule.AudioRecorder({
    ...RecordingPresets.HIGH_QUALITY,
    isMeteringEnabled: true,
  });
  await recorder.prepareToRecordAsync();
  return {
    async start() {
      recorder.record();
    },
    rms() {
      const db = recorder.getStatus().metering;
      if (typeof db !== "number") return 0;
      const linear = Math.pow(10, db / 20);
      return linear > 1 ? 1 : linear;
    },
    async stop() {
      await recorder.stop();
      const uri = recorder.uri;
      await recorder.prepareToRecordAsync();
      if (!uri) return null;
      try {
        const bytes = await new File(uri).bytes();
        return new Uint8Array(bytes);
      } catch {
        return null;
      }
    },
  };
}
