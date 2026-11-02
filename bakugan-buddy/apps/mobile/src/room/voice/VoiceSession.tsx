import { useEffect, useRef } from "react";
import {
  BARGE_VAD,
  clipTooShort,
  earIsMuted,
  envelopeFromPcm16,
  freshVad,
  hearsOwnVoice,
  isWhisperHallucination,
  micPhase,
  pcm16FromWav,
  recentLines,
  stepVad,
  synthesizeLine,
  takeNewSentences,
  transcribeClip,
  wavDurationMs,
  type MicPhase,
  type VadState,
} from "../../../../../packages/alive/src/speech.ts";
import { createEar, type Ear } from "./ear";
import { playWav } from "./playWav";

export type TalkSinks = {
  brainUrl: string;
  heard: string;
  hearLang: string;
  adviseAt: number;
  talkGen: number;
  talkEnv: number[];
  talkStart: number;
  talkUntil: number;
  spokenCount: number;
  stopTalk: (() => void) | null;
  playing?: boolean;
  thinking?: boolean;
  phase?: MicPhase;
};

export function interruptTalk(sinks: TalkSinks): void {
  sinks.talkGen += 1;
  sinks.playing = false;
  sinks.talkUntil = 0;
  sinks.talkEnv = [];
  const stop = sinks.stopTalk;
  sinks.stopTalk = null;
  stop?.();
}

export async function speakSentence(sinks: TalkSinks, sentence: string, mood: string): Promise<void> {
  if (!sinks.brainUrl || !sentence.trim()) return;
  const gen = sinks.talkGen;
  const wav = await synthesizeLine(sinks.brainUrl, sentence, mood, sinks.hearLang || "en");
  if (!wav || gen !== sinks.talkGen) return;
  const pcm = pcm16FromWav(wav);
  const durationMs = wavDurationMs(wav) ?? (pcm && pcm.length > 0 ? (pcm.length / 16000) * 1000 : 4000);
  if (pcm && pcm.length > 0) {
    sinks.talkEnv = envelopeFromPcm16(pcm, 320);
    sinks.talkStart = Date.now();
  }
  // Mute while the clip should be playing, but not forever if ended never fires.
  sinks.playing = true;
  sinks.talkUntil = Date.now() + durationMs + 1500;
  const handle = await playWav(wav, () => {
    if (gen !== sinks.talkGen) return;
    sinks.playing = false;
    sinks.talkUntil = Date.now();
  });
  if (gen !== sinks.talkGen) {
    handle.stop();
    sinks.playing = false;
    sinks.talkUntil = 0;
    return;
  }
  sinks.stopTalk = () => {
    handle.stop();
    sinks.playing = false;
    sinks.talkUntil = 0;
  };
}

const speakChain = new WeakMap<object, Promise<void>>();

/** Speak finished sentences once. A second final of the same line does not replay them. */
export function queueSpokenLine(sinks: TalkSinks, line: string, mood: string, final: boolean): void {
  const fresh = takeNewSentences(sinks, line, final);
  sinks.spokenCount += fresh.length;
  let chain = speakChain.get(sinks) ?? Promise.resolve();
  for (let i = 0; i < fresh.length; i++) {
    const sentence = fresh[i]!;
    chain = chain.then(() => speakSentence(sinks, sentence, mood)).catch(() => {});
  }
  speakChain.set(sinks, chain);
}

export function VoiceSession({ sinks }: { sinks: TalkSinks }) {
  const ear = useRef<Ear | null>(null);
  const vad = useRef<VadState>(freshVad());

  useEffect(() => {
    let cancel = false;
    void createEar().then((next) => {
      if (cancel || !next) return;
      ear.current = next;
      void next.start();
    });
    let muted = false;
    const timer = setInterval(() => {
      const current = ear.current;
      if (!current || !sinks.brainUrl) return;
      const now = Date.now();
      if (sinks.playing && sinks.talkUntil > 0 && now > sinks.talkUntil) {
        sinks.playing = false;
        sinks.talkUntil = now;
      }
      sinks.phase = micPhase(now, {
        thinking: Boolean(sinks.thinking),
        playing: Boolean(sinks.playing),
        talkUntil: sinks.talkUntil,
      });
      if (earIsMuted(now, sinks.talkUntil)) {
        if (!muted) {
          muted = true;
          vad.current = freshVad();
          void current.start();
        }
        const step = stepVad(vad.current, current.rms(), 50, BARGE_VAD);
        vad.current = step.state;
        if (step.bargeIn) {
          interruptTalk(sinks);
          muted = false;
          vad.current = freshVad();
          void current.start();
        } else if (step.endpoint) {
          vad.current = freshVad();
          void current.start();
        }
        return;
      }
      if (muted) {
        muted = false;
        vad.current = freshVad();
        void current.start();
      }
      const step = stepVad(vad.current, current.rms(), 50);
      vad.current = step.state;
      if (step.bargeIn) interruptTalk(sinks);
      if (!step.endpoint) return;
      void current.stop().then(async (wav) => {
        void current.start();
        if (!wav || clipTooShort(wav)) return;
        const heard = await transcribeClip(sinks.brainUrl, wav);
        if (!heard || isWhisperHallucination(heard.text)) return;
        if (hearsOwnVoice(heard.text, recentLines(sinks))) return;
        sinks.heard = heard.text;
        sinks.hearLang = heard.language;
        sinks.adviseAt = 0;
      });
    }, 50);
    return () => {
      cancel = true;
      clearInterval(timer);
      void ear.current?.stop();
      ear.current = null;
    };
  }, [sinks]);

  return null;
}
