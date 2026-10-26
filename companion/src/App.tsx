import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { BAKUGANS, BAKUGAN_LIST, type BakuganId, type Emotion } from "./bakugans";
import { streamReply } from "./brain";
import { loadMemory, saveMemory, type PartnerMemory } from "./memory";
import type { ChatMessage, Form } from "./types";
import { FaceCanvas } from "./face/FaceCanvas";
import { playEmotionSound } from "./audio/emotionSounds";
import { createListener, speechRecognitionAvailable } from "./audio/listen";
import { warmVoices } from "./audio/speech";
import { SpeechQueue } from "./audio/speechQueue";
import "./App.css";

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function App() {
  const [awake, setAwake] = useState(false);
  const [mem, setMem] = useState<PartnerMemory>(() => loadMemory());
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [partial, setPartial] = useState("");
  const [busy, setBusy] = useState(false);
  const [voiceOn, setVoiceOn] = useState(true);
  const [micOn, setMicOn] = useState(false);
  const [emotion, setEmotion] = useState<Emotion>("idle");
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [streamText, setStreamText] = useState("");

  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const memRef = useRef(mem);
  const voiceOnRef = useRef(voiceOn);
  const abortRef = useRef<AbortController | null>(null);
  const queueRef = useRef<SpeechQueue | null>(null);
  const micRef = useRef<ReturnType<typeof createListener> | null>(null);

  const profile = BAKUGANS[mem.activeId];
  const form = mem.forms[mem.activeId];

  useEffect(() => {
    memRef.current = mem;
    saveMemory(mem);
  }, [mem]);

  useEffect(() => {
    voiceOnRef.current = voiceOn;
  }, [voiceOn]);

  useEffect(() => {
    warmVoices();
    queueRef.current = new SpeechQueue(setSpeaking);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.attr = profile.attribute;
    document.documentElement.style.setProperty("--c-primary", profile.colors.primary);
    document.documentElement.style.setProperty("--c-secondary", profile.colors.secondary);
    document.documentElement.style.setProperty("--c-glow", profile.colors.glow);
    document.documentElement.style.setProperty("--c-deep", profile.colors.deep);
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

  function bargeIn() {
    queueRef.current?.cancel();
    abortRef.current?.abort();
  }

  async function runTurn(userText: string) {
    const text = userText.trim();
    if (!text || busy) return;

    bargeIn();
    const ac = new AbortController();
    abortRef.current = ac;

    setDraft("");
    setPartial("");
    setMessages((m) => [...m, { id: uid(), role: "you", text, at: Date.now() }]);
    setBusy(true);
    setEmotion("thinking");
    setStreamText("");

    const spoken: string[] = [];
    let activeId = memRef.current.activeId;

    try {
      for await (const ev of streamReply(text, memRef.current, { signal: ac.signal })) {
        if (ev.type === "emotion") {
          activeId = ev.memory.activeId;
          setEmotion(ev.emotion);
          setMem(ev.memory);
          playEmotionSound(ev.emotion);
          // Snap theme/face immediately on partner switch — don't wait for speech
          if (ev.switchedTo) {
            setStreamText("");
          }
        } else if (ev.type === "sentence") {
          spoken.push(ev.sentence);
          setStreamText(spoken.join(" "));
          queueRef.current?.enqueue(
            ev.sentence,
            BAKUGANS[activeId],
            voiceOnRef.current,
          );
        } else if (ev.type === "done") {
          setMem(ev.result.memory);
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
      setBusy(false);
    }
  }

  function wake(id?: BakuganId) {
    const next = id ? { ...mem, activeId: id } : mem;
    setMem(next);
    setAwake(true);
    setEmotion("happy");
    playEmotionSound("happy");
    const p = BAKUGANS[next.activeId];
    const body = next.partnerName
      ? `${next.partnerName}. ${p.name} here — talk to me.`
      : `I'm ${p.name}. Your Bakugan. What should I call you?`;
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
      queueRef.current?.enqueue(body, p, true);
    }
    setTimeout(() => inputRef.current?.focus(), 350);
  }

  function toggleMic() {
    if (micOn) {
      micRef.current?.stop();
      micRef.current = null;
      setMicOn(false);
      setListening(false);
      setPartial("");
      return;
    }
    if (!speechRecognitionAvailable()) {
      setMessages((m) => [
        ...m,
        {
          id: uid(),
          role: "bakugan",
          bakuganId: mem.activeId,
          text: "Mic listen needs Chrome or Edge. Typing still works — the face keeps moving either way.",
          emotion: "calm",
          at: Date.now(),
        },
      ]);
      return;
    }
    bargeIn();
    const listener = createListener({
      onListeningChange: (on) => {
        setListening(on);
        if (on) setEmotion("listening");
      },
      onPartial: (t) => {
        setPartial(t);
        setEmotion("listening");
      },
      onReact: () => setEmotion("listening"),
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
  }

  function selectPartner(id: BakuganId) {
    if (!awake) {
      wake(id);
      return;
    }
    void runTurn(`switch to ${BAKUGANS[id].name}`);
  }

  return (
    <div className={`app attr-${profile.attribute} form-${form} ${awake ? "awake" : "asleep"}`}>
      <div className="atmosphere" aria-hidden="true" />
      <div className="embers" aria-hidden="true" />

      {!awake ? (
        <header className="hero">
          <p className="eyebrow">Live Bakugan · web</p>
          <h1 className="brand">{profile.name.toUpperCase()}</h1>
          <p className="tagline">{profile.tagline}</p>
          <FaceCanvas
            profile={profile}
            emotion={emotion}
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
                onClick={() => setMem((m) => ({ ...m, activeId: b.id }))}
              >
                {b.name}
                <span>{b.attribute}</span>
              </button>
            ))}
          </div>
          <button type="button" className="cta" onClick={() => wake()}>
            Wake {profile.name}
          </button>
          <p className="hint">Face runs at 60fps on its own. Mood hits before speech.</p>
        </header>
      ) : (
        <main className="stage">
          <header className="top">
            <div>
              <h1 className="brand-sm">{profile.name.toUpperCase()}</h1>
              <p className="meta">
                Bond {mem.bonds[mem.activeId]}
                {mem.partnerName ? ` · ${mem.partnerName}` : ""} · {form} · {emotion}
              </p>
            </div>
            <div className="controls">
              <button
                type="button"
                className="ghost"
                onClick={() => setForm(form === "battle" ? "sphere" : "battle")}
              >
                {form === "battle" ? "Sphere" : "Open"}
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

          <FaceCanvas
            profile={profile}
            emotion={emotion}
            form={form}
            listening={listening}
            speaking={speaking}
            compact
          />

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
                setDraft(e.target.value);
              }}
              placeholder={`Talk to ${profile.name}… (or say ${BAKUGAN_LIST.filter((b) => b.id !== mem.activeId)
                .map((b) => b.name)
                .join(" / ")})`}
              aria-label={`Message ${profile.name}`}
              autoComplete="off"
            />
            <button type="submit" disabled={!draft.trim() || busy}>
              Send
            </button>
          </form>
        </main>
      )}
    </div>
  );
}
