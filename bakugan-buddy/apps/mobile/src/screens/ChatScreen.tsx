import { useEffect, useRef, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import {
  chooseRoute,
  deepseekIsPeak,
  estimatePaidCost,
  modelId,
  paidButton,
  partnerFromTurns,
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
import { PreyasHero } from "./PreyasHero";

type Shown = ChatMessage & { t: number; thinking?: string };
type PartnerCard = { turns: number; level: number; bond: number; caption: string };
type Pane = "companion" | "activity" | "collection";

const QUICK: { label: string; prompt: string }[] = [
  { label: "Battle Ready!", prompt: "I'm ready. What's our strategy?" },
  { label: "Power Up", prompt: "Show me a power up. Keep it short." },
  { label: "Fun Fact", prompt: "Tell me a fun fact about yourself." },
  { label: "Just Chat", prompt: "Let's just talk. What's on your mind?" },
];

function clock(t: number): string {
  try {
    return new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  } catch {
    return "";
  }
}

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

export function ChatScreen({ onNavigate }: { onNavigate?: (tab: "room" | "body" | "bench") => void }) {
  const sinks = useRef<TalkSinks>(blankSinks());
  const bag = sinks.current;
  const messagesRef = useRef<Shown[]>([]);
  const summaryRef = useRef("");
  const busy = useRef(false);
  const sendRef = useRef<(text: string, askPaid: boolean) => Promise<void>>(async () => {});
  const [messages, setMessages] = useState<Shown[]>([]);
  const [draft, setDraft] = useState("");
  const [phase, setPhase] = useState<MicPhase>("listening");
  const [paid, setPaid] = useState<PaidInfo>({ available: false, offPeakOnly: false, reason: "Paid model off" });
  const [via, setVia] = useState<"gateway" | "proxy">("proxy");
  const [escalate, setEscalate] = useState(false);
  const [hintPaid, setHintPaid] = useState(false);
  const [note, setNote] = useState("");
  const [live, setLive] = useState<{ who: "preyas" | "paid"; text: string } | null>(null);
  const [openThink, setOpenThink] = useState<Record<number, boolean>>({});
  const [online, setOnline] = useState(false);
  const [partner, setPartner] = useState<PartnerCard>(partnerFromTurns(0));
  const [pane, setPane] = useState<Pane>("companion");
  const [menu, setMenu] = useState(false);
  const [profile, setProfile] = useState(false);
  const { width } = useWindowDimensions();
  const wide = width >= 900;

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
          const body = (await res.json()) as {
            summary?: string;
            partner?: PartnerCard;
            messages?: { t?: number; role?: string; content?: string; who?: string; model?: string; costUsd?: number | null; thinking?: string }[];
          };
          summaryRef.current = body.summary || "";
          if (body.partner) setPartner(body.partner);
          const restored: Shown[] = (body.messages || []).map((row) => ({
            t: typeof row.t === "number" ? row.t : Date.now(),
            role: row.role === "assistant" || row.role === "system" ? row.role : "user",
            content: row.content || "",
            who: row.who === "paid" || row.who === "preyas" || row.who === "user" ? row.who : undefined,
            model: row.model || undefined,
            costUsd: row.costUsd,
            thinking: typeof row.thinking === "string" ? row.thinking : undefined,
          }));
          messagesRef.current = restored;
          setMessages(restored);
          if (!body.partner) {
            setPartner(partnerFromTurns(restored.filter((row) => row.who === "user" || row.role === "user").length));
          }
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

  useEffect(() => {
    let cancel = false;
    const ping = async () => {
      if (!bag.brainUrl) return;
      try {
        const res = await fetch(`${bag.brainUrl}/v1/health`);
        const body = (await res.json()) as { ok?: boolean; service?: string };
        if (!cancel) setOnline(Boolean(res.ok && (body.ok || body.service === "bakugan-brain")));
      } catch {
        if (!cancel) setOnline(false);
      }
    };
    void ping();
    const id = setInterval(() => void ping(), 8000);
    return () => {
      cancel = true;
      clearInterval(id);
    };
  }, [bag, via]);

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
    let lastThink = "";
    let spoke = false;
    const result = await streamReply({
      base,
      model,
      messages: toModelMessages(prior, summaryRef.current, userText),
      timeoutMs: route === "paid" ? 45_000 : 20_000,
      onDelta: (update) => {
        const shown = splitPaidHint(update.answer).text;
        last = shown;
        lastThink = update.thinking;
        setLive(shown ? { who: route === "paid" ? "paid" : "preyas", text: shown } : null);
        if (route === "local" && shown) {
          void speakPreyas(shown, false, !spoke);
          spoke = true;
        }
      },
    });
    setLive(null);
    const parsed = splitPaidHint(result.text || last);
    if (route === "local" && parsed.text) void speakPreyas(parsed.text, true, !spoke);
    return {
      ...result,
      text: parsed.text,
      thinking: result.thinking || lastThink,
      suggestPaid: parsed.suggestPaid,
      model,
      endpoint,
    };
  }

  async function send(text: string, askPaid: boolean) {
    const trimmed = text.trim();
    if (!trimmed || busy.current || !bag.brainUrl) return;
    busy.current = true;
    bag.thinking = true;
    const userMsg: Shown = { t: Date.now(), role: "user", content: trimmed, who: "user" };
    const existing = messagesRef.current;
    const duplicate = askPaid && existing[existing.length - 1]?.who === "user" && existing[existing.length - 1]?.content === trimmed;
    const history = duplicate ? existing.slice(0, -1) : existing;
    if (!duplicate) {
      messagesRef.current = [...existing, userMsg];
      setMessages(messagesRef.current);
      setPartner(partnerFromTurns(messagesRef.current.filter((row) => row.who === "user").length));
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
          const reply: Shown = {
            t: Date.now(),
            role: "assistant",
            content: cleaned.text,
            who: "preyas",
            model: "preyas",
            thinking: local.thinking || undefined,
          };
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
      const paidMsg: Shown = {
        t: Date.now(),
        role: "assistant",
        content: paidReply.text,
        who: "paid",
        model: "deepseek-flash",
        costUsd: cost,
        thinking: paidReply.thinking || undefined,
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
        const reply: Shown = {
          t: Date.now(),
          role: "assistant",
          content: line,
          who: "preyas",
          model: "preyas",
          thinking: reaction.thinking || undefined,
        };
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
  const go = (tab: "room" | "body" | "bench") => {
    setMenu(false);
    onNavigate?.(tab);
  };

  return (
    <View style={styles.root}>
      <VoiceSession sinks={bag} />
      <View style={styles.nav}>
        <View style={styles.brandRow}>
          <View style={styles.mark} />
          <View>
            <Text style={styles.brandTop}>BAKUGAN</Text>
            <Text style={styles.brandSub}>COMPANION</Text>
          </View>
        </View>
        <View style={styles.navTabs}>
          <Pressable onPress={() => go("room")}><Text style={styles.navTab}>Home</Text></Pressable>
          <Pressable style={styles.navOn} onPress={() => setPane("companion")}><Text style={styles.navTabOn}>Companion</Text></Pressable>
          <Pressable onPress={() => setPane("activity")}><Text style={[styles.navTab, pane === "activity" && styles.navTabOn]}>Activity</Text></Pressable>
          <Pressable onPress={() => setPane("collection")}><Text style={[styles.navTab, pane === "collection" && styles.navTabOn]}>Collection</Text></Pressable>
        </View>
        <View style={styles.navRight}>
          <Pressable style={styles.partnerBtn} onPress={() => setMenu((open) => !open)}>
            <View style={styles.miniBall} />
            <Text style={styles.partnerName}>Preyas</Text>
            <Text style={styles.caret}>▾</Text>
          </Pressable>
          <Pressable onPress={() => setMenu((open) => !open)}><Text style={styles.more}>···</Text></Pressable>
          {menu ? (
            <View style={styles.menu}>
              <Pressable onPress={() => go("room")}><Text style={styles.menuItem}>Room</Text></Pressable>
              <Pressable onPress={() => go("body")}><Text style={styles.menuItem}>Body</Text></Pressable>
              <Pressable onPress={() => go("bench")}><Text style={styles.menuItem}>Benchmark</Text></Pressable>
            </View>
          ) : null}
        </View>
      </View>

      {pane === "activity" ? (
        <ScrollView style={styles.fill} contentContainerStyle={styles.pad}>
          <Text style={styles.kicker}>ACTIVITY</Text>
          {messages.length === 0 ? <Text style={styles.dim}>No turns yet. They show up here after you talk.</Text> : null}
          {messages.map((message, index) => (
            <Text key={`act-${message.t}-${index}`} style={styles.dim}>
              {clock(message.t)} · {message.who === "paid" ? "deepseek-flash" : message.who === "user" ? "You" : "Preyas"} · {message.content}
            </Text>
          ))}
        </ScrollView>
      ) : pane === "collection" ? (
        <View style={[styles.fill, styles.pad]}>
          <Text style={styles.kicker}>COLLECTION</Text>
          <Text style={styles.bigName}>Preyas</Text>
          <Text style={styles.tagline}>Ball form. Aquos. One partner, kept on your drive.</Text>
        </View>
      ) : (
        <View style={[styles.split, !wide && styles.stack]}>
          <View style={[styles.left, !wide && styles.leftShort]}>
            <PreyasHero talking={phase === "speaking"} short={!wide} />
            {wide ? (
              <>
            <Text style={styles.kicker}>YOUR PARTNER</Text>
            <Text style={styles.bigName}>PREYAS</Text>
            <Text style={styles.tagline}>Playful in the room. Loyal at heart.</Text>
            <View style={styles.pills}>
              <Text style={styles.pill}>Attribute: Aquos</Text>
              <Text style={styles.pill}>Type: Ball</Text>
              <Text style={styles.pill}>Level: {partner.level}</Text>
            </View>
            <View style={styles.bondCard}>
              <View style={styles.bondHead}>
                <Text style={styles.bondTitle}>Bond Level</Text>
                <Text style={styles.bondPct}>{partner.bond}%</Text>
              </View>
              <View style={styles.track}><View style={[styles.fillBar, { width: `${partner.bond}%` }]} /></View>
              <Text style={styles.caption}>{partner.caption}</Text>
            </View>
            <Pressable style={styles.profileBtn} onPress={() => setProfile(true)}>
              <Text style={styles.profileText}>View Profile  →</Text>
            </Pressable>
              </>
            ) : (
              <Text style={styles.tagline}>Preyas · Aquos · level {partner.level}</Text>
            )}
          </View>

          <View style={styles.chatCard}>
            <View style={styles.chatHead}>
              <View style={styles.miniBall} />
              <View style={styles.chatHeadText}>
                <Text style={styles.chatName}>Preyas  ◆</Text>
                <Text style={styles.subtitle}>Always by your side</Text>
              </View>
              <View style={styles.onlineRow}>
                <View style={[styles.dot, online ? styles.dotOn : styles.dotOff]} />
                <Text style={styles.online}>{online ? "Online" : "Offline"}</Text>
              </View>
            </View>
            <ScrollView style={styles.log} contentContainerStyle={styles.logInner}>
              {messages.map((message, index) => {
                const mine = message.who === "user";
                const read = mine && messages.slice(index + 1).some((row) => row.who !== "user");
                const label = message.who === "paid" ? "deepseek-flash" : message.who === "preyas" ? "Preyas" : "You";
                return (
                  <View key={`${message.t}-${index}`} style={[styles.bubbleWrap, mine ? styles.bubbleRight : styles.bubbleLeft]}>
                    {!mine ? <View style={styles.miniBall} /> : null}
                    <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleHis]}>
                      {!mine ? (
                        <Text style={styles.bubbleWho}>
                          {label}
                          {message.who === "paid" && message.costUsd != null ? ` · ~$${message.costUsd.toFixed(4)}` : ""}
                        </Text>
                      ) : null}
                      <Text style={styles.bubbleText}>{message.content}</Text>
                      {!mine && message.thinking ? (
                        <Pressable onPress={() => setOpenThink((current) => ({ ...current, [index]: !current[index] }))}>
                          <Text style={styles.thinkToggle}>{openThink[index] ? "Hide thinking" : "Show thinking"}</Text>
                        </Pressable>
                      ) : null}
                      {openThink[index] && message.thinking ? <Text style={styles.thinkBody}>{message.thinking}</Text> : null}
                      <Text style={styles.time}>{clock(message.t)}{mine ? (read ? "  ✓✓" : "  ✓") : ""}</Text>
                    </View>
                  </View>
                );
              })}
              {live ? (
                <View style={[styles.bubbleWrap, styles.bubbleLeft]}>
                  <View style={styles.miniBall} />
                  <View style={[styles.bubble, styles.bubbleHis]}>
                    <Text style={styles.bubbleWho}>{live.who === "paid" ? "deepseek-flash" : "Preyas"}</Text>
                    <Text style={styles.bubbleText}>{live.text}</Text>
                  </View>
                </View>
              ) : null}
              {phase === "thinking" && !live ? (
                <Text style={styles.typing}>Preyas is thinking…</Text>
              ) : null}
              {note ? <Text style={styles.note}>{note}</Text> : null}
            </ScrollView>
            <View style={styles.composer}>
              <TextInput
                value={draft}
                onChangeText={setDraft}
                placeholder="Message Preyas..."
                placeholderTextColor="#6d7c88"
                style={styles.input}
                onSubmitEditing={() => {
                  const text = draft;
                  setDraft("");
                  void send(text, false);
                }}
              />
              <Pressable onPress={() => setDraft((value) => `${value}💧 `)}><Text style={styles.emoji}>☺</Text></Pressable>
              <Pressable
                style={styles.mic}
                onPress={() => {
                  if (bag.playing) interruptTalk(bag);
                }}
              >
                <Text style={styles.micText}>{phase}</Text>
              </Pressable>
              <Pressable
                style={styles.send}
                onPress={() => {
                  const text = draft;
                  setDraft("");
                  void send(text, false);
                }}
              >
                <Text style={styles.sendText}>➤</Text>
              </Pressable>
            </View>
            <View style={styles.chips}>
              {QUICK.map((chip) => (
                <Pressable key={chip.label} style={styles.chip} onPress={() => void send(chip.prompt, false)}>
                  <Text style={styles.chipText}>{chip.label}</Text>
                </Pressable>
              ))}
              <Pressable
                style={[styles.chip, (!button.enabled || !lastUser) && styles.chipOff, hintPaid && button.enabled && styles.chipHint]}
                disabled={!button.enabled || !lastUser}
                onPress={() => {
                  if (lastUser) void send(lastUser.content, true);
                }}
              >
                <Text style={styles.chipText}>{button.enabled ? "Ask a paid model" : button.reason}</Text>
              </Pressable>
            </View>
            <View style={styles.footerRow}>
              <Text style={styles.footer}>Preyas is a great listener.</Text>
              <View style={styles.switchRow}>
                <Text style={styles.switchLabel}>Timeout → DeepSeek</Text>
                <Switch value={escalate} onValueChange={setEscalate} />
              </View>
            </View>
          </View>
        </View>
      )}

      {profile ? (
        <View style={styles.sheet}>
          <Text style={styles.bigName}>PREYAS</Text>
          <Text style={styles.tagline}>Aquos · ball form · level {partner.level} · bond {partner.bond}%</Text>
          <Text style={styles.caption}>{partner.caption}</Text>
          <Text style={styles.dim}>{via === "gateway" ? "Talking through the gateway." : "Talking to the local brain."}</Text>
          <Pressable onPress={() => setProfile(false)}><Text style={styles.profileText}>Close</Text></Pressable>
        </View>
      ) : null}
    </View>
  );
}

const aqua = "#7ed4ea";
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#070b12" },
  nav: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(126,212,234,0.18)",
    gap: 12,
  },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  mark: { width: 16, height: 16, borderWidth: 1.5, borderColor: aqua, transform: [{ rotate: "45deg" }] },
  brandTop: { color: "#e8f7fb", fontSize: 11, fontWeight: "800", letterSpacing: 1.4 },
  brandSub: { color: aqua, fontSize: 10, letterSpacing: 2 },
  navTabs: { flexDirection: "row", alignItems: "center", gap: 14, flexWrap: "wrap", justifyContent: "center", flex: 1 },
  navTab: { color: "#9aa8b2", fontSize: 13 },
  navTabOn: { color: "#e8f7fb", fontSize: 13, fontWeight: "700" },
  navOn: { borderWidth: 1, borderColor: aqua, borderRadius: 16, paddingHorizontal: 10, paddingVertical: 4 },
  navRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  partnerBtn: { flexDirection: "row", alignItems: "center", gap: 6 },
  partnerName: { color: "#e8f7fb", fontSize: 13 },
  caret: { color: aqua, fontSize: 10 },
  more: { color: "#9aa8b2", fontSize: 18, paddingHorizontal: 4 },
  menu: {
    position: "absolute",
    top: 28,
    right: 0,
    backgroundColor: "#101820",
    borderWidth: 1,
    borderColor: "rgba(126,212,234,0.35)",
    padding: 8,
    zIndex: 4,
    minWidth: 120,
  },
  menuItem: { color: "#e8f7fb", paddingVertical: 6 },
  split: { flex: 1, flexDirection: "row", padding: 16, gap: 16 },
  stack: { flexDirection: "column" },
  left: { flex: 1, gap: 8 },
  leftShort: { flexGrow: 0 },
  kicker: { color: "#8aa0ab", fontSize: 11, letterSpacing: 1.6, marginTop: 8 },
  bigName: { color: "#f4fbfe", fontSize: 36, fontWeight: "800", letterSpacing: 1 },
  tagline: { color: "#b7c6ce", fontSize: 14 },
  pills: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 6 },
  pill: { color: "#d5eef5", borderWidth: 1, borderColor: "rgba(126,212,234,0.35)", borderRadius: 16, paddingHorizontal: 10, paddingVertical: 6, fontSize: 12 },
  bondCard: { marginTop: 8, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: "rgba(126,212,234,0.28)", backgroundColor: "#0c141c" },
  bondHead: { flexDirection: "row", justifyContent: "space-between" },
  bondTitle: { color: "#e8f7fb", fontWeight: "700" },
  bondPct: { color: aqua, fontWeight: "700" },
  track: { height: 8, borderRadius: 4, backgroundColor: "#1a2832", marginTop: 8, overflow: "hidden" },
  fillBar: { height: 8, backgroundColor: aqua },
  caption: { color: "#8aa0ab", fontSize: 12, marginTop: 6 },
  profileBtn: { marginTop: 8, alignSelf: "flex-start", borderWidth: 1, borderColor: "rgba(126,212,234,0.4)", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  profileText: { color: aqua, fontWeight: "700" },
  chatCard: { flex: 1.2, borderWidth: 1, borderColor: "rgba(126,212,234,0.22)", borderRadius: 18, backgroundColor: "#0b1218", padding: 12, minHeight: 320 },
  chatHead: { flexDirection: "row", alignItems: "center", gap: 10, paddingBottom: 8 },
  chatHeadText: { flex: 1 },
  chatName: { color: "#f4fbfe", fontWeight: "800", fontSize: 16 },
  subtitle: { color: "#8aa0ab", fontSize: 12 },
  onlineRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  dotOn: { backgroundColor: "#3dde8a" },
  dotOff: { backgroundColor: "#5c6a72" },
  online: { color: "#c5d4db", fontSize: 12 },
  miniBall: { width: 28, height: 28, borderRadius: 14, backgroundColor: "#1a3c4a", borderWidth: 1, borderColor: aqua },
  log: { flex: 1 },
  logInner: { gap: 10, paddingVertical: 8 },
  bubbleWrap: { flexDirection: "row", alignItems: "flex-end", gap: 8, maxWidth: "92%" },
  bubbleLeft: { alignSelf: "flex-start" },
  bubbleRight: { alignSelf: "flex-end" },
  bubble: { borderRadius: 14, paddingHorizontal: 12, paddingVertical: 8, maxWidth: 420 },
  bubbleHis: { backgroundColor: "#121a22", borderWidth: 1, borderColor: "rgba(126,212,234,0.18)" },
  bubbleMine: { backgroundColor: "#143246" },
  bubbleWho: { color: aqua, fontSize: 11, fontWeight: "700", marginBottom: 2 },
  bubbleText: { color: "#e7f3f7", fontSize: 15, lineHeight: 21 },
  time: { color: "#7e909a", fontSize: 11, marginTop: 4, textAlign: "right" },
  typing: { color: aqua, fontSize: 13, marginTop: 4 },
  thinkToggle: { color: "#7e909a", fontSize: 11, marginTop: 6 },
  thinkBody: { color: "#8aa0ab", fontSize: 12, marginTop: 4 },
  note: { color: "#e2c27a", fontSize: 13 },
  composer: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderColor: "rgba(126,212,234,0.25)", borderRadius: 22, paddingHorizontal: 10, paddingVertical: 6 },
  input: { flex: 1, color: "#f4fbfe", paddingVertical: 6 },
  emoji: { color: aqua, fontSize: 18 },
  mic: { borderWidth: 1, borderColor: aqua, borderRadius: 12, paddingHorizontal: 8, paddingVertical: 4, minWidth: 72 },
  micText: { color: "#d5eef5", fontSize: 11, textAlign: "center", textTransform: "capitalize" },
  send: { width: 36, height: 36, borderRadius: 18, backgroundColor: "#1a6f86", alignItems: "center", justifyContent: "center" },
  sendText: { color: "#f4fbfe", fontSize: 16 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  chip: { borderWidth: 1, borderColor: "rgba(126,212,234,0.35)", borderRadius: 16, paddingHorizontal: 10, paddingVertical: 6 },
  chipOff: { opacity: 0.45 },
  chipHint: { backgroundColor: "rgba(126,212,234,0.15)" },
  chipText: { color: "#d5eef5", fontSize: 12 },
  footerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 8, gap: 8 },
  footer: { color: "#8aa0ab", fontSize: 12 },
  switchRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  switchLabel: { color: "#8aa0ab", fontSize: 11 },
  fill: { flex: 1 },
  pad: { padding: 20, gap: 8 },
  dim: { color: "#9aa8b2", fontSize: 14 },
  sheet: { position: "absolute", left: 24, right: 24, bottom: 24, backgroundColor: "#101820", borderWidth: 1, borderColor: aqua, borderRadius: 16, padding: 16, gap: 8 },
});
