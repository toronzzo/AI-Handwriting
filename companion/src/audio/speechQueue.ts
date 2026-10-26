import type { BakuganProfile } from "../bakugans";

/**
 * Queues utterances so each sentence starts as soon as it's enqueued,
 * without cancelling earlier sentences. cancel() barges in mid-sentence.
 */
export class SpeechQueue {
  private cancelled = false;
  private chain: Promise<void> = Promise.resolve();
  private speaking = false;
  private onSpeakingChange?: (speaking: boolean) => void;

  constructor(onSpeakingChange?: (speaking: boolean) => void) {
    this.onSpeakingChange = onSpeakingChange;
  }

  enqueue(sentence: string, profile: BakuganProfile, voiceOn: boolean) {
    if (!voiceOn || !("speechSynthesis" in window) || !sentence.trim()) return;
    this.chain = this.chain.then(async () => {
      if (this.cancelled) return;
      await this.speakOne(sentence, profile);
    });
  }

  cancel() {
    this.cancelled = true;
    window.speechSynthesis?.cancel();
    this.setSpeaking(false);
    this.cancelled = false;
    this.chain = Promise.resolve();
  }

  private setSpeaking(v: boolean) {
    if (this.speaking === v) return;
    this.speaking = v;
    this.onSpeakingChange?.(v);
  }

  private speakOne(text: string, profile: BakuganProfile): Promise<void> {
    return new Promise((resolve) => {
      if (this.cancelled) {
        resolve();
        return;
      }
      this.setSpeaking(true);
      const u = new SpeechSynthesisUtterance(text);
      u.pitch = profile.voice.pitch;
      u.rate = profile.voice.rate;
      const voice = pickVoice(profile);
      if (voice) u.voice = voice;
      u.onend = () => {
        if (!window.speechSynthesis.speaking) this.setSpeaking(false);
        resolve();
      };
      u.onerror = () => {
        if (!window.speechSynthesis.speaking) this.setSpeaking(false);
        resolve();
      };
      window.speechSynthesis.speak(u);
    });
  }
}

function pickVoice(profile: BakuganProfile): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;
  const prefer =
    profile.attribute === "aquos"
      ? /female|samantha|victoria|karen|moira|zira/i
      : profile.attribute === "darkus"
        ? /male|daniel|alex|david|fred|google uk english male/i
        : /male|daniel|alex|david|fred|google us english/i;
  return voices.find((v) => prefer.test(v.name)) ?? voices[0] ?? null;
}
