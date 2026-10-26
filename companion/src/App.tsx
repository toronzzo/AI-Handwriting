import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { FormEvent } from "react";
import { BAKUGANS, BAKUGAN_LIST, type BakuganId, type Emotion } from "./bakugans";
import { streamReply } from "./brain";
import { loadMemory, saveMemory, type PartnerMemory } from "./memory";
import type { ChatMessage, Form } from "./types";
import { BakuganBall } from "./face/BakuganBall";
import { NeuralCore, type NeuralPulse } from "./face/NeuralCore";
import { TrainingPanel } from "./TrainingPanel";
import { playEmotionSound } from "./audio/emotionSounds";
import { createListener } from "./audio/listen";
import { warmVoices } from "./audio/speech";
import { SpeechQueue } from "./audio/speechQueue";
import { pingStudio, type StudioHealth } from "./studio";
import {
  applyTrainEvent,
  loadTraining,
  nextDrill,
  saveTraining,
  type Drill,
  type TrainingState,
} from "./training";
import { coachIdleLine, coachNextLine, coachUnlockLine, type CoachLine } from "./coach";
import "./App.css";

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function App() {
  const [awake, setAwake] = useState(false);
  const [mem, setMem] = useState<PartnerMemory>(() => loadMemory());
  const [training, setTraining] = useState<TrainingState>(() => loadTraining());
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [partial, setPartial] = useState("");
  const [busy, setBusy] = useState(false);
  const [voiceOn, setVoiceOn] = useState(true);
  const [micOn, setMicOn] = useState(false);
  const [emotion, setEmotion] = useState<Emotion>("neutral");
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [streamText, setStreamText] = useState("");
  const [willSay, setWillSay] = useState("");
  const [pulses, setPulses] = useState<NeuralPulse[]>([]);
  const [trace, setTrace] = useState<{ layer: string; label: string }[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [studio, setStudio] = useState<StudioHealth | null>(null);
  const [talkVolume, setTalkVolume] = useState(0);
  const liveEmotionRef = useRef<Emotion>("happy");

  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const memRef = useRef(mem);
  const trainingRef = useRef(training);
  const voiceOnRef = useRef(voiceOn);
  const abortRef = useRef<AbortController | null>(null);
  const queueRef = useRef<SpeechQueue | null>(null);
  const micRef = useRef<ReturnType<typeof createListener> | null>(null);
  const lastActRef = useRef(Date.now());
  const idleHintedRef = useRef(false);
  const busyRef = useRef(false);

  const profile = BAKUGANS[mem.activeId];
  const form = mem.forms[mem.activeId];

  useEffect(() => {
    memRef.current = mem;
    saveMemory(mem);
  }, [mem]);

  useEffect(() => {
    trainingRef.current = training;
    saveTraining(training);
  }, [training]);

  useEffect(() => {
    voiceOnRef.current = voiceOn;
  }, [voiceOn]);

  useEffect(() => {
    warmVoices();
    queueRef.current = new SpeechQueue(
      (on) => {
        setSpeaking(on);
        if (on) {
          patchTrain({ kind: "voice" });
        } else {
          setTalkVolume(0);
        }
      },
      (v) => setTalkVolume(v),
    );
    void pingStudio().then(setStudio);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.attr = profile.attribute;
    document.documentElement.style.setProperty("--c-primary", profile.colors.shell);
    document.documentElement.style.setProperty("--c-secondary", profile.colors.accent);
    document.documentElement.style.setProperty("--c-glow", profile.colors.core);
    document.documentElement.style.setProperty("--c-deep", profile.colors.shellDeep);
    document.documentElement.style.setProperty("--c-ash", profile.colors.ash);
  }, [profile]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, streamText, partial, busy]);

  useEffect(() => {
    return () => {
      micRef.current?.stop();
      queueRef.current?.cancel();
      abortRef.current?.abort();
    };
  }, []);

  function bumpActivity() {
    lastActRef.current = Date.now();
  }

  function patchTrain(
    ev: Parameters<typeof applyTrainEvent>[1],
  ): Drill[] {
    const { state, newly } = applyTrainEvent(trainingRef.current, ev);
    trainingRef.current = state;
    setTraining(state);
    if (newly.length) {
      setToast(`Unlocked: ${newly.map((d) => d.title).join(", ")}`);
      window.setTimeout(() => setToast(null), 3200);
    }
    return newly;
  }

  function speakCoach(line: CoachLine, reason: string) {
    const id = memRef.current.activeId;
    const p = BAKUGANS[id];
    pushNeural("feel", `[${line.emotion}]`);
    pushNeural("intend", reason);
    pushNeural("speak", line.text.slice(0, 40));
    setEmotion(line.emotion);
    setWillSay(line.text);
    playEmotionSound(line.emotion);
    setMessages((m) => [
      ...m,
      {
        id: uid(),
        role: "bakugan",
        bakuganId: id,
        text: line.text,
        emotion: line.emotion,
        at: Date.now(),
      },
    ]);
    if (voiceOnRef.current) {
      queueRef.current?.enqueue(line.text, p, true, line.emotion);
      patchTrain({ kind: "voice" });
    }
  }

  useEffect(() => {
    if (!awake) return;
    const tick = window.setInterval(() => {
      if (idleHintedRef.current || busyRef.current) return;
      if (Date.now() - lastActRef.current < 28000) return;
      const upcoming = nextDrill(trainingRef.current);
      if (!upcoming) return;
      idleHintedRef.current = true;
      const line = coachIdleLine(
        memRef.current.activeId,
        upcoming,
        memRef.current.partnerName,
      );
      speakCoach(line, "idle coach");
    }, 4000);
    return () => window.clearInterval(tick);
  }, [awake]);

  function pickDrill(drill: Drill) {
    bumpActivity();
    bargeIn();
    if (drill.id === "mic_listen") {
      void toggleMic();
      return;
    }
    if (drill.autoSend && drill.prompt) {
      void runTurn(drill.prompt);
      return;
    }
    if (drill.prompt) {
      flushSync(() => setDraft(drill.prompt!));
      const el = inputRef.current;
      if (el) {
        el.focus();
        const n = el.value.length;
        el.setSelectionRange(n, n);
      }
    }
  }

  function pushNeural(layer: NeuralPulse["layer"], label: string) {
    const pulse = { layer, label, at: performance.now() };
    setPulses((p) => [...p.slice(-24), pulse]);
    setTrace((t) => [...t.slice(-20), { layer, label }]);
    patchTrain({ kind: "neurons" });
  }

  function bargeIn() {
    queueRef.current?.cancel();
    abortRef.current?.abort();
  }

  async function runTurn(userText: string) {
    const text = userText.trim();
    if (!text || busy) return;

    bargeIn();
    bumpActivity();
    const ac = new AbortController();
    abortRef.current = ac;

    setDraft("");
    setPartial("");
    setWillSay("");
    setMessages((m) => [...m, { id: uid(), role: "you", text, at: Date.now() }]);
    busyRef.current = true;
    setBusy(true);
    setEmotion("thinking");
    setStreamText("");
    const unlockedThisTurn: Drill[] = [
      ...patchTrain({ kind: "user", text, mem: memRef.current }),
    ];

    const spoken: string[] = [];
    let activeId = memRef.current.activeId;
    liveEmotionRef.current = "thinking";

    try {
      for await (const ev of streamReply(text, memRef.current, {
        signal: ac.signal,
        nextDrill: nextDrill(trainingRef.current),
      })) {
        if (ev.type === "neural") {
          pushNeural(ev.layer, ev.label);
          if (ev.label.includes("offline core")) {
            setToast("Core's offline — bouncing local. Start studio for llama.cpp.");
            window.setTimeout(() => setToast(null), 3200);
          }
        } else if (ev.type === "preview") {
          setWillSay(ev.willSay);
        } else if (ev.type === "emotion") {
          activeId = ev.memory.activeId;
          liveEmotionRef.current = ev.emotion;
          setEmotion(ev.emotion);
          setMem(ev.memory);
          playEmotionSound(ev.emotion);
          unlockedThisTurn.push(
            ...patchTrain({ kind: "emotion", emotion: ev.emotion, mem: ev.memory }),
          );
          if (ev.switchedTo) setStreamText("");
        } else if (ev.type === "sentence") {
          spoken.push(ev.sentence);
          setStreamText(spoken.join(" "));
          queueRef.current?.enqueue(
            ev.sentence,
            BAKUGANS[activeId],
            voiceOnRef.current,
            liveEmotionRef.current,
          );
        } else if (ev.type === "done") {
          setMem(ev.result.memory);
          unlockedThisTurn.push(
            ...patchTrain({ kind: "emotion", emotion: ev.result.emotion, mem: ev.result.memory }),
          );
          setMessages((m) => [
            ...m,
            {
              id: uid(),
              role: "bakugan",
              bakuganId: ev.result.memory.activeId,
              text: ev.result.text,
              emotion: ev.result.emotion,
              at: Date.now(),
            },
          ]);
          setStreamText("");
          setEmotion(ev.result.emotion);
        }
      }
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        console.error(err);
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
      const unique = [...new Map(unlockedThisTurn.map((d) => [d.id, d])).values()];
      const upcoming = nextDrill(trainingRef.current);
      if (unique.length && upcoming) {
        const line = coachUnlockLine(
          memRef.current.activeId,
          unique[0]!,
          upcoming,
          memRef.current.partnerName,
        );
        window.setTimeout(() => speakCoach(line, "coach next drill"), 700);
      }
    }
  }

  function wake(id?: BakuganId) {
    const next = id ? { ...mem, activeId: id } : mem;
    setMem(next);
    setAwake(true);
    setEmotion("happy");
    playEmotionSound("happy");
    pushNeural("sense", "wake");
    pushNeural("feel", "[happy]");
    pushNeural("body", "hop");
    bumpActivity();
    idleHintedRef.current = false;
    const p = BAKUGANS[next.activeId];
    const upcoming = nextDrill(trainingRef.current);
    const intro = next.partnerName
      ? next.activeId === "preyas"
        ? `${next.partnerName}-han! Preyas here — peek my neurons while we bounce.`
        : `${next.partnerName}. ${p.name} here — talk to me.`
      : next.activeId === "preyas"
        ? `Hey hey! I'm Preyas. Watch the core light up — then tell me your name.`
        : `I'm ${p.name}. Your Bakugan. What should I call you?`;
    const hint =
      upcoming && next.partnerName
        ? ` ${coachNextLine(next.activeId, upcoming, next.partnerName).text}`
        : "";
    const body = `${intro}${hint}`;
    setWillSay(body);
    setMessages([
      {
        id: uid(),
        role: "bakugan",
        bakuganId: next.activeId,
        text: body,
        emotion: "happy",
        at: Date.now(),
      },
    ]);
    if (voiceOnRef.current) {
      queueRef.current?.enqueue(body, p, true, "happy");
      patchTrain({ kind: "voice" });
    }
    void pingStudio().then((h) => {
      setStudio(h);
      if (!h?.llm?.ready) {
        setToast("Core's offline — bounce anyway. Studio: npm start on :8787.");
        window.setTimeout(() => setToast(null), 3600);
      }
    });
    setTimeout(() => inputRef.current?.focus(), 350);
  }

  async function toggleMic() {
    if (micOn) {
      micRef.current?.stop();
      micRef.current = null;
      setMicOn(false);
      setListening(false);
      setPartial("");
      return;
    }
    const health = (await pingStudio()) ?? studio;
    setStudio(health);
    if (!health?.stt?.ready) {
      setMessages((m) => [
        ...m,
        {
          id: uid(),
          role: "bakugan",
          bakuganId: mem.activeId,
          text: "Ears need the studio sidecar (sherpa-onnx). Type for now — I'll still hop.",
          emotion: "neutral",
          at: Date.now(),
        },
      ]);
      return;
    }
    bargeIn();
    patchTrain({ kind: "mic" });
    const listener = createListener({
      onListeningChange: (on) => {
        setListening(on);
        if (on) {
          setEmotion("listening");
          pushNeural("sense", "ear open");
        }
      },
      onPartial: (t) => {
        setPartial(t);
        setEmotion("listening");
      },
      onReact: () => {
        setEmotion("listening");
        pushNeural("sense", "hearing…");
      },
      onFinal: (t) => {
        setPartial("");
        void runTurn(t);
      },
    });
    micRef.current = listener;
    listener.start();
    setMicOn(true);
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    bargeIn();
    void runTurn(draft);
  }

  function setForm(next: Form) {
    setMem((m) => ({
      ...m,
      forms: { ...m.forms, [m.activeId]: next },
    }));
    setEmotion(next === "battle" ? "excited" : "neutral");
    if (next === "battle") {
      playEmotionSound("excited");
      pushNeural("body", "pop-open");
    } else {
      pushNeural("body", "seal");
    }
  }

  function selectPartner(id: BakuganId) {
    if (!awake) {
      wake(id);
      return;
    }
    void runTurn(`switch to ${BAKUGANS[id].name}`);
  }

  const others = BAKUGAN_LIST.filter((b) => b.id !== mem.activeId)
    .map((b) => b.name)
    .join(" / ");

  return (
    <div className={`app attr-${profile.attribute} form-${form} ${awake ? "awake" : "asleep"}`}>
      <div className="atmosphere" aria-hidden="true" />
      <div className="embers" aria-hidden="true" />

      {!awake ? (
        <header className="hero">
          <p className="eyebrow">Live Bakugan · train the mind</p>
          <h1 className="brand">{profile.name.toUpperCase()}</h1>
          <p className="tagline">
            Watch the neurons. Train him step by step. Someday — a real body.
          </p>
          <BakuganBall
            profile={profile}
            emotion={emotion === "neutral" ? "happy" : emotion}
            form={form}
            listening={false}
            speaking={false}
          />
          <div className="roster">
            {BAKUGAN_LIST.map((b) => (
              <button
                key={b.id}
                type="button"
                className={`roster-pill ${b.id === mem.activeId ? "active" : ""}`}
                onClick={() => {
                  setMem((m) => ({ ...m, activeId: b.id }));
                  setEmotion("happy");
                }}
              >
                {b.name}
                <span>{b.attribute}</span>
              </button>
            ))}
          </div>
          <button type="button" className="cta" onClick={() => wake()}>
            Wake {profile.name}
          </button>
          <p className="hint">Ball on the outside. Nervous system on the inside.</p>
        </header>
      ) : (
        <div className="lab">
          <main className="stage">
            <header className="top">
              <div>
                <h1 className="brand-sm">{profile.name.toUpperCase()}</h1>
                <p className="meta">
                  Bond {mem.bonds[mem.activeId]}
                  {mem.partnerName ? ` · ${mem.partnerName}` : ""} · {form} · {emotion} · XP{" "}
                  {training.xp}
                  {studio?.llm?.ready ? " · llama" : " · local"}
                  {studio?.tts?.ready ? ` · ${studio.tts.engine}` : ""}
                </p>
              </div>
              <div className="controls">
                <button
                  type="button"
                  className="ghost"
                  onClick={() => setForm(form === "battle" ? "sphere" : "battle")}
                >
                  {form === "battle" ? "Seal" : "Pop open"}
                </button>
                <button
                  type="button"
                  className={`ghost ${voiceOn ? "on" : ""}`}
                  onClick={() => {
                    setVoiceOn((v) => !v);
                    queueRef.current?.cancel();
                  }}
                  aria-pressed={voiceOn}
                >
                  Voice
                </button>
                <button
                  type="button"
                  className={`ghost ${micOn ? "on" : ""}`}
                  onClick={toggleMic}
                  aria-pressed={micOn}
                >
                  Mic
                </button>
              </div>
            </header>

            <div className="roster slim">
              {BAKUGAN_LIST.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  className={`roster-pill ${b.id === mem.activeId ? "active" : ""}`}
                  onClick={() => selectPartner(b.id)}
                >
                  {b.name}
                </button>
              ))}
            </div>

            <BakuganBall
              profile={profile}
              emotion={emotion}
              form={form}
              listening={listening}
              speaking={speaking}
              talkVolume={talkVolume}
              compact
            />

            <div className="neural-wrap">
              <NeuralCore
                emotion={emotion}
                listening={listening}
                speaking={speaking}
                thinking={busy}
                pulses={pulses}
              />
            </div>

            <div className="chat" ref={listRef}>
              {messages.map((m) => (
                <div key={m.id} className={`bubble ${m.role}`}>
                  <span className="who">
                    {m.role === "bakugan"
                      ? BAKUGANS[m.bakuganId ?? mem.activeId].name
                      : "You"}
                  </span>
                  <p>{m.text}</p>
                </div>
              ))}
              {busy && streamText && (
                <div className="bubble bakugan streaming">
                  <span className="who">{profile.name}</span>
                  <p>{streamText}</p>
                </div>
              )}
              {busy && !streamText && (
                <div className="bubble bakugan typing">
                  <span className="who">{profile.name}</span>
                  <p>
                    <span className="dot" />
                    <span className="dot" />
                    <span className="dot" />
                  </p>
                </div>
              )}
              {partial && (
                <div className="bubble you partial">
                  <span className="who">You · listening</span>
                  <p>{partial}</p>
                </div>
              )}
            </div>

            <form className="composer" onSubmit={onSubmit}>
              <input
                ref={inputRef}
                value={draft}
                onChange={(e) => {
                  bargeIn();
                  bumpActivity();
                  setDraft(e.target.value);
                }}
                placeholder={`Talk / train ${profile.name}… (${others}, or “real body”)`}
                aria-label={`Message ${profile.name}`}
                autoComplete="off"
              />
              <button type="submit" disabled={!draft.trim() || busy}>
                Send
              </button>
            </form>
          </main>

          <TrainingPanel
            training={training}
            willSay={willSay}
            trace={trace}
            bond={mem.bonds[mem.activeId]}
            facts={mem.facts}
            onPickDrill={pickDrill}
          />
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
