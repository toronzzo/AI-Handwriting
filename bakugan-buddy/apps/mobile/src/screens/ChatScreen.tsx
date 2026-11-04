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
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollViewInstance,
} from "react-native";
import {
  chooseRoute,
  deepseekIsPeak,
  LOCAL_TIMEOUT_MS,
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
import { currentBrainUrl, readBrainHost } from "../room/brain/brainLink";
import { brainFetch, isUnauthorized, pairWithCode } from "../room/brain/token";
import { isValidPairingCode, microphoneAvailable, normalizePairingCode } from "../../../../packages/alive/src/phone.ts";
import { isWhisperHallucination, resetSpeech } from "../../../../packages/alive/src/speech.ts";
import { NOTE_KINDS, parseNoteCommand, type Note, type NoteKind } from "../../../../packages/alive/src/notes.ts";
import { looksLikeTask, taskStatusLine, type TaskRecord } from "../../../../packages/alive/src/tasks.ts";
import { confirmFor } from "../../../../packages/alive/src/confirm.ts";
import { matchDocuments, parseDocumentRequest } from "../../../../packages/alive/src/documents.ts";
import { formatDue, parseReminder, type Reminder } from "../../../../packages/alive/src/reminders.ts";
import { isShortAffirmation, wantsThinking } from "../../../../packages/alive/src/chatTurn.ts";
import {
  needsWebSearch,
  searchQueryFrom,
  withSources,
  type SearchResult,
} from "../../../../packages/alive/src/webSearch.ts";
import { interruptTalk, queueSpokenLine, VoiceSession, type TalkSinks } from "../room/voice/VoiceSession";
import { PreyasHero } from "./PreyasHero";
import { MAIN_TABS, type Section } from "../nav";
import { theme } from "../theme";
type Shown = ChatMessage & {
  t: number;
  thinking?: string;
  sources?: SearchResult[];
  document?: { name: string; summary?: string; points?: { text: string; kind: NoteKind }[] };
  briefing?: boolean;
};
type InboxFile = { name: string; size: number; type: string; modified: number };
type PendingReminder = { text: string; dueAt: string; repeat: "none" | "daily" | "weekly" | "weekdays"; label: string };
type PartnerCard = { turns: number; level: number; bond: number; caption: string };
type HealthPart = { ok: boolean; label: string; detail: string };
type Health = { ok: boolean; parts: Record<string, HealthPart>; drive?: { mounted: boolean; freeGb: number | null }; memory?: { swapUsedMb: number | null } };
type ChatMeta = { id: string; title: string; created: number; updated: number };
type ChatDialog =
  | { kind: "rename"; id: string; value: string }
  | { kind: "delete"; id: string; title: string }
  | { kind: "deleteNote"; id: string; text: string }
  | { kind: "forget"; notes: Note[] }
  | { kind: "paid"; text: string }
  | { kind: "deleteReminders"; reminders: Reminder[] }
  | { kind: "remind"; pending: PendingReminder }
  | { kind: "restart" }
  | { kind: "briefingTime"; time: string }
  | { kind: "briefingOff" }
  | { kind: "deleteDeck"; id: string; title: string };
type StoredRow = { t?: number; role?: string; content?: string; who?: string; model?: string; costUsd?: number | null; thinking?: string };
function toShown(rows: StoredRow[]): Shown[] {
  return rows.map((row) => ({
    t: typeof row.t === "number" ? row.t : Date.now(),
    role: row.role === "assistant" || row.role === "system" ? row.role : "user",
    content: row.content || "",
    who: row.who === "paid" || row.who === "preyas" || row.who === "user" ? row.who : undefined,
    model: row.model || undefined,
    costUsd: row.costUsd,
    thinking: typeof row.thinking === "string" ? row.thinking : undefined,
  }));
}
function dayLabel(t: number): string {
  try {
    return new Date(t).toLocaleDateString([], { month: "short", day: "numeric" });
  } catch {
    return "";
  }
}
function newestFirst(list: ChatMeta[]): ChatMeta[] {
  return [...list].sort((a, b) => b.updated - a.updated);
}
const QUICK: { label: string; prompt: string }[] = [
  { label: "Battle Ready!", prompt: "I'm ready. What's our strategy?" },
  { label: "Power Up", prompt: "Show me a power up. Keep it short." },
  { label: "Fun Fact", prompt: "Tell me a fun fact about yourself." },
  { label: "Just Chat", prompt: "Let's just talk. What's on your mind?" },
];
/** Reasoning plus a full answer takes longer than a quick reply. */
const THINK_TIMEOUT_MS = 180_000;
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
export function ChatScreen({
  section,
  onSection,
  onNavigate,
}: {
  section: Section;
  onSection?: (section: Section) => void;
  onNavigate?: (tab: "room" | "body" | "bench") => void;
}) {
  const sinks = useRef<TalkSinks>(blankSinks());
  const bag = sinks.current;
  const messagesRef = useRef<Shown[]>([]);
  const summaryRef = useRef("");
  const busy = useRef(false);
  const sendEpoch = useRef(0);
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
  const logRef = useRef<ScrollViewInstance>(null);
  /** True while the thread is parked at the newest message. */
  const pinned = useRef(true);
  const [jumpVisible, setJumpVisible] = useState(false);
  const [partner, setPartner] = useState<PartnerCard>(partnerFromTurns(0));
  const [chats, setChats] = useState<ChatMeta[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const activeIdRef = useRef<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [dialog, setDialog] = useState<ChatDialog | null>(null);
  const [notesList, setNotesList] = useState<Note[]>([]);
  const [notesQuery, setNotesQuery] = useState("");
  const [editing, setEditing] = useState<{ id: string; text: string; kind: NoteKind } | null>(null);
  const [chip, setChip] = useState("");
  const notesStamp = useRef(0);
  const [task, setTask] = useState<TaskRecord | null>(null);
  const [searching, setSearching] = useState(false);
  const [inbox, setInbox] = useState<InboxFile[]>([]);
  const [inboxPath, setInboxPath] = useState("");
  const [docBusy, setDocBusy] = useState("");
  const [docProgress, setDocProgress] = useState("");
  const [docChoice, setDocChoice] = useState<{ name: string; matches: string[] } | null>(null);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [briefing, setBriefing] = useState<string>("");
  const [thinkForced, setThinkForced] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [needPair, setNeedPair] = useState(false);
  const [pairCode, setPairCode] = useState("");
  const [pairError, setPairError] = useState("");
  const [phoneInfo, setPhoneInfo] = useState<{ lanIp: string; phoneUrl: string; pairingCode: string; devices: number } | null>(null);
  const [decks, setDecks] = useState<{ id: string; title: string; cards: number; due: number; language: string }[]>([]);
  const [review, setReview] = useState<{ deck: string; title: string; cards: { id: string; question: string; answer: string }[]; index: number; flipped: boolean } | null>(null);
  const [quiz, setQuiz] = useState<{ deck: string; questions: { question: string; answer: string; options: string[] }[]; index: number; results: boolean[]; typed: string; feedback: string } | null>(null);
  const [pendingReminder, setPendingReminder] = useState<PendingReminder | null>(null);
  const [searchNote, setSearchNote] = useState("");
  const [openSteps, setOpenSteps] = useState<Record<number, boolean>>({});
  const taskPoll = useRef<ReturnType<typeof setInterval> | null>(null);
  const [memFilter, setMemFilter] = useState<"all" | "notes" | "reminders" | "docs">("all");
  const [briefingSettings, setBriefingSettings] = useState<{ briefingTime: string; briefingOn: boolean } | null>(null);
  const [briefingDismissed, setBriefingDismissed] = useState(false);
  const [profile, setProfile] = useState(false);
  const { width, height } = useWindowDimensions();
  const wide = width >= 900;
  const micOk =
    typeof window === "undefined" ||
    microphoneAvailable({
      protocol: window.location.protocol,
      hostname: window.location.hostname,
      isSecureContext: window.isSecureContext,
    });
  const phone = !wide && Math.min(width, height) < 600;
  const setActiveChat = (id: string | null) => {
    activeIdRef.current = id;
    setActiveChatId(id);
  };
  async function loadChat(id: string, cancelled?: () => boolean): Promise<boolean> {
    try {
      const res = await brainFetch(`${bag.brainUrl}/v1/chats/${encodeURIComponent(id)}`);
      if (!res.ok) return false;
      const body = (await res.json()) as {
        chat?: ChatMeta;
        summary?: string;
        partner?: PartnerCard;
        messages?: StoredRow[];
      };
      if (cancelled?.()) return false;
      summaryRef.current = body.summary || "";
      if (body.partner) setPartner(body.partner);
      const restored = toShown(body.messages || []);
      messagesRef.current = restored;
      setMessages(restored);
      setLive(null);
      setNote("");
      setOpenThink({});
      pinned.current = true;
      setJumpVisible(false);
      if (body.chat) {
        const meta = body.chat;
        setChats((rows) => newestFirst(rows.map((row) => (row.id === meta.id ? meta : row))));
      }
      sendEpoch.current += 1;
      setActiveChat(id);
      return true;
    } catch {
      return false;
    }
  }
  async function startChat(): Promise<ChatMeta | null> {
    try {
      const res = await brainFetch(`${bag.brainUrl}/v1/chats`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { chat?: ChatMeta };
      if (!body.chat) return null;
      const chat = body.chat;
      setChats((rows) => newestFirst([chat, ...rows.filter((row) => row.id !== chat.id)]));
      return chat;
    } catch {
      return null;
    }
  }
  async function newChat() {
    const chat = await startChat();
    if (!chat) return;
    await loadChat(chat.id);
    setDrawerOpen(false);
  }
  async function saveRename(id: string, title: string) {
    try {
      const res = await brainFetch(`${bag.brainUrl}/v1/chats/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title }),
      });
      if (res.ok) {
        const body = (await res.json()) as { chat?: ChatMeta };
        if (body.chat) {
          const meta = body.chat;
          setChats((rows) => newestFirst(rows.map((row) => (row.id === meta.id ? meta : row))));
        }
      }
    } catch {
      /* keep the old title */
    }
    setDialog(null);
  }
  async function removeChat(id: string) {
    try {
      await brainFetch(`${bag.brainUrl}/v1/chats/${encodeURIComponent(id)}`, { method: "DELETE" });
    } catch {
      /* the row goes away locally either way */
    }
    const left = chats.filter((row) => row.id !== id);
    setChats(left);
    setDialog(null);
    if (activeIdRef.current === id) {
      if (left.length > 0) await loadChat(newestFirst(left)[0]!.id);
      else await newChat();
    }
  }
  async function fetchNotes(query: string, limit = 50): Promise<Note[]> {
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set("q", query.trim());
      params.set("limit", String(limit));
      const res = await brainFetch(`${bag.brainUrl}/v1/notes?${params.toString()}`);
      if (!res.ok) return [];
      const body = (await res.json()) as { notes?: Note[] };
      return Array.isArray(body.notes) ? body.notes : [];
    } catch {
      return [];
    }
  }
  function stampOf(rows: Note[]): number {
    return rows.reduce((max, note) => Math.max(max, note.updated || 0), 0);
  }
  async function refreshNotes(query = notesQuery) {
    const rows = await fetchNotes(query);
    setNotesList(rows);
    return rows;
  }
  /** The model extracts notes after a reply; poll a few times, then show the chip. */
  function scheduleNotesCheck() {
    for (const delay of [1500, 4000, 8000]) {
      setTimeout(() => {
        void (async () => {
          const rows = await fetchNotes("", 100);
          const stamp = stampOf(rows);
          if (stamp > notesStamp.current) {
            notesStamp.current = stamp;
            setChip("Saved to notes");
            setNotesList(rows);
          }
        })();
      }, delay);
    }
  }
  async function postNote(text: string, kind: NoteKind): Promise<Note | null> {
    try {
      const res = await brainFetch(`${bag.brainUrl}/v1/notes`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, kind, sourceChatId: activeIdRef.current || "" }),
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { note?: Note };
      const note = body.note || null;
      if (note) {
        notesStamp.current = Math.max(notesStamp.current, note.updated);
        setNotesList((rows) => [note, ...rows.filter((row) => row.id !== note.id)]);
      }
      return note;
    } catch {
      return null;
    }
  }
  async function patchNote(id: string, text: string, kind: NoteKind): Promise<boolean> {
    try {
      const res = await brainFetch(`${bag.brainUrl}/v1/notes/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, kind }),
      });
      if (!res.ok) return false;
      const body = (await res.json()) as { note?: Note };
      if (body.note) {
        const note = body.note;
        notesStamp.current = Math.max(notesStamp.current, note.updated);
        setNotesList((rows) => rows.map((row) => (row.id === note.id ? note : row)));
      }
      return true;
    } catch {
      return false;
    }
  }
  async function removeNote(id: string) {
    try {
      await brainFetch(`${bag.brainUrl}/v1/notes/${encodeURIComponent(id)}`, { method: "DELETE" });
    } catch {
      /* the row goes away locally either way */
    }
    setNotesList((rows) => rows.filter((row) => row.id !== id));
    setEditing(null);
    setDialog(null);
  }
  async function addLocal(entry: Shown) {
    messagesRef.current = [...messagesRef.current, entry];
    setMessages(messagesRef.current);
    await remember(entry);
  }
  async function handleRemember(raw: string, text: string) {
    busy.current = true;
    try {
      await addLocal({ t: Date.now(), role: "user", content: raw, who: "user" });
      const note = await postNote(text, "fact");
      await addLocal({
        t: Date.now(),
        role: "assistant",
        content: note ? `Saved to notes: ${note.text}` : "I couldn't save that note.",
        who: "preyas",
        model: "preyas",
      });
      if (note) setChip("Saved to notes");
    } finally {
      busy.current = false;
    }
  }
  async function handleForget(raw: string, query: string) {
    busy.current = true;
    try {
      await addLocal({ t: Date.now(), role: "user", content: raw, who: "user" });
      const hits = await fetchNotes(query, 5);
      if (hits.length === 0) {
        await addLocal({
          t: Date.now(),
          role: "assistant",
          content: `I don't have a note about ${query}.`,
          who: "preyas",
          model: "preyas",
        });
        return;
      }
      setDialog({ kind: "forget", notes: hits });
    } finally {
      busy.current = false;
    }
  }
  async function forgetNotes(notes: Note[]) {
    for (const note of notes) {
      try {
        await brainFetch(`${bag.brainUrl}/v1/notes/${encodeURIComponent(note.id)}`, { method: "DELETE" });
      } catch {
        /* keep going: the rest still need forgetting */
      }
    }
    setNotesList((rows) => rows.filter((row) => !notes.some((note) => note.id === row.id)));
    setDialog(null);
    await addLocal({
      t: Date.now(),
      role: "assistant",
      content: notes.length === 1 ? `Forgot: ${notes[0]!.text}` : `Forgot ${notes.length} notes.`,
      who: "preyas",
      model: "preyas",
    });
  }
  async function saveEditing() {
    if (!editing) return;
    const ok = await patchNote(editing.id, editing.text, editing.kind);
    if (ok) setEditing(null);
  }
  async function submitPairing() {
    if (!isValidPairingCode(pairCode)) {
      setPairError("Six digits, please.");
      return;
    }
    const result = await pairWithCode(bag.brainUrl, pairCode, "iPhone");
    if (!result.ok) {
      setPairError(result.error || "That code was not accepted.");
      return;
    }
    setPairError("");
    setNeedPair(false);
    setPairCode("");
    window.location.reload();
  }
  async function refreshBriefing() {
    try {
      const res = await brainFetch(`${bag.brainUrl}/v1/briefing/today`);
      if (!res.ok) return "";
      const body = (await res.json()) as { text?: string | null; settings?: { briefingTime: string; briefingOn: boolean } };
      const text = body.text || "";
      setBriefing(text);
      if (body.settings) setBriefingSettings(body.settings);
      return text;
    } catch {
      return "";
    }
  }
  async function runBriefingNow(chatId: string | null) {
    setChip("Building your briefing…");
    try {
      const res = await brainFetch(`${bag.brainUrl}/v1/briefing/run`, { method: "POST" });
      const body = (await res.json()) as { ok?: boolean; text?: string; error?: string };
      if (!body.ok || !body.text) throw new Error(body.error || "no briefing");
      setBriefing(body.text);
      setChip("Briefing ready");
      const reply: Shown = {
        t: Date.now(),
        role: "assistant",
        content: body.text,
        who: "preyas",
        model: "preyas",
        briefing: true,
      };
      messagesRef.current = [...messagesRef.current, reply];
      setMessages(messagesRef.current);
      void remember(reply, chatId);
    } catch {
      setChip("Could not build the briefing");
    }
  }
  async function saveBriefingSettings(patch: { briefingTime?: string; briefingOn?: boolean }) {
    try {
      await brainFetch(`${bag.brainUrl}/v1/briefing/settings`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      setBriefingSettings((cur) => ({
        briefingTime: patch.briefingTime ?? cur?.briefingTime ?? "08:00",
        briefingOn: patch.briefingOn ?? cur?.briefingOn ?? true,
      }));
      setChip(patch.briefingOn === false ? "Briefing off" : patch.briefingTime ? `Briefing at ${patch.briefingTime}` : "Briefing updated");
    } catch {
      setChip("Could not save the setting");
    }
  }
  function normalizeCompare(value: string): string {
    return String(value || "").toLowerCase().replace(/\.[a-z0-9]+$/, "").replace(/[^a-z0-9]+/g, "");
  }
  async function refreshDecks() {
    try {
      const res = await brainFetch(`${bag.brainUrl}/v1/study/decks`);
      if (!res.ok) return [];
      const body = (await res.json()) as { decks?: { id: string; title: string; cards: number; due: number; language: string }[] };
      const rows = Array.isArray(body.decks) ? body.decks : [];
      setDecks(rows);
      return rows;
    } catch {
      return [];
    }
  }
  async function makeDeck(name: string) {
    setChip(`Making flashcards from ${name}…`);
    try {
      const res = await brainFetch(`${bag.brainUrl}/v1/study/decks`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ document: name }),
      });
      const body = (await res.json()) as { ok?: boolean; deck?: { id: string; title: string; cards: number }; error?: string };
      if (!body.ok || !body.deck) throw new Error(body.error || "no deck");
      setChip(`${body.deck.cards} cards ready`);
      void refreshDecks();
      return body.deck;
    } catch (error) {
      setChip(`Could not make cards: ${error instanceof Error ? error.message : "unknown"}`);
      return null;
    }
  }
  async function startReview(deckId: string, title: string) {
    try {
      const res = await brainFetch(`${bag.brainUrl}/v1/study/decks/${encodeURIComponent(deckId)}/due`);
      if (!res.ok) return;
      const body = (await res.json()) as { cards?: { id: string; question: string; answer: string }[] };
      const cards = body.cards || [];
      if (!cards.length) {
        setChip("Nothing due in this deck");
        return;
      }
      setReview({ deck: deckId, title, cards: cards.slice(0, 20), index: 0, flipped: false });
    } catch {
      setChip("Could not open the deck");
    }
  }
  async function gradeReview(grade: "again" | "hard" | "good" | "easy") {
    if (!review) return;
    const card = review.cards[review.index];
    if (!card) return;
    try {
      await brainFetch(`${bag.brainUrl}/v1/study/decks/${encodeURIComponent(review.deck)}/review`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cardId: card.id, grade }),
      });
    } catch {
      /* keep going; the schedule will be retried next time */
    }
    const next = review.index + 1;
    if (next >= review.cards.length) {
      setReview(null);
      setChip("Review done");
      void refreshDecks();
      return;
    }
    setReview({ ...review, index: next, flipped: false });
  }
  async function startQuiz(deckId: string, title: string) {
    setChip("Building a quiz…");
    try {
      const res = await brainFetch(`${bag.brainUrl}/v1/study/decks/${encodeURIComponent(deckId)}/quiz`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const body = (await res.json()) as { ok?: boolean; questions?: { question: string; answer: string; options: string[] }[] };
      if (!body.ok || !body.questions?.length) throw new Error("no quiz");
      setQuiz({ deck: deckId, questions: body.questions, index: 0, results: [], typed: "", feedback: "" });
      setChip("");
    } catch {
      setChip("Could not build a quiz");
    }
  }
  async function answerQuiz(given: string) {
    if (!quiz) return;
    const question = quiz.questions[quiz.index];
    if (!question) return;
    const norm = (value: string) => value.toLowerCase().replace(/[^a-z0-9Ѐ-ӿ\s]+/g, " ").replace(/\s+/g, " ").trim();
    const expected = norm(question.answer);
    const actual = norm(given);
    const correct = actual.length > 0 && (actual === expected || expected.includes(actual) || actual.includes(expected));
    const results = [...quiz.results, correct];
    setQuiz({
      ...quiz,
      results,
      feedback: correct ? "Correct." : `Not quite. ${question.answer}`,
      typed: "",
    });
  }
  async function nextQuizQuestion() {
    if (!quiz) return;
    const next = quiz.index + 1;
    if (next >= quiz.questions.length) {
      const score = quiz.results.filter(Boolean).length;
      setChip(`Quiz: ${score} of ${quiz.results.length}`);
      try {
        await brainFetch(`${bag.brainUrl}/v1/study/decks/${encodeURIComponent(quiz.deck)}/quiz`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            result: {
              score,
              total: quiz.questions.length,
              results: quiz.questions.map((row, index) => ({ question: row.question, correct: Boolean(quiz.results[index]) })),
            },
          }),
        });
      } catch {
        /* the score is still shown */
      }
      setQuiz(null);
      void refreshDecks();
      return;
    }
    setQuiz({ ...quiz, index: next, feedback: "", typed: "" });
  }
  async function refreshPhone() {
    try {
      const res = await brainFetch(`${bag.brainUrl}/v1/phone`);
      if (!res.ok) return null;
      const body = (await res.json()) as { lanIp: string; phoneUrl: string; pairingCode: string; devices: number };
      setPhoneInfo(body);
      return body;
    } catch {
      return null;
    }
  }
  async function refreshHealth() {
    try {
      const res = await brainFetch(`${bag.brainUrl}/v1/status`);
      if (!res.ok) return null;
      const body = (await res.json()) as Health;
      setHealth(body);
      return body;
    } catch {
      return null;
    }
  }
  async function restartPreyas() {
    try {
      await brainFetch(`${bag.brainUrl}/v1/restart`, { method: "POST" });
      setChip("Restarting Preyas…");
    } catch {
      setChip("Could not restart");
    }
  }
  async function refreshReminders() {
    try {
      const res = await brainFetch(`${bag.brainUrl}/v1/reminders`);
      if (!res.ok) return [];
      const body = (await res.json()) as { reminders?: Reminder[] };
      const rows = Array.isArray(body.reminders) ? body.reminders : [];
      setReminders(rows);
      return rows;
    } catch {
      return [];
    }
  }
  /** Save a reminder the user just confirmed. */
  async function saveReminder(pending: PendingReminder, chatId: string | null) {
    try {
      const res = await brainFetch(`${bag.brainUrl}/v1/reminders`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: pending.text, dueAt: pending.dueAt, repeat: pending.repeat, chatId: chatId || "" }),
      });
      if (!res.ok) throw new Error("could not save the reminder");
      setChip(`Reminder set for ${pending.label}`);
      void refreshReminders();
    } catch {
      setChip("Could not save the reminder");
    }
  }
  async function updateReminder(id: string, patch: Record<string, unknown>) {
    try {
      await brainFetch(`${bag.brainUrl}/v1/reminders/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      void refreshReminders();
    } catch {
      setChip("Could not update the reminder");
    }
  }
  /** "make flashcards from X", "study", "quiz me on X", "explain X simply". */
  async function handleStudyCommand(text: string, chatId: string | null): Promise<boolean> {
    const lower = text.trim().toLowerCase();
    const make = lower.match(/^(?:please\s+)?make\s+flashcards?\s+(?:from|for|on)\s+(.+)$/i);
    if (make) {
      await addLocal({ t: Date.now(), role: "user", content: text, who: "user" });
      const deck = await makeDeck((make[1] || "").trim());
      await addLocal({
        t: Date.now(),
        role: "assistant",
        content: deck ? `Made a deck with ${deck.cards} cards from ${deck.title}. Say "study" to begin.` : "I could not make cards from that document.",
        who: "preyas",
        model: "preyas",
      });
      return true;
    }
    if (/^\/study\b|^study\b|^start studying\b/.test(lower)) {
      const rows = await refreshDecks();
      const withDue = rows.filter((row) => row.due > 0);
      if (!withDue.length) {
        await addLocal({ t: Date.now(), role: "user", content: text, who: "user" });
        await addLocal({
          t: Date.now(),
          role: "assistant",
          content: rows.length ? "Nothing is due right now. Good work." : "No decks yet. Say \"make flashcards from <file>\".",
          who: "preyas",
          model: "preyas",
        });
        return true;
      }
      onSection?.("learn");
      void refreshDecks();
      return true;
    }
    const quizMe = lower.match(/^quiz\s+me\s+(?:on|about)\s+(.+)$/i);
    if (quizMe) {
      const topic = (quizMe[1] || "").trim();
      const rows = await refreshDecks();
      const hit = rows.find((row) => row.title.toLowerCase().includes(topic.toLowerCase())) || rows[0];
      if (!hit) {
        await addLocal({ t: Date.now(), role: "user", content: text, who: "user" });
        await addLocal({
          t: Date.now(),
          role: "assistant",
          content: "I need a deck first. Say \"make flashcards from <file>\".",
          who: "preyas",
          model: "preyas",
        });
        return true;
      }
      await addLocal({ t: Date.now(), role: "user", content: text, who: "user" });
      await startQuiz(hit.id, hit.title);
      return true;
    }
    const explain = lower.match(/^explain\s+(.+?)\s+simply$/i);
    if (explain) {
      const topic = (explain[1] || "").trim();
      await addLocal({ t: Date.now(), role: "user", content: text, who: "user" });
      // Prefer the documents: find the file that mentions the topic, ask it.
      try {
        const files = inbox.length ? inbox : await refreshInbox();
        const hit = files.find((file) => normalizeCompare(file.name).startsWith(normalizeCompare(topic)));
        if (hit) {
          const res = await brainFetch(`${bag.brainUrl}/v1/documents/${encodeURIComponent(hit.name)}/ask`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ question: `Explain ${topic} simply, with one everyday example.` }),
          });
          const body = (await res.json()) as { ok?: boolean; answer?: string };
          if (body.ok && body.answer) {
            const reply: Shown = { t: Date.now(), role: "assistant", content: body.answer, who: "preyas", model: "preyas" };
            messagesRef.current = [...messagesRef.current, reply];
            setMessages(messagesRef.current);
            void remember(reply, chatId);
            return true;
          }
        }
      } catch {
        /* fall through to notes */
      }
      const rows = await fetchNotes(topic, 3);
      const reply: Shown = {
        t: Date.now(),
        role: "assistant",
        content: rows.length
          ? `In plain words: ${rows[0]!.text}\n\nExample: picture the simplest everyday version of the same idea.`
          : `I do not have anything on "${topic}" yet. Add a document or a note and ask again.`,
        who: "preyas",
        model: "preyas",
      };
      messagesRef.current = [...messagesRef.current, reply];
      setMessages(messagesRef.current);
      void remember(reply, chatId);
      return true;
    }
    return false;
  }
  /** "/briefing", "what's my day", "briefing at 9", "turn off briefing". */
  async function handleBriefingCommand(text: string, chatId: string | null): Promise<boolean> {
    const lower = text.trim().toLowerCase();
    if (/^\/briefing\b|^what'?s my day\b|^my day\b|^what is my day\b/.test(lower)) {
      await addLocal({ t: Date.now(), role: "user", content: text, who: "user" });
      await runBriefingNow(chatId);
      return true;
    }
    const at = lower.match(/^briefing\s+at\s+(\d{1,2})(?::(\d{2}))?$/i);
    if (at) {
      const hour = String(Number(at[1])).padStart(2, "0");
      const minute = (at[2] || "00").padStart(2, "0");
      const time = `${hour}:${minute}`;
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
        await addLocal({ t: Date.now(), role: "user", content: text, who: "user" });
        await addLocal({
          t: Date.now(),
          role: "assistant",
          content: "That is not a time I can use. Try \"briefing at 9\" or \"briefing at 08:30\".",
          who: "preyas",
          model: "preyas",
        });
        return true;
      }
      setDialog({ kind: "briefingTime", time });
      return true;
    }
    if (/^turn off (the )?briefing\b|^briefing off\b/.test(lower)) {
      setDialog({ kind: "briefingOff" });
      return true;
    }
    if (/^turn on (the )?briefing\b|^briefing on\b/.test(lower)) {
      await addLocal({ t: Date.now(), role: "user", content: text, who: "user" });
      await saveBriefingSettings({ briefingOn: true });
      await addLocal({
        t: Date.now(),
        role: "assistant",
        content: "Morning briefings are back on.",
        who: "preyas",
        model: "preyas",
      });
      return true;
    }
    void chatId;
    return false;
  }
  /** "remind me …" → confirm card; "what are my reminders"; "cancel the X reminder". */
  async function handleReminderCommand(text: string, chatId: string | null): Promise<boolean> {
    const lower = text.trim().toLowerCase();
    if (/^what are my reminders\b|^my reminders\b/.test(lower)) {
      const rows = reminders.length ? reminders : await refreshReminders();
      const upcoming = rows
        .filter((row) => row.status === "pending" || row.status === "snoozed")
        .sort((left, right) => new Date(left.dueAt).getTime() - new Date(right.dueAt).getTime())
        .slice(0, 6);
      await addLocal({ t: Date.now(), role: "user", content: text, who: "user" });
      await addLocal({
        t: Date.now(),
        role: "assistant",
        content: upcoming.length
          ? upcoming.map((row) => `• ${formatDue(new Date(row.dueAt))}: ${row.text}`).join("\n")
          : "You have no reminders yet.",
        who: "preyas",
        model: "preyas",
      });
      return true;
    }
    const cancel = lower.match(/^cancel(?:\s+the)?\s+(.+?)(?:\s+reminder)?$/i);
    if (cancel) {
      const target = (cancel[1] || "").trim();
      const rows = await refreshReminders();
      const hits = rows.filter(
        (row) => row.text.toLowerCase().includes(target.toLowerCase()) && row.status !== "done",
      );
      if (!hits.length) {
        await addLocal({ t: Date.now(), role: "user", content: text, who: "user" });
        await addLocal({
          t: Date.now(),
          role: "assistant",
          content: `I don't have a pending reminder about "${target}".`,
          who: "preyas",
          model: "preyas",
        });
        return true;
      }
      setDialog({ kind: "deleteReminders", reminders: hits });
      return true;
    }
    const parsed = parseReminder(text);
    if (parsed.ok) {
      const pending = {
        text: parsed.text,
        dueAt: parsed.dueAt.toISOString(),
        repeat: parsed.repeat,
        label: parsed.label,
      };
      setPendingReminder(pending);
      setDialog({ kind: "remind", pending });
      return true;
    }
    if (parsed.reason === "no-time" && /^\s*(?:please\s+)?remind\b/i.test(text)) {
      await addLocal({ t: Date.now(), role: "user", content: text, who: "user" });
      await addLocal({
        t: Date.now(),
        role: "assistant",
        content: "When should I remind you? Say a time, like \"tomorrow at 9\" or \"in 2 hours\".",
        who: "preyas",
        model: "preyas",
      });
      return true;
    }
    void chatId;
    return false;
  }
  async function refreshInbox() {
    try {
      const res = await brainFetch(`${bag.brainUrl}/v1/documents`);
      if (!res.ok) return [];
      const body = (await res.json()) as { inbox?: string; documents?: InboxFile[] };
      const files = Array.isArray(body.documents) ? body.documents : [];
      setInbox(files);
      if (body.inbox) setInboxPath(body.inbox);
      return files;
    } catch {
      return [];
    }
  }
  /** Wait for a summary job, reporting chunk progress while it runs. */
  async function waitForSummary(
    name: string,
  ): Promise<{ summary?: string; points?: { text: string; kind: NoteKind }[]; error?: string }> {
    for (let attempt = 0; attempt < 160; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      try {
        const res = await brainFetch(`${bag.brainUrl}/v1/documents/${encodeURIComponent(name)}/summary`);
        if (!res.ok) continue;
        const body = (await res.json()) as {
          ok?: boolean;
          status?: string;
          done?: number;
          total?: number;
          summary?: string;
          points?: { text: string; kind: NoteKind }[];
          error?: string;
        };
        if ((body.total || 0) > 1) setDocProgress(`Reading chunk ${body.done} of ${body.total}…`);
        if (body.status === "running") continue;
        if (body.status === "error") return { error: body.error || "the document could not be read" };
        if (body.summary) return { summary: body.summary, points: body.points || [] };
      } catch {
        /* keep polling */
      }
    }
    return { error: "the summary took too long" };
  }
  /** Run a web search for a message that needs fresh information. */
  async function runWebSearch(text: string): Promise<{ query: string; results: SearchResult[] }> {
    const query = searchQueryFrom(text) || text.trim();
    setSearching(true);
    try {
      const res = await brainFetch(`${bag.brainUrl}/v1/search?q=${encodeURIComponent(query)}`);
      const body = (await res.json()) as { ok?: boolean; results?: SearchResult[]; error?: string };
      if (!body.ok || !body.results?.length) {
        setSearchNote(body.error ? `No web results (${body.error}).` : "No web results.");
        return { query, results: [] };
      }
      setSearchNote("");
      return { query, results: body.results.slice(0, 5) };
    } catch {
      setSearchNote("No internet, answering from memory.");
      return { query, results: [] };
    } finally {
      setSearching(false);
    }
  }
  function watchTask(id: string) {
    if (taskPoll.current) clearInterval(taskPoll.current);
    taskPoll.current = setInterval(() => {
      void (async () => {
        try {
          const res = await brainFetch(`${bag.brainUrl}/v1/tasks/${encodeURIComponent(id)}`);
          if (!res.ok) return;
          const body = (await res.json()) as { task?: TaskRecord };
          if (!body.task) return;
          setTask(body.task);
          if (body.task.status === "done" || body.task.status === "error") {
            if (taskPoll.current) clearInterval(taskPoll.current);
            taskPoll.current = null;
          }
        } catch {
          /* the poll is best effort */
        }
      })();
    }, 1200);
  }
  async function runTaskFlow(text: string) {
    busy.current = true;
    try {
      await addLocal({ t: Date.now(), role: "user", content: text, who: "user" });
      await addLocal({
        t: Date.now(),
        role: "assistant",
        content: "On it…",
        who: "preyas",
        model: "preyas",
      });
      const res = await brainFetch(`${bag.brainUrl}/v1/tasks`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: text, chatId: activeIdRef.current || "" }),
      });
      if (!res.ok) throw new Error("task endpoint");
      const body = (await res.json()) as { task?: TaskRecord };
      if (!body.task) throw new Error("no task");
      setTask(body.task);
      setOpenSteps({});
      watchTask(body.task.id);
    } catch {
      await addLocal({
        t: Date.now(),
        role: "assistant",
        content: "I couldn't start that task. The brain may be offline.",
        who: "preyas",
        model: "preyas",
      });
    } finally {
      busy.current = false;
    }
  }
  /** Handle "summarize <file>", "read <file>", "what does <file> say about X", "/doc <file>". */
  async function handleDocumentRequest(
    request: { kind: string; name: string; question?: string },
    raw: string,
    chatId: string | null,
  ): Promise<boolean> {
    const files = inbox.length ? inbox : await refreshInbox();
    const hits = matchDocuments(request.name, files.map((row) => row.name));
    if (!hits.length) {
      await addLocal({ t: Date.now(), role: "user", content: raw, who: "user" });
      await addLocal({
        t: Date.now(),
        role: "assistant",
        content: `I can't see a document called "${request.name}". Drop it into the inbox and ask again.`,
        who: "preyas",
        model: "preyas",
      });
      onSection?.("memory");
      setMemFilter("docs");
      return true;
    }
    if (hits.length > 1) {
      setDocChoice({ name: raw, matches: hits.map((hit) => hit.name) });
      return true;
    }
    const name = hits[0]!.name;
    await addLocal({ t: Date.now(), role: "user", content: raw, who: "user" });
    if (request.kind === "question") {
      setDocBusy(name);
      try {
        const res = await brainFetch(`${bag.brainUrl}/v1/documents/${encodeURIComponent(name)}/ask`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ question: request.question }),
        });
        const body = (await res.json()) as { ok?: boolean; answer?: string; error?: string };
        await addLocal({
          t: Date.now(),
          role: "assistant",
          content: body.ok && body.answer ? body.answer : `I couldn't read ${name}: ${body.error || "unknown error"}.`,
          who: "preyas",
          model: "preyas",
          document: { name },
        });
      } finally {
        setDocBusy("");
        setDocProgress("");
      }
      return true;
    }
    setDocBusy(name);
    setDocProgress("");
    try {
      const res = await brainFetch(`${bag.brainUrl}/v1/documents/${encodeURIComponent(name)}/summarize`, { method: "POST" });
      if (!res.ok) throw new Error("could not start the summary");
      const done = await waitForSummary(name);
      const reply: Shown = {
        t: Date.now(),
        role: "assistant",
        content: done.summary
          ? done.summary
          : `I couldn't summarise ${name}: ${done.error || "unknown error"}.`,
        who: "preyas",
        model: "preyas",
        document: done.summary ? { name, summary: done.summary, points: done.points } : { name },
      };
      messagesRef.current = [...messagesRef.current, reply];
      setMessages(messagesRef.current);
      void remember(reply, chatId);
    } catch (error) {
      await addLocal({
        t: Date.now(),
        role: "assistant",
        content: `I couldn't summarise ${name}: ${error instanceof Error ? error.message : String(error)}.`,
        who: "preyas",
        model: "preyas",
      });
    } finally {
      setDocBusy("");
      setDocProgress("");
    }
    return true;
  }
  async function saveKeyPoints(name: string, points: { text: string; kind: NoteKind }[]) {
    try {
      const res = await brainFetch(`${bag.brainUrl}/v1/documents/${encodeURIComponent(name)}/notes`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ points, chatId: activeIdRef.current || "" }),
      });
      const body = (await res.json()) as { saved?: number };
      setChip(body.saved ? `Saved ${body.saved} key points to notes` : "Those points are already in notes");
      void refreshNotes("");
    } catch {
      setChip("Could not save the key points");
    }
  }
  async function resumeTask(id: string) {
    try {
      const res = await brainFetch(`${bag.brainUrl}/v1/tasks/${encodeURIComponent(id)}/resume`, { method: "POST" });
      if (!res.ok) return;
      const body = (await res.json()) as { task?: TaskRecord };
      if (!body.task) return;
      setTask(body.task);
      watchTask(body.task.id);
    } catch {
      /* stays paused */
    }
  }
  useEffect(() => {
    return () => {
      if (taskPoll.current) clearInterval(taskPoll.current);
    };
  }, []);
  useEffect(() => {
    if (!chip) return;
    const id = setTimeout(() => setChip(""), 4000);
    return () => clearTimeout(id);
  }, [chip]);
  useEffect(() => {
    let cancel = false;
    void (async () => {
      const saved = await readBrainHost();
      const brain = saved || currentBrainUrl();
      bag.brainUrl = brain.replace(/\/$/, "");
      const endpoint = await resolveChatBase(bag.brainUrl);
      if (cancel) return;
      setVia(endpoint.via);
      try {
        const res = await brainFetch(`${bag.brainUrl}/v1/chats`);
        if (isUnauthorized(res.status)) {
          setNeedPair(true);
          return;
        }
        if (res.ok) {
          const body = (await res.json()) as { chats?: ChatMeta[] };
          let list = Array.isArray(body.chats) ? body.chats : [];
          if (list.length === 0) {
            const made = await startChat();
            if (made) list = [made];
          }
          if (cancel) return;
          if (list.length > 0) {
            setChats(newestFirst(list));
            await loadChat(list[0]!.id, () => cancel);
          }
        }
      } catch {
        /* the thread still works for this session */
      }
      try {
        const rows = await fetchNotes("", 100);
        if (!cancel) notesStamp.current = stampOf(rows);
      } catch {
        /* notes arrive with the next exchange */
      }
      try {
        const res = await brainFetch(`${bag.brainUrl}/v1/paid`);
        if (res.ok) {
          const body = (await res.json()) as PaidInfo;
          if (!cancel) setPaid(body);
        }
      } catch {
        if (!cancel) setPaid({ available: false, offPeakOnly: false, reason: "Brain is offline" });
      }
      void refreshBriefing();
    })();
    const timer = setInterval(() => {
      setPhase(bag.phase || "listening");
      if (!bag.heard || busy.current) return;
      const text = bag.heard;
      bag.heard = "";
      // "[Music]", "(noise)" and Whisper's silence loops are not the partner talking.
      if (isWhisperHallucination(text)) return;
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
        const res = await brainFetch(`${bag.brainUrl}/v1/health`);
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
  // New turns follow the newest bubble only while the thread is parked at the bottom.
  useEffect(() => {
    if (pinned.current) logRef.current?.scrollToEnd({ animated: true });
  }, [messages.length]);
  // Each tab loads its own data only when it is opened.
  useEffect(() => {
    if (section === "learn") void refreshDecks();
    if (section === "memory") {
      void refreshNotes(notesQuery);
      void refreshReminders();
      void refreshInbox();
    }
    if (section === "settings") {
      void refreshHealth();
      void refreshPhone();
      void refreshBriefing();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section]);
  const scrollToLatest = (animated = true) => {
    logRef.current?.scrollToEnd({ animated });
  };
  const onLogScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const distanceFromBottom = contentSize.height - (contentOffset.y + layoutMeasurement.height);
    const atBottom = distanceFromBottom < 48;
    pinned.current = atBottom;
    setJumpVisible(!atBottom);
  };
  const jumpToLatest = () => {
    pinned.current = true;
    setJumpVisible(false);
    scrollToLatest();
  };
  async function remember(entry: ChatMessage, chatId = activeIdRef.current) {
    if (!bag.brainUrl || !chatId) return;
    try {
      const res = await brainFetch(`${bag.brainUrl}/v1/chats/${encodeURIComponent(chatId)}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(entry),
      });
      if (!res.ok) return;
      const body = (await res.json()) as { chat?: ChatMeta };
      if (body.chat) {
        const meta = body.chat;
        setChats((rows) => newestFirst(rows.map((row) => (row.id === meta.id ? meta : row))));
      }
    } catch {
      /* the line is still on screen */
    }
  }
  async function speakPreyas(text: string, final: boolean, fresh = false) {
    if (fresh) resetSpeech(bag);
    queueSpokenLine(bag, text, "happy", final);
  }
  async function ask(
    route: "local" | "paid",
    prior: ChatMessage[],
    userText: string,
    isCurrent: () => boolean = () => true,
    sources: SearchResult[] = [],
    searchQuery = "",
    think = false,
  ) {
    const endpoint = await resolveChatBase(bag.brainUrl);
    if (isCurrent()) setVia(endpoint.via);
    const model = modelId(route, endpoint.via);
    const base = route === "paid" && endpoint.via === "proxy" ? bag.brainUrl : endpoint.base;
    let last = "";
    let lastThink = "";
    let spoke = false;
    const result = await streamReply({
      base,
      model,
      messages: toModelMessages(prior, summaryRef.current, withSources(userText, searchQuery, sources)),
      think,
      timeoutMs: route === "paid" ? 45_000 : think ? THINK_TIMEOUT_MS : LOCAL_TIMEOUT_MS,
      onDelta: (update) => {
        const shown = splitPaidHint(update.answer).text;
        last = shown;
        lastThink = update.thinking;
        if (!isCurrent()) return;
        setLive(shown ? { who: route === "paid" ? "paid" : "preyas", text: shown } : null);
        if (route === "local" && shown) {
          void speakPreyas(shown, false, !spoke);
          spoke = true;
        }
      },
    });
    if (isCurrent()) setLive(null);
    const parsed = splitPaidHint(result.text || last);
    if (isCurrent() && route === "local" && parsed.text) void speakPreyas(parsed.text, true, !spoke);
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
    // A chat is saved before its first message, so history never goes to a stray file.
    if (!activeIdRef.current) {
      const chat = await startChat();
      if (chat) setActiveChat(chat.id);
      else setNote("Preyas can answer, but this chat is not being saved while the brain is offline.");
    }
    const chatId = activeIdRef.current;
    const epoch = sendEpoch.current;
    const isCurrent = () => activeIdRef.current === chatId && sendEpoch.current === epoch;
    // "yes" / "ok" / "да" answers the question Preyas just asked. It must not be
    // read as a document request, a task, a reminder or a note.
    const affirmation = isShortAffirmation(trimmed);
    const docRequest = affirmation ? null : parseDocumentRequest(trimmed);
    if (docRequest && !askPaid) {
      const handled = await handleDocumentRequest(docRequest, trimmed, chatId);
      if (handled) return;
    }
    if (!askPaid && !affirmation && (await handleStudyCommand(trimmed, chatId))) return;
    if (!askPaid && !affirmation && (await handleBriefingCommand(trimmed, chatId))) return;
    if (!askPaid && !affirmation && (await handleReminderCommand(trimmed, chatId))) return;
    const command = affirmation ? null : parseNoteCommand(trimmed);
    if (command?.kind === "remember") {
      await handleRemember(trimmed, command.text);
      return;
    }
    if (command?.kind === "forget") {
      await handleForget(trimmed, command.query);
      return;
    }
    if (!askPaid && !affirmation && looksLikeTask(trimmed)) {
      await runTaskFlow(trimmed);
      return;
    }
    if (command?.kind === "recall") {
      const hits = await fetchNotes(command.query, 5);
      if (hits.length === 0) {
        busy.current = true;
        try {
          await addLocal({ t: Date.now(), role: "user", content: trimmed, who: "user" });
          await addLocal({
            t: Date.now(),
            role: "assistant",
            content: `I don't have a note about ${command.query}.`,
            who: "preyas",
            model: "preyas",
          });
        } finally {
          busy.current = false;
        }
        return;
      }
    }
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
      void remember(userMsg, chatId);
    }
    if (isCurrent()) setNote("");
    try {
      let route = chooseRoute({
        askPaid,
        localFailed: false,
        paidAvailable: paid.available && paidButton({ available: paid.available, offPeakOnly: paid.offPeakOnly, now: new Date(), downReason: paid.reason }).enabled,
        allowPaidOnFailure: escalate,
      });
      if (isCurrent() && askPaid && !route.reason.startsWith("you")) {
        setNote(paidButton({ available: paid.available, offPeakOnly: paid.offPeakOnly, now: new Date(), downReason: paid.reason }).reason);
      }
      if (!askPaid) {
        let sources: SearchResult[] = [];
        let searchQuery = "";
        if (needsWebSearch(trimmed)) {
          const found = await runWebSearch(trimmed);
          sources = found.results;
          searchQuery = found.query;
          if (!sources.length && isCurrent()) setChip("Web search found nothing");
        }
        const think = thinkForced || wantsThinking(trimmed);
        if (think && isCurrent()) setThinking(true);
        const local = await ask("local", history, trimmed, isCurrent, sources, searchQuery, think).finally(() => {
          if (isCurrent()) setThinking(false);
        });
        const cleaned = splitPaidHint(local.text);
        if (isCurrent() && cleaned.suggestPaid) setHintPaid(true);
        if (local.ok) {
          const reply: Shown = {
            t: Date.now(),
            role: "assistant",
            content: cleaned.text,
            who: "preyas",
            model: "preyas",
            thinking: local.thinking || undefined,
            sources: sources.length ? sources : undefined,
          };
          void remember(reply, chatId);
          if (isCurrent()) {
            messagesRef.current = [...messagesRef.current, reply];
            setMessages(messagesRef.current);
          }
          scheduleNotesCheck();
          return;
        }
        if (!isCurrent()) return;
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
      const paidReply = await ask("paid", history, trimmed, isCurrent);
      if (!paidReply.ok) {
        if (isCurrent()) setNote(paidReply.error || "The paid model didn't answer.");
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
      void remember(paidMsg, chatId);
      if (isCurrent()) {
        messagesRef.current = [...messagesRef.current, paidMsg];
        setMessages(messagesRef.current);
      }
      scheduleNotesCheck();
      const reactionHistory: ChatMessage[] = [...history, userMsg, paidMsg];
      const reaction = await ask(
        "local",
        reactionHistory,
        "In one or two sentences, react to what the paid model just said. Stay in your voice.",
        isCurrent,
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
        void remember(reply, chatId);
        if (isCurrent()) {
          messagesRef.current = [...messagesRef.current, reply];
          setMessages(messagesRef.current);
        }
        scheduleNotesCheck();
      }
    } finally {
      bag.thinking = false;
      busy.current = false;
    }
  }
  sendRef.current = send;
  const submitDraft = () => {
    const text = draft;
    if (!text.trim() || busy.current) return;
    setDraft("");
    void send(text, false);
  };
  const button = paidButton({
    available: paid.available,
    offPeakOnly: paid.offPeakOnly,
    now: new Date(),
    downReason: paid.reason,
  });
  const lastUser = [...messages].reverse().find((message) => message.who === "user");
  const go = (tab: "room" | "body" | "bench") => {
    onNavigate?.(tab);
  };
  async function openChat(id: string) {
    await loadChat(id);
    setDrawerOpen(false);
  }
  const nextReminder = pendingReminder;
  const confirmDialog = dialog
    ? dialog.kind === "remind"
      ? {
          title: `Remind you ${dialog.pending.label}: ${dialog.pending.text}?`,
          body: null as string | null,
          confirm: "Yes",
          no: "Change",
          danger: false,
          run: () => {
            const pending = dialog.pending;
            setDialog(null);
            setPendingReminder(null);
            void saveReminder(pending, activeIdRef.current);
            void addLocal({
              t: Date.now(),
              role: "assistant",
              content: `Reminder set for ${pending.label}.`,
              who: "preyas",
              model: "preyas",
            });
          },
        }
      : dialog.kind === "deleteDeck"
        ? {
            title: `Delete "${dialog.title}"?`,
            body: "The cards and your review history for this deck are removed. This cannot be undone.",
            confirm: "Yes",
            no: "No",
            danger: true,
            run: () => {
              const id = dialog.id;
              setDialog(null);
              void (async () => {
                try {
                  await brainFetch(`${bag.brainUrl}/v1/study/decks/${encodeURIComponent(id)}`, { method: "DELETE" });
                } catch {
                  /* the row goes away locally either way */
                }
                void refreshDecks();
              })();
            },
          }
        : dialog.kind === "briefingTime"
        ? {
            title: `Briefing at ${dialog.time}?`,
            body: "I will send your day each morning at this time.",
            confirm: "Yes",
            no: "No",
            danger: false,
            run: () => {
              setDialog(null);
              void saveBriefingSettings({ briefingTime: dialog.time, briefingOn: true });
            },
          }
        : dialog.kind === "briefingOff"
          ? {
              title: "Turn off the daily briefing?",
              body: "You can still ask for one any time with /briefing.",
              confirm: "Yes",
              no: "No",
              danger: true,
              run: () => {
                setDialog(null);
                void saveBriefingSettings({ briefingOn: false });
              },
            }
          : dialog.kind === "restart"
        ? {
            title: "Restart Preyas?",
            body: "Stops and starts the brain, model and web app. Takes about a minute.",
            confirm: "Yes",
            no: "No",
            danger: true,
            run: () => {
              setDialog(null);
              void restartPreyas();
            },
          }
        : dialog.kind === "deleteReminders"
        ? {
            title: `Cancel ${dialog.reminders.length} reminder${dialog.reminders.length === 1 ? "" : "s"}?`,
            body: dialog.reminders.map((row) => `- ${row.text}`).join("\n"),
            confirm: "Yes",
            no: "No",
            danger: true,
            run: () => {
              for (const row of dialog.reminders) {
                void brainFetch(`${bag.brainUrl}/v1/reminders/${encodeURIComponent(row.id)}`, { method: "DELETE" });
              }
              setDialog(null);
              void refreshReminders();
            },
          }
        : dialog.kind === "rename"
      ? {
          title: "Rename chat",
          body: null as string | null,
          confirm: "Save",
          no: "Cancel",
          danger: false,
          run: () => void saveRename(dialog.id, dialog.value),
        }
      : dialog.kind === "delete"
        ? {
            title: "Are you sure?",
            body: `Delete "${dialog.title}"? This cannot be undone.`,
            confirm: "Delete",
            no: "Cancel",
            danger: true,
            run: () => void removeChat(dialog.id),
          }
        : dialog.kind === "deleteNote"
          ? (() => {
              const card = confirmFor({ kind: "delete_notes", count: 1 });
              return {
                title: card.title,
                body: `Delete this note?\n\n${dialog.text}`,
                confirm: card.yes,
                no: card.no,
                danger: card.danger,
                run: () => void removeNote(dialog.id),
              };
            })()
          : dialog.kind === "paid"
            ? (() => {
                const card = confirmFor({ kind: "paid", promptChars: dialog.text.length });
                return {
                  title: card.title,
                  body: card.body,
                  confirm: card.yes,
                  no: card.no,
                  danger: card.danger,
                  run: () => void send(dialog.text, true),
                };
              })()
            : (() => {
                const card = confirmFor({ kind: "delete_notes", count: dialog.notes.length });
                return {
                  title: card.title,
                  body: `${card.body}\n\n${dialog.notes.map((note) => `- ${note.text}`).join("\n")}`,
                  confirm: card.yes,
                  no: card.no,
                  danger: card.danger,
                  run: () => void forgetNotes(dialog.notes),
                };
              })()
    : null;
  const chatList = (withClose: boolean) => (
    <View style={styles.sidebarInner}>
      <View style={styles.sidebarHead}>
        <Text style={styles.sidebarTitle}>CHATS</Text>
        {withClose ? (
          <Pressable onPress={() => setDrawerOpen(false)} hitSlop={8}>
            <Text style={styles.sidebarClose}>✕</Text>
          </Pressable>
        ) : null}
      </View>
      <Pressable style={styles.newChat} onPress={() => void newChat()}>
        <Text style={styles.newChatText}>+ New chat</Text>
      </Pressable>
      <ScrollView style={styles.chatList} contentContainerStyle={styles.chatListInner}>
        {chats.map((chat) => (
          <View key={chat.id} style={[styles.chatRow, chat.id === activeChatId && styles.chatRowOn]}>
            <Pressable style={styles.chatRowMain} onPress={() => void openChat(chat.id)}>
              <Text style={styles.chatRowTitle} numberOfLines={1}>
                {chat.title}
              </Text>
              <Text style={styles.chatRowDate}>{dayLabel(chat.updated)}</Text>
            </Pressable>
            <Pressable
              style={styles.chatRowIcon}
              hitSlop={6}
              onPress={() => setDialog({ kind: "rename", id: chat.id, value: chat.title })}
            >
              <Text style={styles.chatRowIconText}>✎</Text>
            </Pressable>
            <Pressable
              style={styles.chatRowIcon}
              hitSlop={6}
              onPress={() => setDialog({ kind: "delete", id: chat.id, title: chat.title })}
            >
              <Text style={styles.chatRowIconText}>🗑</Text>
            </Pressable>
          </View>
        ))}
        {chats.length === 0 ? <Text style={styles.chatEmpty}>No chats yet.</Text> : null}
      </ScrollView>
    </View>
  );
  return (
    <View style={styles.root}>
      <VoiceSession sinks={bag} />
      {section === "settings" ? (
        <ScrollView style={styles.fill} contentContainerStyle={styles.pad}>
          <Text style={styles.sectionTitle}>Settings</Text>
          <Text style={styles.kicker}>STATUS</Text>
          {health ? (
            <View style={styles.healthList}>
              {Object.entries(health.parts).map(([key, part]) => (
                <View key={key} style={styles.healthRow}>
                  <View style={[styles.dot, part.ok ? styles.dotOn : styles.dotOff]} />
                  <Text style={styles.healthLabel}>{part.label}</Text>
                  <Text style={styles.healthDetail}>{part.detail}</Text>
                </View>
              ))}
              <Text style={styles.dim}>
                Drive: {health.drive?.mounted ? `mounted, ${health.drive.freeGb ?? "?"} GB free` : "not mounted"}
                {health.memory?.swapUsedMb != null ? ` · swap ${health.memory.swapUsedMb} MB` : ""}
              </Text>
            </View>
          ) : (
            <Text style={styles.dim}>Checking…</Text>
          )}
          <Pressable
            style={styles.profileBtn}
            onPress={() => {
              void refreshHealth();
              void refreshPhone();
            }}
          >
            <Text style={styles.profileText}>Refresh</Text>
          </Pressable>
          <View style={styles.phoneCard}>
            <Text style={styles.kicker}>OPEN ON IPHONE</Text>
            {phoneInfo?.phoneUrl ? (
              <>
                <Text style={styles.phoneUrl} selectable>
                  {phoneInfo.phoneUrl}
                </Text>
                <Text style={styles.dim}>
                  Same Wi-Fi. First visit asks for this code: {phoneInfo.pairingCode}
                </Text>
                <Text style={styles.dim}>{phoneInfo.devices} paired device(s)</Text>
              </>
            ) : (
              <Text style={styles.dim}>No Wi-Fi address yet; connect the Mac to a network.</Text>
            )}
          </View>
          <View style={styles.phoneCard}>
            <Text style={styles.kicker}>DAILY BRIEFING</Text>
            <View style={styles.briefingRow}>
              <Switch
                value={briefingSettings?.briefingOn ?? true}
                onValueChange={(on) => void saveBriefingSettings({ briefingOn: on })}
              />
              <Text style={styles.dim}>
                Every morning at {briefingSettings?.briefingTime ?? "08:00"}
              </Text>
            </View>
            <Pressable style={styles.profileBtn} onPress={() => void runBriefingNow(activeIdRef.current)}>
              <Text style={styles.profileText}>Send it now</Text>
            </Pressable>
            <Text style={styles.dim}>To change the time, tell Preyas: "briefing at 7:30".</Text>
          </View>
          <Pressable
            style={[styles.profileBtn, styles.restartBtn]}
            onPress={() => setDialog({ kind: "restart" })}
          >
            <Text style={styles.modalDanger}>Restart Preyas</Text>
          </Pressable>
          <View style={styles.phoneCard}>
            <Text style={styles.kicker}>ADVANCED</Text>
            <View style={styles.advRow}>
              <Pressable onPress={() => go("room")}><Text style={styles.advLink}>Preyas' room</Text></Pressable>
              <Pressable onPress={() => go("body")}><Text style={styles.advLink}>Body</Text></Pressable>
              <Pressable onPress={() => go("bench")}><Text style={styles.advLink}>Benchmark</Text></Pressable>
            </View>
          </View>
        </ScrollView>
      ) : section === "learn" ? (
        <ScrollView style={styles.fill} contentContainerStyle={styles.pad}>
          <Text style={styles.sectionTitle}>Learn</Text>
          <Text style={styles.dim}>{MAIN_TABS[1]!.empty}</Text>
          {decks.length === 0 ? (
            <View style={styles.emptyTab}>
              <Text style={styles.dim}>{MAIN_TABS[1]!.example}</Text>
            </View>
          ) : null}
          {decks.map((deck) => (
            <View key={deck.id} style={styles.deckRow}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.deckTitle}>{deck.title}</Text>
                <Text style={styles.dim}>{deck.cards} cards · {deck.due} due{deck.language ? ` · ${deck.language}` : ""}</Text>
              </View>
              <Pressable style={styles.deckBtn} onPress={() => void startReview(deck.id, deck.title)}>
                <Text style={styles.deckBtnText}>Review</Text>
              </Pressable>
              <Pressable style={styles.deckBtn} onPress={() => void startQuiz(deck.id, deck.title)}>
                <Text style={styles.deckBtnText}>Quiz</Text>
              </Pressable>
              <Pressable hitSlop={6} onPress={() => setDialog({ kind: "deleteDeck", id: deck.id, title: deck.title })}>
                <Text style={styles.chatRowIconText}>🗑</Text>
              </Pressable>
            </View>
          ))}
        </ScrollView>
      ) : section === "memory" ? (
        <View style={styles.fill}>
          <View style={styles.memHead}>
            <Text style={styles.sectionTitle}>Memory</Text>
            <Text style={styles.dim}>{MAIN_TABS[2]!.empty}</Text>
            <TextInput
              style={styles.modalInput}
              value={notesQuery}
              onChangeText={setNotesQuery}
              placeholder="Search memory…"
              placeholderTextColor={theme.faint}
              onSubmitEditing={() => {
                setMemFilter("notes");
                void refreshNotes(notesQuery);
              }}
              returnKeyType="search"
            />
            <View style={styles.chips}>
              {(["all", "notes", "reminders", "docs"] as const).map((filter) => (
                <Pressable
                  key={filter}
                  style={[styles.chip, memFilter === filter && styles.chipHint]}
                  onPress={() => {
                    setMemFilter(filter);
                    if (filter === "notes" || filter === "all") void refreshNotes(notesQuery);
                  }}
                >
                  <Text style={styles.chipText}>{filter === "all" ? "All" : filter === "notes" ? "Notes" : filter === "reminders" ? "Reminders" : "Documents"}</Text>
                </Pressable>
              ))}
            </View>
          </View>
          <ScrollView style={styles.fill} contentContainerStyle={styles.pad}>
            {(memFilter === "all" || memFilter === "notes") ? (
              <>
                {notesList.length === 0 && memFilter === "notes" ? (
                  <Text style={styles.dim}>{MAIN_TABS[2]!.example}</Text>
                ) : null}
                {notesList.map((noteRow) => (
                  <View key={noteRow.id} style={styles.noteRow}>
                    {editing?.id === noteRow.id ? (
                      <View style={styles.noteEditing}>
                        <TextInput style={styles.modalInput} value={editing.text} onChangeText={(text) => setEditing({ ...editing, text })} multiline />
                        <View style={styles.kindRow}>
                          {NOTE_KINDS.map((kind) => (
                            <Pressable key={kind} style={[styles.kindChip, editing.kind === kind && styles.kindChipOn]} onPress={() => setEditing({ ...editing, kind })}>
                              <Text style={styles.kindText}>{kind}</Text>
                            </Pressable>
                          ))}
                        </View>
                        <View style={styles.noteActions}>
                          <Pressable onPress={() => setEditing(null)}><Text style={styles.modalCancel}>Cancel</Text></Pressable>
                          <Pressable onPress={() => void saveEditing()}><Text style={styles.modalOk}>Save</Text></Pressable>
                        </View>
                      </View>
                    ) : (
                      <>
                        <Pressable style={styles.noteMain} onPress={() => setEditing({ id: noteRow.id, text: noteRow.text, kind: noteRow.kind })}>
                          <Text style={styles.noteKind}>{noteRow.kind}</Text>
                          <Text style={styles.noteText}>{noteRow.text}</Text>
                        </Pressable>
                        <Pressable hitSlop={6} onPress={() => setDialog({ kind: "deleteNote", id: noteRow.id, text: noteRow.text })}>
                          <Text style={styles.chatRowIconText}>🗑</Text>
                        </Pressable>
                      </>
                    )}
                  </View>
                ))}
              </>
            ) : null}
            {(memFilter === "all" || memFilter === "reminders") ? (
              <>
                {reminders.filter((row) => row.status !== "done").length === 0 && memFilter === "reminders" ? (
                  <Text style={styles.dim}>No reminders. Tell Preyas: "remind me to call mum at 6".</Text>
                ) : null}
                {reminders.filter((row) => row.status !== "done").map((row) => (
                  <View key={row.id} style={styles.noteRow}>
                    <View style={styles.noteMain}>
                      <Text style={styles.noteKind}>
                        {formatDue(new Date(row.dueAt))}
                        {row.repeat !== "none" ? ` · ${row.repeat}` : ""}
                      </Text>
                      <Text style={styles.noteText}>{row.text}</Text>
                    </View>
                    <Pressable hitSlop={6} onPress={() => void updateReminder(row.id, { action: "done" })}>
                      <Text style={styles.deckBtnText}>Done</Text>
                    </Pressable>
                    <Pressable hitSlop={6} onPress={() => void updateReminder(row.id, { action: "snooze", snooze: "10m" })}>
                      <Text style={styles.dim}>+10m</Text>
                    </Pressable>
                  </View>
                ))}
              </>
            ) : null}
            {(memFilter === "all" || memFilter === "docs") ? (
              <>
                {inbox.length === 0 && memFilter === "docs" ? (
                  <Text style={styles.dim}>
                    No documents yet. Drop a PDF or text file into the inbox folder{inboxPath ? ` (${inboxPath})` : ""} and ask Preyas to read it.
                  </Text>
                ) : null}
                {inbox.map((file) => (
                  <View key={file.name} style={styles.noteRow}>
                    <View style={styles.noteMain}>
                      <Text style={styles.noteKind}>{file.type} · {Math.max(1, Math.round(file.size / 1024))} KB</Text>
                      <Text style={styles.noteText} numberOfLines={2}>{file.name}</Text>
                    </View>
                    <Pressable
                      hitSlop={6}
                      onPress={() => {
                        onSection?.("chat");
                        void send(`summarize ${file.name}`, false);
                      }}
                    >
                      <Text style={styles.deckBtnText}>Summarize</Text>
                    </Pressable>
                  </View>
                ))}
              </>
            ) : null}
            {memFilter === "all" && notesList.length === 0 && reminders.length === 0 && inbox.length === 0 ? (
              <Text style={styles.dim}>{MAIN_TABS[2]!.example}</Text>
            ) : null}
          </ScrollView>
        </View>
      ) : (
        <View style={[styles.split, !wide && styles.stack]}>
          {wide ? (
          <View style={styles.left}>
            <PreyasHero talking={phase === "speaking"} short={false} />
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
          </View>
          ) : null}
          <View style={styles.chatCard}>
            {wide ? <View style={styles.sidebar}>{chatList(false)}</View> : null}
            <View style={styles.thread}>
            <View style={styles.chatHead}>
              {!wide ? (
                <Pressable style={styles.drawerBtn} onPress={() => setDrawerOpen(true)} hitSlop={8}>
                  <Text style={styles.drawerBtnText}>☰</Text>
                </Pressable>
              ) : null}
              <Pressable onPress={() => setProfile(true)} hitSlop={6} accessibilityLabel="Preyas profile">
                <View style={styles.miniBall} />
              </Pressable>
              <View style={styles.chatHeadText}>
                <Text style={styles.chatName}>Preyas</Text>
                <Text style={styles.subtitle}>{online ? "Here with you" : "Offline"} · level {partner.level}</Text>
              </View>
              <View style={styles.onlineRow}>
                <View style={[styles.dot, online ? styles.dotOn : styles.dotOff]} />
                <Text style={styles.online}>{online ? "Online" : "Offline"}</Text>
              </View>
              <Pressable style={styles.gearBtn} onPress={() => onSection?.("settings")} hitSlop={8} accessibilityLabel="Settings">
                <Text style={styles.gearText}>⚙</Text>
              </Pressable>
            </View>
            {briefing && !briefingDismissed ? (
              <View style={styles.briefingCard}>
                <View style={styles.briefingCardHead}>
                  <Text style={styles.briefingTitle}>Your day</Text>
                  <Pressable onPress={() => setBriefingDismissed(true)} hitSlop={8} accessibilityLabel="Dismiss briefing">
                    <Text style={styles.sidebarClose}>✕</Text>
                  </Pressable>
                </View>
                <Text style={styles.bubbleText}>{briefing}</Text>
              </View>
            ) : null}
            <View style={styles.logWrap}>
              <ScrollView
                ref={logRef}
                style={styles.log}
                contentContainerStyle={styles.logInner}
                horizontal={false}
                showsHorizontalScrollIndicator={false}
                onScroll={onLogScroll}
                scrollEventThrottle={16}
                onContentSizeChange={() => {
                  if (pinned.current) scrollToLatest();
                }}
              >
              {messages.length === 0 && !live ? (
                <View style={styles.emptyChat}>
                  <Text style={styles.emptyTitle}>Say hi to Preyas.</Text>
                  <Text style={styles.emptyText}>{MAIN_TABS[0]!.empty}</Text>
                  <Text style={styles.emptyText}>{MAIN_TABS[0]!.example}</Text>
                </View>
              ) : null}
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
                      {message.briefing ? (
                        <View style={styles.briefingCard}>
                          <Text style={styles.briefingTitle}>Your day</Text>
                          <Text style={styles.briefingText}>{message.content}</Text>
                          <View style={styles.briefingActions}>
                            <Pressable
                              style={styles.docBtn}
                              onPress={() => onSection?.("settings")}
                            >
                              <Text style={styles.docBtnText}>Open settings</Text>
                            </Pressable>
                            <Pressable
                              style={styles.docBtn}
                              onPress={() => {
                                onSection?.("memory");
                                setMemFilter("reminders");
                              }}
                            >
                              <Text style={styles.docBtnText}>Open reminders</Text>
                            </Pressable>
                          </View>
                        </View>
                      ) : null}
                      {message.document?.summary ? (
                        <Pressable
                          style={styles.savePoints}
                          onPress={() => void saveKeyPoints(message.document!.name, message.document!.points || [])}
                        >
                          <Text style={styles.savePointsText}>Save key points to notes</Text>
                        </Pressable>
                      ) : null}
                      {message.sources?.length ? (
                        <View style={styles.sources}>
                          {message.sources.map((source, sourceIndex) => (
                            <Pressable
                              key={`${source.url}-${sourceIndex}`}
                              onPress={() => {
                                if (typeof window !== "undefined" && window.open) window.open(source.url, "_blank", "noopener");
                              }}
                            >
                              <Text style={styles.sourceLink} numberOfLines={1}>
                                [{sourceIndex + 1}] {source.title}
                              </Text>
                            </Pressable>
                          ))}
                        </View>
                      ) : null}
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
              {thinking ? (
                <Text style={styles.typing}>Preyas is thinking…</Text>
              ) : docBusy ? (
                <Text style={styles.typing}>
                  {docProgress || `Reading ${docBusy}…`}
                </Text>
              ) : searching ? (
                <Text style={styles.typing}>Searching the web…</Text>
              ) : phase === "thinking" && !live ? (
                <Text style={styles.typing}>Preyas is thinking…</Text>
              ) : null}
              {searchNote && !searching ? <Text style={styles.note}>{searchNote}</Text> : null}
              {note ? <Text style={styles.note}>{note}</Text> : null}
              {task ? (
                <View style={styles.taskCard}>
                  <Text style={styles.taskStatus}>{taskStatusLine(task)}</Text>
                  {task.steps.map((step) => (
                    <View key={step.id} style={styles.stepRow}>
                      <Pressable onPress={() => setOpenSteps((open) => ({ ...open, [step.id]: !open[step.id] }))}>
                        <Text style={styles.stepTitle}>
                          {step.status === "done" ? "✓" : step.status === "running" ? "…" : step.status === "error" ? "!" : "•"}{" "}
                          {step.id}. {step.text}
                        </Text>
                      </Pressable>
                      {openSteps[step.id] && step.result ? (
                        <Text style={styles.stepResult}>{step.result}</Text>
                      ) : null}
                    </View>
                  ))}
                  {task.status === "paused" || task.status === "error" ? (
                    <Pressable style={styles.resumeBtn} onPress={() => void resumeTask(task.id)}>
                      <Text style={styles.resumeText}>Resume</Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : null}
            </ScrollView>
              {jumpVisible ? (
                <View style={styles.jumpWrap} pointerEvents="box-none">
                  <Pressable style={styles.jump} onPress={jumpToLatest}>
                    <Text style={styles.jumpText}>Jump to latest ↓</Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
            {chip ? (
              <View style={styles.chipSaved}>
                <Text style={styles.chipSavedText}>✓ {chip}</Text>
              </View>
            ) : null}
            <View style={styles.composer}>
              <TextInput
                value={draft}
                onChangeText={setDraft}
                placeholder="Message Preyas..."
                placeholderTextColor="#6d857c"
                style={styles.input}
                onSubmitEditing={submitDraft}
              />
              <Pressable onPress={() => setDraft((value) => `${value}💧 `)}><Text style={styles.emoji}>☺</Text></Pressable>
              {micOk ? (
                <Pressable
                  style={styles.mic}
                  onPress={() => {
                    if (bag.playing) interruptTalk(bag);
                  }}
                >
                  <Text style={styles.micText}>{phase}</Text>
                </Pressable>
              ) : null}
              <Pressable
                style={[styles.thinkBtn, thinkForced && styles.thinkBtnOn]}
                onPress={() => setThinkForced((on) => !on)}
                accessibilityLabel={thinkForced ? "Thinking on" : "Thinking off"}
              >
                <Text style={styles.thinkBtnText}>🧠</Text>
              </Pressable>
              <Pressable
                style={styles.send}
                onPress={submitDraft}
              >
                <Text style={styles.sendText}>➤</Text>
              </Pressable>
            </View>
            {!micOk ? <Text style={styles.voiceHint}>Voice works on the Mac; type here</Text> : null}
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
                  if (lastUser) setDialog({ kind: "paid", text: lastUser.content });
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
        </View>
      )}
      {!wide && drawerOpen ? (
        <View style={styles.drawerWrap}>
          <Pressable style={styles.scrim} onPress={() => setDrawerOpen(false)} />
          <View style={styles.drawer}>{chatList(true)}</View>
        </View>
      ) : null}
      {review ? (
        <View style={styles.modalWrap}>
          <View style={styles.modal}>
            <Text style={styles.sidebarTitle}>
              {review.title} · {review.index + 1} of {review.cards.length}
            </Text>
            <Text style={styles.reviewQuestion}>{review.cards[review.index]?.question}</Text>
            {review.flipped ? (
              <Text style={styles.reviewAnswer}>{review.cards[review.index]?.answer}</Text>
            ) : null}
            {!review.flipped ? (
              <Pressable
                style={styles.newChat}
                onPress={() => setReview({ ...review, flipped: true })}
              >
                <Text style={styles.newChatText}>Show answer</Text>
              </Pressable>
            ) : (
              <View style={styles.gradeRow}>
                <Pressable style={[styles.docBtn, styles.gradeAgain]} onPress={() => void gradeReview("again")}>
                  <Text style={styles.docBtnText}>Again</Text>
                </Pressable>
                <Pressable style={styles.docBtn} onPress={() => void gradeReview("hard")}>
                  <Text style={styles.docBtnText}>Hard</Text>
                </Pressable>
                <Pressable style={styles.docBtn} onPress={() => void gradeReview("good")}>
                  <Text style={styles.docBtnText}>Good</Text>
                </Pressable>
                <Pressable style={styles.docBtn} onPress={() => void gradeReview("easy")}>
                  <Text style={styles.docBtnText}>Easy</Text>
                </Pressable>
              </View>
            )}
            <View style={styles.modalRow}>
              <Pressable onPress={() => setReview(null)}>
                <Text style={styles.modalCancel}>Stop</Text>
              </Pressable>
            </View>
          </View>
        </View>
      ) : null}
      {quiz ? (
        <View style={styles.modalWrap}>
          <View style={styles.modal}>
            <Text style={styles.sidebarTitle}>
              Quiz · {quiz.index + 1} of {quiz.questions.length}
            </Text>
            <Text style={styles.reviewQuestion}>{quiz.questions[quiz.index]?.question}</Text>
            {quiz.feedback ? <Text style={styles.note}>{quiz.feedback}</Text> : null}
            {quiz.questions[quiz.index]?.options.length ? (
              <View style={styles.quizOptions}>
                {quiz.questions[quiz.index]!.options.map((option) => (
                  <Pressable key={option} style={styles.docChoice} onPress={() => void answerQuiz(option)}>
                    <Text style={styles.noteText}>{option}</Text>
                  </Pressable>
                ))}
              </View>
            ) : (
              <TextInput
                value={quiz.typed}
                onChangeText={(value) => setQuiz({ ...quiz, typed: value })}
                placeholder="Your answer"
                placeholderTextColor="#6d857c"
                style={styles.modalInput}
                onSubmitEditing={() => void answerQuiz(quiz.typed)}
              />
            )}
            <View style={styles.modalRow}>
              <Pressable onPress={() => setQuiz(null)}>
                <Text style={styles.modalCancel}>Stop</Text>
              </Pressable>
              {quiz.feedback ? (
                <Pressable onPress={() => void nextQuizQuestion()}>
                  <Text style={styles.modalOk}>Next</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        </View>
      ) : null}
      {nextReminder ? (
        <View style={styles.reminderBanner}>
          <Text style={styles.reminderBannerText}>
            Reminder: {nextReminder.text} · {nextReminder.label}
          </Text>
          <Pressable onPress={() => setPendingReminder(null)}>
            <Text style={styles.sidebarClose}>✕</Text>
          </Pressable>
        </View>
      ) : null}
      {docChoice ? (
        <View style={styles.modalWrap}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>Which document?</Text>
            {docChoice.matches.map((name) => (
              <Pressable
                key={name}
                style={styles.docChoice}
                onPress={() => {
                  const raw = docChoice.name;
                  setDocChoice(null);
                  void send(`summarize ${name}`, false);
                  void raw;
                }}
              >
                <Text style={styles.noteText}>{name}</Text>
              </Pressable>
            ))}
            <View style={styles.modalRow}>
              <Pressable onPress={() => setDocChoice(null)}>
                <Text style={styles.modalCancel}>Cancel</Text>
              </Pressable>
            </View>
          </View>
        </View>
      ) : null}
      {confirmDialog ? (
        <View style={styles.modalWrap}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>{confirmDialog.title}</Text>
            {dialog?.kind === "rename" ? (
              <TextInput
                value={dialog.value}
                onChangeText={(value) => setDialog({ kind: "rename", id: dialog.id, value })}
                style={styles.modalInput}
                autoFocus
                onSubmitEditing={() => confirmDialog.run()}
              />
            ) : (
              <Text style={styles.modalBody}>{confirmDialog.body}</Text>
            )}
            <View style={styles.modalRow}>
              <Pressable onPress={() => setDialog(null)}>
                <Text style={styles.modalCancel}>{confirmDialog.no}</Text>
              </Pressable>
              <Pressable onPress={confirmDialog.run}>
                <Text style={[styles.modalOk, confirmDialog.danger && styles.modalDanger]}>
                  {confirmDialog.confirm}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      ) : null}
      {needPair ? (
        <View style={styles.modalWrap}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>Pair this phone</Text>
            <Text style={styles.modalBody}>
              Enter the 6-digit code shown on the Mac, under Settings → Open on iPhone.
            </Text>
            <TextInput
              value={pairCode}
              onChangeText={(value) => {
                const clean = normalizePairingCode(value);
                setPairCode(clean);
                setPairError("");
                if (clean.length === 6) void submitPairing();
              }}
              placeholder="123456"
              placeholderTextColor="#6d857c"
              keyboardType="number-pad"
              maxLength={6}
              style={[styles.modalInput, styles.pairInput]}
            />
            {pairError ? <Text style={styles.note}>{pairError}</Text> : null}
            <View style={styles.modalRow}>
              <Pressable onPress={() => void submitPairing()}>
                <Text style={styles.modalOk}>Pair</Text>
              </Pressable>
            </View>
          </View>
        </View>
      ) : null}
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
const aqua = theme.accent;
const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#07100d",
    // Belt and braces: no child may widen the page, so it never scrolls sideways.
    overflow: "hidden",
    maxWidth: "100%",
    paddingTop: "env(safe-area-inset-top)" as unknown as number,
    paddingBottom: "env(safe-area-inset-bottom)" as unknown as number,
  },
  voiceHint: { color: "#8aa89b", fontSize: 11, marginTop: 6, textAlign: "center", width: "100%" },
  pairInput: { fontSize: 24, letterSpacing: 6, textAlign: "center" },
  split: { flex: 1, flexDirection: "row", padding: 16, gap: 16, minWidth: 0, maxWidth: "100%" },
  stack: { flexDirection: "column" },
  left: { flex: 1, gap: 8 },
  kicker: { color: "#8aa89b", fontSize: 11, letterSpacing: 1.6, marginTop: 8 },
  bigName: { color: "#eaf7f1", fontSize: 36, fontWeight: "800", letterSpacing: 1 },
  tagline: { color: "#b3c8bf", fontSize: 14 },
  pills: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 6 },
  pill: { color: "#d2efe2", borderWidth: 1, borderColor: "rgba(67,217,173,0.35)", borderRadius: 16, paddingHorizontal: 10, paddingVertical: 6, fontSize: 12 },
  bondCard: { marginTop: 8, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: "rgba(67,217,173,0.28)", backgroundColor: "#0c1613" },
  bondHead: { flexDirection: "row", justifyContent: "space-between" },
  bondTitle: { color: "#e4f5ec", fontWeight: "700" },
  bondPct: { color: aqua, fontWeight: "700" },
  track: { height: 8, borderRadius: 4, backgroundColor: "#18251f", marginTop: 8, overflow: "hidden" },
  fillBar: { height: 8, backgroundColor: aqua },
  caption: { color: "#8aa89b", fontSize: 12, marginTop: 6 },
  profileBtn: { marginTop: 8, alignSelf: "flex-start", borderWidth: 1, borderColor: "rgba(67,217,173,0.4)", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  profileText: { color: aqua, fontWeight: "700" },
  chatCard: { flex: 1.2, flexDirection: "row", gap: 12, borderWidth: 1, borderColor: "rgba(67,217,173,0.22)", borderRadius: 18, backgroundColor: "#0a1310", padding: 12, minHeight: 320, minWidth: 0, maxWidth: "100%" },
  thread: { flex: 1, minWidth: 0 },
  sidebar: { width: 210, borderRightWidth: 1, borderRightColor: "rgba(67,217,173,0.16)", paddingRight: 10 },
  sidebarInner: { flex: 1, gap: 8 },
  sidebarHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sidebarTitle: { color: "#8aa89b", fontSize: 11, letterSpacing: 1.6 },
  sidebarClose: { color: "#93aca2", fontSize: 16, paddingHorizontal: 4 },
  newChat: { borderWidth: 1, borderColor: "rgba(67,217,173,0.45)", borderRadius: 12, paddingVertical: 8, alignItems: "center" },
  newChatText: { color: aqua, fontSize: 13, fontWeight: "700" },
  chatList: { flex: 1 },
  chatListInner: { gap: 4, paddingBottom: 8 },
  chatRow: { flexDirection: "row", alignItems: "center", borderRadius: 10, paddingHorizontal: 6, paddingVertical: 6, gap: 2 },
  chatRowOn: { backgroundColor: "rgba(67,217,173,0.12)" },
  chatRowMain: { flex: 1, minWidth: 0 },
  chatRowTitle: { color: "#e2f4ea", fontSize: 13, fontWeight: "600" },
  chatRowDate: { color: "#7e988d", fontSize: 11, marginTop: 1 },
  chatRowIcon: { paddingHorizontal: 3 },
  chatRowIconText: { color: "#93aca2", fontSize: 13 },
  chatEmpty: { color: "#7e988d", fontSize: 12 },
  emptyChat: { alignItems: "center", paddingVertical: 36, paddingHorizontal: 20, gap: 6 },
  emptyTitle: { color: "#e4f5ec", fontSize: 16, fontWeight: "800" },
  emptyText: { color: "#8aa89b", fontSize: 13, lineHeight: 19, textAlign: "center" },
  chipSaved: { alignSelf: "flex-start", borderWidth: 1, borderColor: "rgba(61,222,138,0.5)", backgroundColor: "rgba(61,222,138,0.12)", borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4, marginBottom: 6 },
  chipSavedText: { color: "#8ff0bd", fontSize: 12, fontWeight: "700" },
  noteRow: { flexDirection: "row", alignItems: "flex-start", gap: 6, borderWidth: 1, borderColor: "rgba(67,217,173,0.18)", borderRadius: 10, padding: 8 },
  noteEditing: { flex: 1, gap: 6 },
  kindRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  kindChip: { borderWidth: 1, borderColor: "rgba(67,217,173,0.3)", borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  kindChipOn: { backgroundColor: "rgba(67,217,173,0.2)" },
  kindText: { color: "#d2efe2", fontSize: 11 },
  noteActions: { flexDirection: "row", justifyContent: "flex-end", gap: 14 },
  noteMain: { flex: 1, minWidth: 0 },
  noteKind: { color: aqua, fontSize: 10, letterSpacing: 1 },
  noteText: { color: "#e2f4ea", fontSize: 13, lineHeight: 18, marginTop: 2 },
  taskCard: { borderWidth: 1, borderColor: "rgba(67,217,173,0.3)", borderRadius: 12, backgroundColor: "#0c1613", padding: 10, gap: 6, marginTop: 6 },
  taskStatus: { color: aqua, fontSize: 12, fontWeight: "700" },
  stepRow: { gap: 2 },
  stepTitle: { color: "#d2efe2", fontSize: 13 },
  stepResult: { color: "#9fbcb0", fontSize: 12, lineHeight: 17, marginLeft: 14 },
  resumeBtn: { alignSelf: "flex-start", borderWidth: 1, borderColor: "rgba(67,217,173,0.5)", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4, marginTop: 2 },
  resumeText: { color: aqua, fontSize: 12, fontWeight: "700" },
  drawerBtn: { paddingHorizontal: 4, paddingVertical: 2 },
  drawerBtnText: { color: aqua, fontSize: 20 },
  drawerWrap: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 20, flexDirection: "row" },
  scrim: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.55)" },
  drawer: { width: 260, maxWidth: "82%", backgroundColor: "#0a1310", borderRightWidth: 1, borderRightColor: "rgba(67,217,173,0.3)", padding: 12, zIndex: 21 },
  modalWrap: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 30, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center", padding: 20 },
  modal: { width: "100%", maxWidth: 360, backgroundColor: "#0e1a16", borderWidth: 1, borderColor: "rgba(67,217,173,0.4)", borderRadius: 16, padding: 16, gap: 10 },
  modalTitle: { color: "#eaf7f1", fontSize: 16, fontWeight: "800" },
  modalBody: { color: "#b3c8bf", fontSize: 13, lineHeight: 19 },
  modalInput: { borderWidth: 1, borderColor: "rgba(67,217,173,0.35)", borderRadius: 10, color: "#eaf7f1", paddingHorizontal: 10, paddingVertical: 8, fontSize: 16 },
  modalRow: { flexDirection: "row", justifyContent: "flex-end", gap: 16, marginTop: 4 },
  modalCancel: { color: "#93aca2", fontWeight: "700" },
  modalOk: { color: aqua, fontWeight: "800" },
  modalDanger: { color: "#ff8a8a" },
  chatHead: { flexDirection: "row", alignItems: "center", gap: 10, paddingBottom: 8 },
  chatHeadText: { flex: 1 },
  chatName: { color: "#eaf7f1", fontWeight: "800", fontSize: 16 },
  subtitle: { color: "#8aa89b", fontSize: 12 },
  onlineRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  dotOn: { backgroundColor: "#3dde8a" },
  dotOff: { backgroundColor: "#5c7269" },
  online: { color: "#c5d8cf", fontSize: 12 },
  miniBall: { width: 28, height: 28, borderRadius: 14, backgroundColor: "#174033", borderWidth: 1, borderColor: aqua },
  log: { flex: 1, width: "100%" },
  logWrap: { flex: 1, position: "relative" },
  jumpWrap: { position: "absolute", left: 0, right: 0, bottom: 6, alignItems: "center" },
  jump: {
    borderWidth: 1,
    borderColor: "rgba(67,217,173,0.5)",
    backgroundColor: "#0f241d",
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  jumpText: { color: aqua, fontSize: 12, fontWeight: "700" },
  logInner: { gap: 10, paddingVertical: 8, width: "100%" },
  // A bubble is capped by the screen, never by a pixel width: 420px overflowed a
  // 390px phone. flexShrink lets the row give way instead of pushing sideways.
  bubbleWrap: { flexDirection: "row", alignItems: "flex-end", gap: 8, maxWidth: "82%", flexShrink: 1 },
  bubbleLeft: { alignSelf: "flex-start" },
  bubbleRight: { alignSelf: "flex-end" },
  bubble: { borderRadius: 14, paddingHorizontal: 12, paddingVertical: 8, maxWidth: "100%", flexShrink: 1 },
  bubbleHis: { backgroundColor: "#111c18", borderWidth: 1, borderColor: "rgba(67,217,173,0.18)" },
  bubbleMine: { backgroundColor: "#143b30" },
  bubbleWho: { color: aqua, fontSize: 11, fontWeight: "700", marginBottom: 2 },
  bubbleText: { color: "#e2f4ea", fontSize: 15, lineHeight: 21, flexShrink: 1 },
  time: { color: "#7e988d", fontSize: 11, marginTop: 4, textAlign: "right" },
  typing: { color: aqua, fontSize: 13, marginTop: 4 },
  sources: { marginTop: 6, gap: 2 },
  healthList: { gap: 8, marginVertical: 10 },
  briefingCard: { marginTop: 8, borderWidth: 1, borderColor: "rgba(67,217,173,0.35)", borderRadius: 12, backgroundColor: "#0c1613", padding: 10, gap: 6 },
  briefingTitle: { color: aqua, fontSize: 12, fontWeight: "700", letterSpacing: 1 },
  briefingText: { color: "#e2f4ea", fontSize: 13, lineHeight: 19 },
  briefingActions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  healthRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  healthLabel: { color: "#e2f4ea", fontSize: 14, width: 120 },
  healthDetail: { color: "#93aca2", fontSize: 12, flex: 1 },
  restartBtn: { borderColor: "rgba(255,138,138,0.5)", marginTop: 8 },
  phoneCard: { marginVertical: 10, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: "rgba(67,217,173,0.3)", backgroundColor: "#0c1613", gap: 6 },
  phoneUrl: { color: aqua, fontSize: 16, fontWeight: "700" },
  reviewQuestion: { color: "#eaf7f1", fontSize: 16, fontWeight: "700", lineHeight: 22 },
  reviewAnswer: { color: "#b3c8bf", fontSize: 14, lineHeight: 20 },
  gradeRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  gradeAgain: { borderColor: "rgba(255,138,138,0.6)" },
  quizOptions: { gap: 6 },
  reminderBanner: { position: "absolute", top: 56, left: 12, right: 12, zIndex: 15, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, borderWidth: 1, borderColor: "rgba(67,217,173,0.5)", backgroundColor: "#0f241d", borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 },
  reminderBannerText: { color: "#d2efe2", fontSize: 13, flex: 1 },
  docBtn: { borderWidth: 1, borderColor: "rgba(67,217,173,0.45)", borderRadius: 10, paddingHorizontal: 8, paddingVertical: 4 },
  docBtnText: { color: aqua, fontSize: 11, fontWeight: "700" },
  docChoice: { borderWidth: 1, borderColor: "rgba(67,217,173,0.3)", borderRadius: 10, padding: 8 },
  savePoints: { marginTop: 8, alignSelf: "flex-start", borderWidth: 1, borderColor: "rgba(61,222,138,0.5)", borderRadius: 12, paddingHorizontal: 10, paddingVertical: 5 },
  savePointsText: { color: "#8ff0bd", fontSize: 12, fontWeight: "700" },
  sourceLink: { color: "#8ff0d0", fontSize: 12, textDecorationLine: "underline" },
  thinkToggle: { color: "#7e988d", fontSize: 11, marginTop: 6 },
  thinkBody: { color: "#8aa89b", fontSize: 12, marginTop: 4 },
  note: { color: "#e2c27a", fontSize: 13 },
  composer: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderColor: "rgba(67,217,173,0.25)", borderRadius: 22, paddingHorizontal: 10, paddingVertical: 6 },
  input: { flex: 1, color: "#eaf7f1", paddingVertical: 8, fontSize: 16 },
  emoji: { color: aqua, fontSize: 18 },
  mic: { borderWidth: 1, borderColor: aqua, borderRadius: 12, paddingHorizontal: 8, paddingVertical: 4, minWidth: 72, minHeight: 44, justifyContent: "center" },
  micText: { color: "#d2efe2", fontSize: 11, textAlign: "center", textTransform: "capitalize" },
  thinkBtn: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: "rgba(67,217,173,0.35)", alignItems: "center", justifyContent: "center" },
  thinkBtnOn: { backgroundColor: "rgba(67,217,173,0.25)", borderColor: aqua },
  thinkBtnText: { fontSize: 15 },
  send: { width: 44, height: 44, borderRadius: 22, backgroundColor: "#1a7a63", alignItems: "center", justifyContent: "center" },
  sendText: { color: "#eaf7f1", fontSize: 16 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  chip: { borderWidth: 1, borderColor: "rgba(67,217,173,0.35)", borderRadius: 16, paddingHorizontal: 10, paddingVertical: 6 },
  chipOff: { opacity: 0.45 },
  chipHint: { backgroundColor: "rgba(67,217,173,0.15)" },
  chipText: { color: "#d2efe2", fontSize: 12 },
  footerRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", marginTop: 8, gap: 8 },
  footer: { color: "#8aa89b", fontSize: 12, flexShrink: 1 },
  switchRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  switchLabel: { color: "#8aa89b", fontSize: 11 },
  fill: { flex: 1 },
  pad: { padding: 20, gap: 8 },
  dim: { color: "#93aca2", fontSize: 14 },
  sheet: { position: "absolute", left: 24, right: 24, bottom: 24, backgroundColor: "#0e1a16", borderWidth: 1, borderColor: aqua, borderRadius: 16, padding: 16, gap: 8 },
  // One header per tab, one gear in the chat header.
  sectionTitle: { color: "#eaf7f1", fontSize: 18, fontWeight: "800" },
  gearBtn: { padding: 4 },
  gearText: { color: "#93aca2", fontSize: 18 },
  briefingCardHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  briefingRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  advRow: { flexDirection: "row", flexWrap: "wrap", gap: 16 },
  advLink: { color: aqua, fontSize: 14, fontWeight: "700", paddingVertical: 4 },
  memHead: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 4, gap: 8 },
  emptyTab: { marginTop: 16, alignItems: "center", gap: 6 },
  deckRow: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderColor: "rgba(67,217,173,0.18)", borderRadius: 12, padding: 10 },
  deckTitle: { color: "#e2f4ea", fontSize: 14, fontWeight: "700" },
  deckBtn: { borderWidth: 1, borderColor: "rgba(67,217,173,0.45)", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5 },
  deckBtnText: { color: aqua, fontSize: 12, fontWeight: "700" },
});
