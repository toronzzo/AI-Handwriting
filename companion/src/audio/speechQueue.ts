import type { BakuganProfile } from "../bakugans";
import { bargeInAudio, playWav } from "./speech";
import { fetchTtsWav } from "../studio";

/**
 * Queues Piper/Kokoro sentences. cancel() barges in mid-sentence.
 */
export class SpeechQueue {
  private gen = 0;
  private chain: Promise<void> = Promise.resolve();
  private speaking = false;
  private onSpeakingChange?: (speaking: boolean) => void;
  private onVolume?: (v: number) => void;

  constructor(
    onSpeakingChange?: (speaking: boolean) => void,
    onVolume?: (v: number) => void,
  ) {
    this.onSpeakingChange = onSpeakingChange;
    this.onVolume = onVolume;
  }

  enqueue(
    sentence: string,
    _profile: BakuganProfile,
    voiceOn: boolean,
    mood = "happy",
  ) {
    if (!voiceOn || !sentence.trim()) return;
    const gen = this.gen;
    this.chain = this.chain.then(async () => {
      if (this.gen !== gen) return;
      try {
        const wav = await fetchTtsWav(sentence, mood);
        if (this.gen !== gen) return;
        this.setSpeaking(true);
        await playWav(wav, {
          cancelled: () => this.gen !== gen,
          onVolume: this.onVolume,
          onSpeakingChange: (on) => {
            if (this.gen !== gen) return;
            this.setSpeaking(on);
          },
        });
      } catch {
        /* sidecar down — typed chat still works */
      } finally {
        if (this.gen === gen) this.setSpeaking(false);
      }
    });
  }

  cancel() {
    const t0 = performance.now();
    this.gen += 1;
    bargeInAudio();
    this.setSpeaking(false);
    this.onVolume?.(0);
    this.chain = Promise.resolve();
    const ms = performance.now() - t0;
    console.info(`[speech] barge-in ${ms.toFixed(1)} ms`);
  }

  private setSpeaking(v: boolean) {
    if (this.speaking === v) return;
    this.speaking = v;
    this.onSpeakingChange?.(v);
  }
}
