import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  loadBond,
  replyAsPyrax,
  saveBond,
  wakeLine,
} from "./pyrax";
import type { Bond, ChatMessage, Form } from "./pyrax";
import "./App.css";

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function speak(text: string) {
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text.replace(/\*[^*]+\*/g, "").trim());
  u.rate = 1.02;
  u.pitch = 0.92;
  window.speechSynthesis.speak(u);
}

export default function App() {
  const [awake, setAwake] = useState(false);
  const [bond, setBond] = useState<Bond>(() => loadBond());
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [typing, setTyping] = useState(false);
  const [voiceOn, setVoiceOn] = useState(true);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    saveBond(bond);
  }, [bond]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, typing]);

  function wake() {
    setAwake(true);
    const hello: ChatMessage = {
      id: uid(),
      role: "pyrax",
      text: bond.partnerName
        ? `${bond.partnerName}. Felt you. Core's lit — talk to me.`
        : "I'm Pyrax. Your Bakugan. What should I call you, partner?",
      at: Date.now(),
    };
    setMessages([hello]);
    if (voiceOn) speak(hello.text);
    setTimeout(() => inputRef.current?.focus(), 400);
  }

  function setForm(form: Form) {
    setBond((b) => ({ ...b, form }));
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || typing) return;
    setDraft("");
    const yours: ChatMessage = { id: uid(), role: "you", text, at: Date.now() };
    setMessages((m) => [...m, yours]);
    setTyping(true);

    const delay = 480 + Math.min(900, text.length * 12);
    window.setTimeout(() => {
      const { text: reply, bond: next } = replyAsPyrax(text, bond);
      setBond(next);
      const msg: ChatMessage = { id: uid(), role: "pyrax", text: reply, at: Date.now() };
      setMessages((m) => [...m, msg]);
      setTyping(false);
      if (voiceOn) speak(reply);
    }, delay);
  }

  return (
    <div className={`app form-${bond.form} ${awake ? "awake" : "asleep"}`}>
      <div className="atmosphere" aria-hidden="true" />
      <div className="embers" aria-hidden="true" />

      {!awake ? (
        <header className="hero">
          <p className="eyebrow">Personal Bakugan</p>
          <h1 className="brand">PYRAX</h1>
          <p className="tagline">Pyrus core. Your partner. Ready to talk.</p>
          <SphereVisual form={bond.form} pulse />
          <button type="button" className="cta" onClick={wake}>
            Wake Pyrax
          </button>
          <p className="hint">{wakeLine}</p>
        </header>
      ) : (
        <main className="stage">
          <header className="top">
            <div>
              <h1 className="brand-sm">PYRAX</h1>
              <p className="meta">
                Bond {bond.bond}
                {bond.partnerName ? ` · ${bond.partnerName}` : ""} · {bond.form}
              </p>
            </div>
            <div className="controls">
              <button
                type="button"
                className="ghost"
                onClick={() => setForm(bond.form === "battle" ? "sphere" : "battle")}
              >
                {bond.form === "battle" ? "Sphere" : "Open"}
              </button>
              <button
                type="button"
                className={`ghost ${voiceOn ? "on" : ""}`}
                onClick={() => {
                  setVoiceOn((v) => !v);
                  window.speechSynthesis?.cancel();
                }}
                aria-pressed={voiceOn}
              >
                Voice {voiceOn ? "on" : "off"}
              </button>
            </div>
          </header>

          <SphereVisual form={bond.form} compact />

          <div className="chat" ref={listRef}>
            {messages.map((m) => (
              <div key={m.id} className={`bubble ${m.role}`}>
                <span className="who">{m.role === "pyrax" ? "Pyrax" : "You"}</span>
                <p>{m.text}</p>
              </div>
            ))}
            {typing && (
              <div className="bubble pyrax typing">
                <span className="who">Pyrax</span>
                <p>
                  <span className="dot" />
                  <span className="dot" />
                  <span className="dot" />
                </p>
              </div>
            )}
          </div>

          <form className="composer" onSubmit={onSubmit}>
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Talk to Pyrax…"
              aria-label="Message Pyrax"
              autoComplete="off"
            />
            <button type="submit" disabled={!draft.trim() || typing}>
              Send
            </button>
          </form>
        </main>
      )}
    </div>
  );
}

function SphereVisual({
  form,
  pulse,
  compact,
}: {
  form: Form;
  pulse?: boolean;
  compact?: boolean;
}) {
  return (
    <div
      className={`sphere-wrap ${form} ${pulse ? "pulse" : ""} ${compact ? "compact" : ""}`}
      aria-hidden="true"
    >
      <div className="sphere">
        <div className="core" />
        <div className="ring r1" />
        <div className="ring r2" />
        <div className="shard s1" />
        <div className="shard s2" />
        <div className="shard s3" />
      </div>
      {form === "battle" && (
        <div className="battle-silhouette">
          <div className="wing left" />
          <div className="wing right" />
          <div className="body" />
          <div className="horn" />
        </div>
      )}
    </div>
  );
}
