/**
 * Voice coach: reads coach steps aloud (Piper) and takes push-to-talk replies
 * (Whisper). Lives inside the coach popover. Never sends anything by voice
 * without a transcript the user could see — except the autoSend words.
 * Voice turns are not shown in the chat transcript in this version.
 */
import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { theme } from "../theme";
import { currentBrainUrl } from "../room/brain/brainLink";
import { brainFetch } from "../room/brain/token";
import { clipTooShort, isWhisperHallucination, synthesizeLine, transcribeClip } from "../../../../packages/alive/src/speech.ts";
import { createEar, type Ear } from "../room/voice/ear";
import { playWav } from "../room/voice/playWav";
import { readVoicePrefs, writeVoicePrefs } from "./voicePrefs";
import type { CoachState } from "./useCoach";

type Speak = { id: number; text: string; lang: string };

export function CoachVoice() {
  const [readAloud, setReadAloud] = useState<boolean>(readVoicePrefs().readAloud);
  const [ttsOk, setTtsOk] = useState<boolean>(true);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [coachReply, setCoachReply] = useState<string | null>(null);
  const [note, setNote] = useState<string>("");
  const [holding, setHolding] = useState<boolean>(false);
  const [panelState, setPanelState] = useState<CoachState | null>(null);

  const readAloudRef = useRef(readAloud);
  readAloudRef.current = readAloud;
  const lastSpeakRef = useRef<Speak | null>(null);
  const earRef = useRef<Ear | null>(null);
  const audioRef = useRef<{ stop: () => void } | null>(null);
  const panelStateRef = useRef<CoachState | null>(null);
  panelStateRef.current = panelState;

  function stopAudio() {
    audioRef.current?.stop();
    audioRef.current = null;
  }

  async function speak(text: string, lang: string) {
    if (!text || !readAloudRef.current || !ttsOk) return;
    stopAudio();
    try {
      const bytes = await synthesizeLine(currentBrainUrl(), text, "neutral", lang);
      if (!bytes) return;
      audioRef.current = await playWav(bytes);
    } catch {
      /* voice is a nicety; typing always works */
    }
  }

  // One-time: does the brain actually have TTS?
  useEffect(() => {
    void (async () => {
      try {
        const res = await brainFetch(`${currentBrainUrl()}/v1/speech`);
        const info = await res.json();
        setTtsOk(Boolean(info && info.tts));
      } catch {
        setTtsOk(false);
      }
    })();
  }, []);

  // Read aloud: poll coach state every 2 s while the switch is on and the
  // coach is active; speak when lastSpeak.id changes.
  useEffect(() => {
    if (!readAloud) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const poll = async () => {
      try {
        const res = await brainFetch(`${currentBrainUrl()}/v1/coach/state`);
        const state = (await res.json()) as CoachState;
        setPanelState(state);
        const last = state.lastSpeak;
        if (last && last.text && last.id !== lastSpeakRef.current?.id && state.mode !== "off") {
          lastSpeakRef.current = last;
          void speak(last.text, last.lang);
        }
      } catch {
        /* brain offline: typing works */
      }
    };
    void poll();
    timer = setInterval(poll, 2000);
    return () => {
      if (timer) clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readAloud, ttsOk]);

  // Cleanup on popover close: release the microphone and stop audio.
  useEffect(() => {
    return () => {
      if (earRef.current) {
        void earRef.current.stop();
        earRef.current = null;
      }
      stopAudio();
    };
  }, []);

  async function holdStart() {
    setNote("");
    stopAudio();
    try {
      const ear = await createEar();
      if (!ear) {
        setNote("Microphone is not available; you can type.");
        return;
      }
      earRef.current = ear;
      await ear.start();
      setHolding(true);
    } catch {
      setNote("Microphone is not available; you can type.");
    }
  }

  async function holdRelease() {
    setHolding(false);
    const ear = earRef.current;
    earRef.current = null;
    if (!ear) return;
    try {
      const wav = await ear.stop();
      if (!wav || clipTooShort(wav)) {
        setNote("Too short; hold the button and say it again.");
        return;
      }
      const heard = await transcribeClip(currentBrainUrl(), wav);
      if (!heard || isWhisperHallucination(heard.text)) {
        setNote("I did not catch that; try again.");
        return;
      }
      const text = heard.text.trim();
      if (!text) {
        setNote("I did not catch that; try again.");
        return;
      }
      setTranscript(text);
      setCoachReply(null);
      const intentRes = await brainFetch(`${currentBrainUrl()}/v1/coach/voice-intent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const intent = await intentRes.json();
      if (intent.autoSend) void sendVoice(text);
    } catch {
      setNote("Voice did not work this time; you can type.");
    }
  }

  async function sendVoice(text: string) {
    try {
      const res = await brainFetch(`${currentBrainUrl()}/v1/coach/turn`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      setTranscript(null);
      if (data && data.reply) {
        setCoachReply(data.reply);
        if (data.speak && data.speak.text && readAloudRef.current) void speak(data.speak.text, data.speak.lang);
      } else {
        setNote("The coach did not answer; you can type.");
      }
    } catch {
      setNote("The brain is offline; you can type.");
    }
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <Text style={styles.label}>Read steps aloud</Text>
        <Switch
          value={readAloud}
          onValueChange={(value) => {
            setReadAloud(value);
            writeVoicePrefs({ readAloud: value });
            if (!value) stopAudio();
          }}
          trackColor={{ false: theme.track, true: theme.accent }}
          thumbColor={theme.onAccent}
          accessibilityLabel="Read steps aloud"
        />
      </View>
      {!ttsOk ? <Text style={styles.note}>Voice works on the Mac; you can type.</Text> : null}

      <Pressable
        style={[styles.hold, holding && styles.holdActive]}
        onPressIn={() => void holdStart()}
        onPressOut={() => void holdRelease()}
        accessibilityLabel="Hold to talk"
        accessibilityRole="button"
      >
        <Text style={styles.holdText}>{holding ? "Listening…" : "Hold to talk"}</Text>
      </Pressable>

      {transcript ? (
        <View style={styles.transcriptBox}>
          <Text style={styles.transcriptLabel}>HEARD</Text>
          <Text style={styles.transcript}>{transcript}</Text>
          <View style={styles.buttonRow}>
            <Pressable style={styles.sendButton} onPress={() => void sendVoice(transcript)} accessibilityLabel="Send voice reply">
              <Text style={styles.sendText}>Send</Text>
            </Pressable>
            <Pressable style={styles.ghostButton} onPress={() => setTranscript(null)} accessibilityLabel="Try again">
              <Text style={styles.ghostText}>Again</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {coachReply ? (
        <View style={styles.replyBox}>
          <Text style={styles.transcriptLabel}>COACH</Text>
          <Text style={styles.reply}>{coachReply}</Text>
        </View>
      ) : null}
      {note ? <Text style={styles.note}>{note}</Text> : null}
      {panelState && panelState.mode === "skill" && panelState.skillName ? (
        <Text style={styles.note}>
          Now: {panelState.skillName} step {panelState.step} of {panelState.of}.
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 10 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 36,
  },
  label: { color: theme.text, fontSize: 14, fontWeight: "600" },
  hold: {
    minHeight: 48,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.accentLine,
    backgroundColor: theme.cardSoft,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  },
  holdActive: { backgroundColor: theme.accentSoft, borderColor: theme.accentText },
  holdText: { color: theme.accentText, fontSize: 15, fontWeight: "700" },
  transcriptBox: { marginTop: 10, padding: 10, borderRadius: 10, backgroundColor: theme.cardSoft, borderWidth: 1, borderColor: theme.accentLine },
  transcriptLabel: { color: theme.dim, fontSize: 11, fontWeight: "700", letterSpacing: 1.2, textTransform: "uppercase" },
  transcript: { color: theme.text, fontSize: 14, lineHeight: 20, marginTop: 4 },
  replyBox: { marginTop: 10, padding: 10, borderRadius: 10, backgroundColor: theme.cardSoft, borderWidth: 1, borderColor: theme.accentLine },
  reply: { color: theme.text, fontSize: 13, lineHeight: 19, marginTop: 4 },
  buttonRow: { flexDirection: "row", gap: 8, marginTop: 8 },
  sendButton: {
    minHeight: 44,
    minWidth: 96,
    borderRadius: 10,
    backgroundColor: theme.accent,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  sendText: { color: theme.onAccent, fontSize: 13, fontWeight: "700" },
  ghostButton: {
    minHeight: 44,
    minWidth: 96,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.accentLine,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  ghostText: { color: theme.text, fontSize: 13 },
  note: { color: theme.dim, fontSize: 12, lineHeight: 17, marginTop: 6 },
});
