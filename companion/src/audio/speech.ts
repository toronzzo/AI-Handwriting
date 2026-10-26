import type { BakuganProfile } from "../bakugans";

export type SpeakHandle = {
  cancel: () => void;
  done: Promise<void>;
};

/**
 * Speak sentences as soon as each is ready. cancel() = barge-in mid-sentence.
 */
export function speakSentences(
  sentences: string[],
  profile: BakuganProfile,
  opts?: {
    voiceOn?: boolean;
    onStartSentence?: (i: number) => void;
    onSpeakingChange?: (speaking: boolean) => void;
  },
): SpeakHandle {
  let cancelled = false;
  const voiceOn = opts?.voiceOn !== false;

  const done = (async () => {
    if (!voiceOn || !("speechSynthesis" in window) || sentences.length === 0) {
      opts?.onSpeakingChange?.(false);
      return;
    }
    opts?.onSpeakingChange?.(true);
    try {
      for (let i = 0; i < sentences.length; i++) {
        if (cancelled) break;
        opts?.onStartSentence?.(i);
        await speakOne(sentences[i]!, profile, () => cancelled);
      }
    } finally {
      opts?.onSpeakingChange?.(false);
    }
  })();

  return {
    cancel() {
      cancelled = true;
      window.speechSynthesis?.cancel();
    },
    done,
  };
}

function speakOne(
  text: string,
  profile: BakuganProfile,
  isCancelled: () => boolean,
): Promise<void> {
  return new Promise((resolve) => {
    if (isCancelled()) {
      resolve();
      return;
    }
    const u = new SpeechSynthesisUtterance(text);
    u.pitch = profile.voice.pitch;
    u.rate = profile.voice.rate;
    const voice = pickVoice(profile);
    if (voice) u.voice = voice;
    u.onend = () => resolve();
    u.onerror = () => resolve();
    window.speechSynthesis.speak(u);
  });
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

export function warmVoices() {
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.getVoices();
  window.speechSynthesis.onvoiceschanged = () => {
    window.speechSynthesis.getVoices();
  };
}
