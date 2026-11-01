import { useEffect, useRef } from "react";
import {
  BARGE_VAD,
  clipTooShort,
  earIsMuted,
  envelopeFromPcm16,
  freshVad,
  hearsOwnVoice,
  isWhisperHallucination,
  pcm16FromWav,
  recentLines,
  stepVad,
  synthesizeLine,
  takeNewSentences,
  transcribeClip,
  type VadState,
} from "../../../../../packages/alive/src/speech.ts";
import { createEar, type Ear } from "./ear";
import { playWav } from "./playWav";

type TalkSinks = {
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
};

export function interruptTalk(sinks: TalkSinks): void {
  sinks.talkGen += 1;
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
  if (pcm && pcm.length > 0) {
    sinks.talkEnv = envelopeFromPcm16(pcm, 320);
    sinks.talkStart = Date.now();
    sinks.talkUntil = sinks.talkStart + (pcm.length / 16000) * 1000;
  }
  const handle = await playWav(wav);
  if (gen !== sinks.talkGen) {
    handle.stop();
    return;
  }
  sinks.stopTalk = () => {
    handle.stop();
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
