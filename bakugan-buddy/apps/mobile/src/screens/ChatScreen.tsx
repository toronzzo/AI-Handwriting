import { useEffect, useRef, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  chooseRoute,
  deepseekIsPeak,
  estimatePaidCost,
  modelId,
  paidButton,
  resolveChatBase,
  splitPaidHint,
  streamReply,
  toModelMessages,
  type ChatMessage,
} from "../../../../packages/alive/src/chatTurn.ts";
import type { MicPhase } from "../../../../packages/alive/src/speech.ts";
import { readBrainHost } from "../room/brain/brainLink";
import { resetSpeech } from "../../../../packages/alive/src/speech.ts";
import { interruptTalk, queueSpokenLine, VoiceSession, type TalkSinks } from "../room/voice/VoiceSession";

type PaidInfo = { available: boolean; offPeakOnly: boolean; reason: string };

function blankSinks(): TalkSinks {
  return {
    brainUrl: "",
    heard: "",
    hearLang: "en",
    adviseAt: 0,
    talkGen: 0,
    talkEnv: [],
    talkStart: 0,
    talkUntil: 0,
    spokenCount: 0,
    stopTalk: null,
    playing: false,
    thinking: false,
    phase: "listening",
  };
}

export function ChatScreen() {
  const sinks = useRef<TalkSinks>(blankSinks());
  const bag = sinks.current;
  const messagesRef = useRef<ChatMessage[]>([]);
  const summaryRef = useRef("");
  const busy = useRef(false);
  const sendRef = useRef<(text: string, askPaid: boolean) => Promise<void>>(async () => {});
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [phase, setPhase] = useState<MicPhase>("listening");
  const [paid, setPaid] = useState<PaidInfo>({ available: false, offPeakOnly: false, reason: "Checking the Mac…" });
  const [via, setVia] = useState<"gateway" | "proxy">("proxy");
  const [escalate, setEscalate] = useState(false);
  const [hintPaid, setHintPaid] = useState(false);
  const [note, setNote] = useState("");
  const [live, setLive] = useState<{ who: "preyas" | "paid"; text: string } | null>(null);

  useEffect(() => {
    let cancel = false;
    void (async () => {
      const saved = await readBrainHost();
      const brain = saved || "http://127.0.0.1:8788";
      bag.brainUrl = brain.replace(/\/$/, "");
      const endpoint = await resolveChatBase(bag.brainUrl);
      if (cancel) return;
      setVia(endpoint.via);
      try {
        const res = await fetch(`${bag.brainUrl}/v1/history`);
        if (res.ok) {
          const body = (await res.json()) as { summary?: string; messages?: { role?: string; content?: string; who?: string; model?: string; costUsd?: number | null }[] };
          summaryRef.current = body.summary || "";
          const restored: ChatMessage[] = (body.messages || []).map((row) => ({
            role: row.role === "assistant" || row.role === "system" ? row.role : "user",
            content: row.content || "",
            who: row.who === "paid" || row.who === "preyas" || row.who === "user" ? row.who : undefined,
            model: row.model || undefined,
            costUsd: row.costUsd,
          }));
          messagesRef.current = restored;
          setMessages(restored);
        }
      } catch {
        /* the thread still works for this session */
      }
      try {
        const res = await fetch(`${bag.brainUrl}/v1/paid`);
        if (res.ok) {
          const body = (await res.json()) as PaidInfo;
          if (!cancel) setPaid(body);
        }
      } catch {
        if (!cancel) setPaid({ available: false, offPeakOnly: false, reason: "Brain is offline" });
      }
    })();
    const timer = setInterval(() => {
      setPhase(bag.phase || "listening");
      if (!bag.heard || busy.current) return;
      const text = bag.heard;
      bag.heard = "";
      void sendRef.current(text, false);
    }, 120);
    return () => {
      cancel = true;
      clearInterval(timer);
    };
  }, [bag]);

  async function remember(entry: ChatMessage) {
    if (!bag.brainUrl) return;
    try {
      await fetch(`${bag.brainUrl}/v1/history`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(entry),
      });
    } catch {
      /* the line is still on screen */
    }
  }

  async function speakPreyas(text: string, final: boolean, fresh = false) {
    if (fresh) resetSpeech(bag);
    queueSpokenLine(bag, text, "happy", final);
  }

  async function ask(route: "local" | "paid", prior: ChatMessage[], userText: string) {
    const endpoint = await resolveChatBase(bag.brainUrl);
    setVia(endpoint.via);
    const model = modelId(route, endpoint.via);
    const base = route === "paid" && endpoint.via === "proxy" ? bag.brainUrl : endpoint.base;
    let last = "";
    let spoke = false;
    const result = await streamReply({
      base,
      model,
      messages: toModelMessages(prior, summaryRef.current, userText),
      timeoutMs: route === "paid" ? 45_000 : 20_000,
      onDelta: (text) => {
        const shown = splitPaidHint(text).text;
        last = shown;
        setLive({ who: route === "paid" ? "paid" : "preyas", text: shown });
        if (route === "local" && shown) {
          void speakPreyas(shown, false, !spoke);
          spoke = true;
        }
      },
    });
    setLive(null);
    const parsed = splitPaidHint(result.text || last);
    if (route === "local" && parsed.text) void speakPreyas(parsed.text, true, !spoke);
    return { ...result, text: parsed.text, suggestPaid: parsed.suggestPaid, model, endpoint };
  }

  async function send(text: string, askPaid: boolean) {
    const trimmed = text.trim();
    if (!trimmed || busy.current || !bag.brainUrl) return;
    busy.current = true;
    bag.thinking = true;
    const userMsg: ChatMessage = { role: "user", content: trimmed, who: "user" };
    const existing = messagesRef.current;
    const duplicate = askPaid && existing[existing.length - 1]?.who === "user" && existing[existing.length - 1]?.content === trimmed;
    const history = duplicate ? existing.slice(0, -1) : existing;
    if (!duplicate) {
      messagesRef.current = [...existing, userMsg];
      setMessages(messagesRef.current);
      void remember(userMsg);
    }
    setNote("");
    try {
      let route = chooseRoute({
        askPaid,
        localFailed: false,
        paidAvailable: paid.available && paidButton({ available: paid.available, offPeakOnly: paid.offPeakOnly, now: new Date(), downReason: paid.reason }).enabled,
        allowPaidOnFailure: escalate,
      });
      if (askPaid && !route.reason.startsWith("you")) {
        setNote(paidButton({ available: paid.available, offPeakOnly: paid.offPeakOnly, now: new Date(), downReason: paid.reason }).reason);
      }
      if (!askPaid) {
        const local = await ask("local", history, trimmed);
        const cleaned = splitPaidHint(local.text);
        if (cleaned.suggestPaid) setHintPaid(true);
        if (local.ok) {
          const reply: ChatMessage = { role: "assistant", content: cleaned.text, who: "preyas", model: "preyas" };
          messagesRef.current = [...messagesRef.current, reply];
          setMessages(messagesRef.current);
          void speakPreyas(cleaned.text, true);
          void remember(reply);
          return;
        }
        route = chooseRoute({
          askPaid: false,
          localFailed: true,
          paidAvailable: paid.available && paidButton({ available: paid.available, offPeakOnly: paid.offPeakOnly, now: new Date(), downReason: paid.reason }).enabled,
          allowPaidOnFailure: escalate,
        });
        if (route.route === "local") {
          setNote("Preyas didn't answer. You can ask a paid model if it's on.");
          return;
        }
      }
      if (route.route !== "paid") return;
      const paidReply = await ask("paid", history, trimmed);
      if (!paidReply.ok) {
        setNote(paidReply.error || "The paid model didn't answer.");
        return;
      }
      const cost = estimatePaidCost(paidReply.usage, deepseekIsPeak(new Date()));
      const paidMsg: ChatMessage = {
        role: "assistant",
        content: paidReply.text,
        who: "paid",
        model: "deepseek-flash",
        costUsd: cost,
      };
      messagesRef.current = [...messagesRef.current, paidMsg];
      setMessages(messagesRef.current);
      void remember(paidMsg);
      const reaction = await ask(
        "local",
        messagesRef.current,
        "In one or two sentences, react to what the paid model just said. Stay in your voice.",
      );
      if (reaction.ok) {
        const line = splitPaidHint(reaction.text).text;
        const reply: ChatMessage = { role: "assistant", content: line, who: "preyas", model: "preyas" };
        messagesRef.current = [...messagesRef.current, reply];
        setMessages(messagesRef.current);
        void speakPreyas(line, true);
        void remember(reply);
      }
    } finally {
      bag.thinking = false;
      busy.current = false;
    }
  }
  sendRef.current = send;

  const button = paidButton({
    available: paid.available,
    offPeakOnly: paid.offPeakOnly,
    now: new Date(),
    downReason: paid.reason,
  });
  const lastUser = [...messages].reverse().find((message) => message.who === "user");

  return (
    <View style={styles.root}>
      <VoiceSession sinks={bag} />
      <View style={styles.hero}>
        <View style={[styles.ball, phase === "speaking" && styles.ballTalk, phase === "thinking" && styles.ballThink]} />
        <View>
          <Text style={styles.name}>PREYAS</Text>
          <Text style={styles.phase}>{phase}</Text>
        </View>
      </View>
      <ScrollView style={styles.log} contentContainerStyle={styles.logInner}>
        {summaryRef.current ? <Text style={styles.memory}>Memory is on the Agent drive.</Text> : null}
        {messages.map((message, index) => (
          <View key={`${index}-${message.who}-${message.content.slice(0, 12)}`} style={styles.line}>
            <Text style={styles.who}>
              {message.who === "paid" ? `deepseek-flash` : message.who === "preyas" ? "Preyas" : "You"}
              {message.who === "paid" && message.costUsd != null ? ` · ~$${message.costUsd.toFixed(4)}` : ""}
            </Text>
            <Text style={styles.body}>{message.content}</Text>
          </View>
        ))}
        {live ? (
          <View style={styles.line}>
            <Text style={styles.who}>{live.who === "paid" ? "deepseek-flash" : "Preyas"}</Text>
            <Text style={styles.body}>{live.text}</Text>
          </View>
        ) : null}
        {note ? <Text style={styles.note}>{note}</Text> : null}
      </ScrollView>
      <View style={styles.tools}>
        <Pressable
          style={[styles.paid, (!button.enabled || !lastUser) && styles.paidOff, hintPaid && button.enabled && styles.paidHint]}
          disabled={!button.enabled || !lastUser}
          onPress={() => {
            if (lastUser) void send(lastUser.content, true);
          }}
        >
          <Text style={styles.paidText}>{button.enabled ? "Ask a paid model" : button.reason}</Text>
        </Pressable>
        <View style={styles.switchRow}>
          <Text style={styles.switchLabel}>If Preyas times out, ask DeepSeek</Text>
          <Switch value={escalate} onValueChange={setEscalate} />
        </View>
        <Text style={styles.via}>{via === "gateway" ? "Using the gateway" : "Using the local brain"}</Text>
      </View>
      <View style={styles.composer}>
        <Pressable
          style={styles.mic}
          onPress={() => {
            if (bag.playing) interruptTalk(bag);
          }}
        >
          <Text style={styles.micText}>{phase}</Text>
        </Pressable>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="Say something"
          placeholderTextColor="#7d8792"
          style={styles.input}
          onSubmitEditing={() => {
            const text = draft;
            setDraft("");
            void send(text, false);
          }}
        />
        <Pressable
          style={styles.send}
          onPress={() => {
            const text = draft;
            setDraft("");
            void send(text, false);
          }}
        >
          <Text style={styles.sendText}>Send</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#070b10" },
  hero: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingTop: 8 },
  ball: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: "#2f6f86",
    borderWidth: 2,
    borderColor: "#d5e7ef",
  },
  ballTalk: { backgroundColor: "#3f93b0", transform: [{ scale: 1.08 }] },
  ballThink: { backgroundColor: "#245066" },
  name: { color: "#f2f6f8", fontWeight: "800", letterSpacing: 1.5 },
  phase: { color: "#9fd0e0", fontSize: 13, marginTop: 2, textTransform: "capitalize" },
  log: { flex: 1, marginTop: 8 },
  logInner: { paddingHorizontal: 16, paddingBottom: 12, gap: 10 },
  memory: { color: "#6e7c86", fontSize: 12 },
  line: { gap: 2 },
  who: { color: "#8ec8d8", fontSize: 12, fontWeight: "700" },
  body: { color: "#e7eef2", fontSize: 16, lineHeight: 22 },
  note: { color: "#e2c27a", fontSize: 13 },
  tools: { paddingHorizontal: 16, paddingBottom: 6, gap: 6 },
  paid: { borderWidth: 1, borderColor: "#e2c27a", paddingVertical: 8, paddingHorizontal: 10 },
  paidOff: { borderColor: "#3a4248", opacity: 0.7 },
  paidHint: { backgroundColor: "rgba(226,194,122,0.15)" },
  paidText: { color: "#f0e2bc", fontSize: 13 },
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  switchLabel: { color: "#9aa6ae", fontSize: 12, flex: 1, paddingRight: 8 },
  via: { color: "#66727a", fontSize: 11 },
  composer: { flexDirection: "row", gap: 8, padding: 12, alignItems: "center" },
  mic: { borderWidth: 1, borderColor: "#9fd0e0", paddingVertical: 8, paddingHorizontal: 8, minWidth: 78 },
  micText: { color: "#d5eef5", fontSize: 12, textAlign: "center", textTransform: "capitalize" },
  input: { flex: 1, color: "#f4f7f8", borderWidth: 1, borderColor: "#2c3840", paddingHorizontal: 10, paddingVertical: 8 },
  send: { backgroundColor: "#1d4e63", paddingVertical: 10, paddingHorizontal: 12 },
  sendText: { color: "#f4f7f8", fontWeight: "700" },
});
