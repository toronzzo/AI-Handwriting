import { useEffect, useRef, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  Image,
  Modal,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollViewInstance,
  type ViewStyle,
} from "react-native";
import {
  chatTarget,
  chooseRoute,
  deepseekIsPeak,
  LOCAL_TIMEOUT_MS,
  estimatePaidCost,
  paidButton,
  replySourceLabel,
  splitPaidHint,
  streamReply,
  toModelMessages,
  type ChatMessage,
} from "../../../../packages/alive/src/chatTurn.ts";
import { partnerFromProgress } from "../../../../packages/alive/src/rpgLevel.ts";
import type { MicPhase } from "../../../../packages/alive/src/speech.ts";
import { currentBrainUrl, readBrainHost } from "../room/brain/brainLink";
import { brainFetch, isUnauthorized, pairWithCode } from "../room/brain/token";
import { readProbe } from "../room/brain/probeJson";
import { probeThrownError } from "../settings/probe";
import { isValidPairingCode, microphoneAvailable, normalizePairingCode } from "../../../../packages/alive/src/phone.ts";
import { isWhisperHallucination, resetSpeech, takeTtsNotice, transcribeClip } from "../../../../packages/alive/src/speech.ts";
import { NOTE_KINDS, parseNoteCommand, type Note, type NoteKind } from "../../../../packages/alive/src/notes.ts";
import { looksLikeTask, taskStatusLine, type TaskRecord } from "../../../../packages/alive/src/tasks.ts";
import { confirmFor } from "../../../../packages/alive/src/confirm.ts";
import { isSessionWord, parseCoachIntent } from "../../../../packages/alive/src/coach.ts";
import { CoachChip, CoachPanel } from "../coach/CoachChip";
import { useCoach } from "../coach/useCoach";
import { matchDocuments, parseDocumentRequest } from "../../../../packages/alive/src/documents.ts";
import { formatDue, parseReminder, type Reminder } from "../../../../packages/alive/src/reminders.ts";
import { isShortAffirmation, wantsThinking } from "../../../../packages/alive/src/chatTurn.ts";
import { HUGE_TIMEOUT_MS, MODEL_LABELS, SWITCHING_CHAT_MESSAGE, parseModelCommand, type LocalModelId } from "../../../../packages/alive/src/modelSwitch.ts";
import { offlineSourceView } from "../../../../packages/alive/src/offlineSources.ts";
import { OfflinePicture } from "./OfflinePicture.tsx";
import { openAuthedPage } from "./offlineMedia.ts";
import {
  citedSourceEntries,
  shouldWebSearch,
  shouldOfflineSearch,
  searchQueryFrom,
  withSources,
  type SearchResult,
} from "../../../../packages/alive/src/webSearch.ts";
import { interruptTalk, queueSpokenLine, VoiceSession, type TalkSinks } from "../room/voice/VoiceSession";
import { openTapEar, type TapEar } from "../room/voice/tapEar";
import {
  boxAfterTranscription,
  cancelsRecording,
  finishTranscribing,
  formatClock,
  HEARD_NOTHING_LABEL,
  idleTapState,
  MIC_DENIED_LABEL,
  recordedMs,
  shouldAutoSend,
  shouldAutoStop,
  startRecording,
  startTranscribing,
  TRANSCRIBING_LABEL,
  type TapState,
} from "../voice/tapToTalk";
import { patchVoiceSettings, readVoiceSettings, type VoiceSettings } from "../voice/voiceSettings";
import { PreyasHeroSwitch } from "../today/PreyasHeroSwitch";
import { useRpg } from "../today/useRpg";
import { clearFlight, mergeFlightReply, peekFlight, publishFlight, subscribeFlight } from "./chatFlight";
import { tabById, type Section } from "../nav";
import { chatColumn, isPhone, isWide, pageColumn, pageGridColumns, SETTINGS_PROBE_MS } from "../layout";
import { useArt } from "../art/slots.ts";
import { usePhotoSwitcher } from "../ui/ArtSlot";
import { ActivityPanel } from "../activity/ActivityPanel";
import { PreviewCard } from "../activity/PreviewCard";
import { previewMode } from "../activity/previewMode";
import { useActivity, type ActivitySink } from "../activity/useActivity";
import { HarnessLauncher } from "../harness/HarnessLauncher";
import { DailyLimit } from "../settings/DailyLimit.tsx";
import { AppearanceSetting } from "../settings/Appearance";
import { BitModeSetting } from "../settings/BitMode.tsx";
import { SoundToggle } from "../settings/SoundToggle.tsx";
import { TrackpadVoice } from "../settings/TrackpadVoice.tsx";
import { PowerPanel } from "../settings/PowerPanel";
import { AboutPreyas } from "../settings/AboutPreyas";
import { TURN_OFF_CONFIRM } from "../settings/power";
import { SoundLab } from "../media/sounds/SoundLab.tsx";
import { theme } from "../theme";
import { CHAT_FONT_FAMILY, EmojiText } from "../chat/emojiText";
import { FaceButton, FaceMode } from "../face/FaceMode";
import { EXPRESSION_LABEL, liveExpression, speechMood, type FacePlayback, type FaceSignals } from "../face/expression.ts";

/** Web lets the sky show through the shell; the iPhone paints the page colour. */
const isWeb = typeof document !== "undefined";

/** A short face for each microphone phase. */
const MIC_ICON: Record<string, string> = {
  listening: "🎤",
  speaking: "🔊",
  thinking: "…",
};
type Shown = ChatMessage & {
  t: number;
  /** The Live Activity run this reply belongs to (slice 12). */
  runId?: string;
  thinking?: string;
  sources?: SearchResult[];
  document?: { name: string; summary?: string; points?: { text: string; kind: NoteKind }[] };
  briefingDay?: string;
  /** Set when the Windows backup brain wrote this reply. */
  brain?: "backup";
};
type Briefing = { day: string; opening: string; items: string[]; empty: boolean };
type InboxFile = { name: string; size: number; type: string; modified: number };
type PendingReminder = { text: string; dueAt: string; repeat: "none" | "daily" | "weekly" | "weekdays"; label: string };
type PartnerCard = { turns: number; level: number; bond: number; caption: string };
type ModelTier = { label: string; context: number; weightsGb: number };
type ModelStatus = {
  current: LocalModelId;
  status: "ready" | "loading" | "down" | "error";
  error: string | null;
  label: string;
  freeGb: number | null;
  idleMinutesLeft: number;
  port: number;
  tiers: Record<LocalModelId, ModelTier>;
  rollback?: { target: LocalModelId; note: string; at: number } | null;
};
const MODEL_BUTTONS: { id: LocalModelId; short: string }[] = [
  { id: "tiny", short: "Tiny 0.8B" },
  { id: "small", short: "Small 8B" },
  { id: "big", short: "Big 14B" },
  { id: "huge", short: "Huge 30B" },
];
type ChatMeta = { id: string; title: string; created: number; updated: number };
type ChatDialog =
  | { kind: "rename"; id: string; value: string }
  | { kind: "delete"; id: string; title: string }
  | { kind: "deleteNote"; id: string; text: string }
  | { kind: "forget"; notes: Note[] }
  | { kind: "paid"; text: string }
  | { kind: "deleteReminders"; reminders: Reminder[] }
  | { kind: "remind"; pending: PendingReminder }
  | { kind: "powerOff" }
  | { kind: "briefingTime"; time: string }
  | { kind: "briefingOff" }
  | { kind: "taskConfirm"; taskId: string; stepId: number; token: string; title: string; body: string }
  | { kind: "deleteDeck"; id: string; title: string }
  | { kind: "model"; target: "big" | "huge"; freeGb: number | null };
type StoredRow = { t?: number; role?: string; content?: string; who?: string; model?: string; costUsd?: number | null; thinking?: string; briefingDay?: string; brain?: string };
/** "Briefing 2026-11-07" is how an old briefing message started. */
function briefingDayOf(row: StoredRow): string {
  if (row.briefingDay) return row.briefingDay;
  const match = String(row.content || "").match(/^\s*Briefing\s+(\d{4}-\d{2}-\d{2})\b/);
  return match ? match[1]! : "";
}
function toBriefing(day: string, text: string): Briefing {
  const items: string[] = [];
  const opening: string[] = [];
  for (const line of String(text).split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^[-•]\s+/.test(trimmed)) items.push(trimmed.replace(/^[-•]\s+/, ""));
    else if (!trimmed.startsWith("#") && !/^Briefing\s+\d{4}-\d{2}-\d{2}$/.test(trimmed)) opening.push(trimmed);
  }
  return { day, opening: opening.join(" "), items, empty: items.length === 0 };
}
const DAILY_BRIEFING_TITLE = "Daily briefing";
function hasFlashcardsDue(briefing: Briefing): boolean {
  return briefing.items.some((item) => /flashcard/i.test(item));
}
/** "YOUR DAY · Monday 2 November" */
function briefingKicker(day: string): string {
  const match = String(day).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const label = match
    ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).toLocaleDateString("en-GB", {
        weekday: "long",
        day: "numeric",
        month: "long",
      })
    : day;
  return `YOUR DAY · ${label}`;
}
function toShown(rows: StoredRow[]): Shown[] {
  return rows.map((row) => ({
    t: typeof row.t === "number" ? row.t : Date.now(),
    role: row.role === "assistant" || row.role === "system" ? row.role : "user",
    content: row.content || "",
    who: row.who === "paid" || row.who === "preyas" || row.who === "user" ? row.who : undefined,
    model: row.model || undefined,
    costUsd: row.costUsd,
    thinking: typeof row.thinking === "string" ? row.thinking : undefined,
    briefingDay: briefingDayOf(row) || undefined,
    brain: row.brain === "backup" ? "backup" : undefined,
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
/**
 * "Change background" for the `bg` picture (slice 10b), in the existing
 * Settings panel next to the other small cards. It is the same picker and the
 * same brain route as the slot buttons; this card only owns the two short
 * notes: "Saved, Preyas uses it right away" and, for four seconds,
 * "Couldn't save the photo".
 */
function BackgroundPhotoCard() {
  const bg = useArt("bg");
  const [note, setNote] = useState<"none" | "saved" | "failed">("none");
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearSoon = () => {
    if (noteTimer.current) clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => setNote("none"), 4000);
  };
  useEffect(
    () => () => {
      if (noteTimer.current) clearTimeout(noteTimer.current);
    },
    [],
  );
  const photo = usePhotoSwitcher("bg", (outcome) => {
    if (outcome === "saved") {
      bg.reload();
      setNote("saved");
      clearSoon();
    } else {
      setNote("failed");
      clearSoon();
    }
  });

  return (
    <View style={styles.phoneCard}>
      <Text style={styles.kicker}>BACKGROUND PICTURE</Text>
      <Pressable
        style={styles.profileBtn}
        onPress={() => void photo.change()}
        disabled={photo.busy}
        accessibilityRole="button"
        accessibilityLabel="Change background photo"
        accessibilityState={{ disabled: photo.busy }}
      >
        <Text style={styles.profileText}>{photo.busy ? "Saving…" : "Change background"}</Text>
      </Pressable>
      {note === "failed" ? <Text style={styles.dim}>Couldn't save the photo</Text> : null}
      <Text style={styles.dim}>
        {note === "saved"
          ? "Saved. Preyas uses it right away."
          : "The sky picture behind the app. The old picture is kept in the art folder's old/ subfolder."}
      </Text>
    </View>
  );
}

export function ChatScreen({
  section,
  onSection,
  onNavigate,
}: {
  section: Section;
  onSection?: (section: Section) => void;
  onNavigate?: (tab: "room" | "body" | "bench" | "raw") => void;
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
  const [escalate, setEscalate] = useState(false);
  const [hintPaid, setHintPaid] = useState(false);
  const [note, setNote] = useState("");
  const [live, setLive] = useState<{ who: "preyas" | "paid"; text: string; brain?: "backup" } | null>(null);
  const [openThink, setOpenThink] = useState<Record<number, boolean>>({});
  const [online, setOnline] = useState(false);
  const logRef = useRef<ScrollViewInstance>(null);
  /** True while the thread is parked at the newest message. */
  const pinned = useRef(true);
  const [jumpVisible, setJumpVisible] = useState(false);
  const { snapshot: life } = useRpg();
  const partner: PartnerCard = partnerFromProgress({
    level: life.level,
    into: life.levelInto,
    need: life.levelNeed,
    rankName: life.rank.name,
    totalXp: life.totalXp,
  });
  const [chats, setChats] = useState<ChatMeta[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const activeIdRef = useRef<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  /** Mac: the chats list beside the thread; remembered while the app runs. */
  const [listOpen, setListOpen] = useState(true);
  const [dialog, setDialog] = useState<ChatDialog | null>(null);
  const [coachPanel, setCoachPanel] = useState(false);
  const coach = useCoach(() => bag.brainUrl || null);
  const [notesList, setNotesList] = useState<Note[]>([]);
  const [notesQuery, setNotesQuery] = useState("");
  const [editing, setEditing] = useState<{ id: string; text: string; kind: NoteKind } | null>(null);
  const [chip, setChip] = useState("");
  useEffect(() => {
    bag.onTtsQuiet = () => {
      const text = takeTtsNotice();
      if (text) setChip(text);
    };
  }, [bag]);
  /** Enlarged offline picture, or null when nothing is zoomed. */
  const [zoomImage, setZoomImage] = useState("");
  const notesStamp = useRef(0);
  const [task, setTask] = useState<TaskRecord | null>(null);
  const [searching, setSearching] = useState(false);
  const [inbox, setInbox] = useState<InboxFile[]>([]);
  const [inboxPath, setInboxPath] = useState("");
  const [docBusy, setDocBusy] = useState("");
  const [docProgress, setDocProgress] = useState("");
  const [docChoice, setDocChoice] = useState<{ name: string; matches: string[] } | null>(null);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [modelStatus, setModelStatus] = useState<ModelStatus | null>(null);
  const [modelError, setModelError] = useState("");
  const [vaultError, setVaultError] = useState("");
  // Until the mount effect has worked out where the brain is, a settings probe
  // would ask a relative URL and get the web page back as HTML.
  const [brainReady, setBrainReady] = useState(false);
  /** The `at` of the last rollback note already shown, so it appears once. */
  const rollbackSeenRef = useRef(0);
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [vault, setVault] = useState<{ path: string; obsidianUrl: string; notes: number; lastSync: number } | null>(null);
  const [driveMap, setDriveMap] = useState<{ scanned: number; files: number; folders: number; models: number } | null>(null);
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
  /** Task ids whose final answer already landed in the chat. */
  const announcedTaskAnswers = useRef<Set<string>>(new Set());
  /** Live Activity: one run per message, the id of the one on screen, and its poll. */
  const runsRef = useRef(new Map<string, ActivitySink>());
  const [lastRunId, setLastRunId] = useState("");
  const [lastRunActive, setLastRunActive] = useState(false);
  const isRunActive = useRef(false);
  const activity = useActivity({ runId: lastRunId, active: lastRunActive, brainUrl: bag.brainUrl });
  const activityRef = useRef(activity);
  activityRef.current = activity;
  const [memFilter, setMemFilter] = useState<"all" | "notes" | "reminders" | "docs">("all");
  const [briefingSettings, setBriefingSettings] = useState<{ briefingTime: string; briefingOn: boolean } | null>(null);
  const [briefingDismissed, setBriefingDismissed] = useState(false);
  const [profile, setProfile] = useState(false);
  /** Tap-to-talk: the mic, its timer and the two voice switches (slice V1). */
  const [tap, setTap] = useState<TapState>(idleTapState);
  const [tapMs, setTapMs] = useState(0);
  const [tapNote, setTapNote] = useState<"" | "heardNothing" | "denied">("");
  const [voice, setVoice] = useState<VoiceSettings>(() => readVoiceSettings());
  const [faceOpen, setFaceOpen] = useState(false);
  const tapEar = useRef<TapEar | null>(null);
  const tapRef = useRef<TapState>(idleTapState());
  const draftRef = useRef("");
  const sendRefTap = useRef<(text: string) => Promise<void>>(async () => {});
  const { width, height } = useWindowDimensions();
  const wide = isWide(width);
  const micOk =
    typeof window === "undefined" ||
    microphoneAvailable({
      protocol: window.location.protocol,
      hostname: window.location.hostname,
      isSecureContext: window.isSecureContext,
    });
  const phone = isPhone(width, height);
  const column = chatColumn(width);
  const page = pageColumn(width);
  const pageCols = pageGridColumns(width);
  const preview = previewMode(width);
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
      const pending = peekFlight(id);
      let restored = toShown(body.messages || []);
      let restoredError = "";
      if (pending?.reply) {
        const merged = mergeFlightReply(restored, pending.reply as Shown | null);
        if (merged.length === restored.length) clearFlight(id);
        else restoredError = pending.error;
        restored = merged;
      } else if (pending?.error) {
        restoredError = pending.error;
        clearFlight(id);
      }
      messagesRef.current = restored;
      setMessages(restored);
      setLive(null);
      setNote(restoredError);
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
      const body = (await res.json()) as {
        day?: string;
        opening?: string;
        items?: string[];
        text?: string | null;
        settings?: { briefingTime: string; briefingOn: boolean };
      };
      const day = body.day || "";
      const next: Briefing =
        Array.isArray(body.items) && day
          ? { day, opening: body.opening || "", items: body.items, empty: body.items.length === 0 }
          : toBriefing(day, body.text || "");
      const shown = next.opening || next.items.length ? next : null;
      setBriefing(shown);
      if (body.settings) setBriefingSettings(body.settings);
      return shown ? `${shown.opening}\n${shown.items.map((item) => `- ${item}`).join("\n")}` : "";
    } catch {
      return "";
    }
  }
  /** The server owns the "Daily briefing" chat: here we only refresh the card. */
  async function runBriefingNow(chatId: string | null) {
    setChip("Building your briefing…");
    try {
      const res = await brainFetch(`${bag.brainUrl}/v1/briefing/run`, { method: "POST" });
      const body = (await res.json()) as { ok?: boolean; day?: string; opening?: string; items?: string[]; error?: string };
      if (!body.ok || !Array.isArray(body.items)) throw new Error(body.error || "no briefing");
      const day = body.day || "";
      setBriefing({ day, opening: body.opening || "", items: body.items, empty: body.items.length === 0 });
      setChip("Briefing ready");
      // A briefing in another chat would be a second copy: only reload Daily briefing.
      const openChat = chatId ? chats.find((row) => row.id === chatId) : null;
      if (openChat && openChat.title === DAILY_BRIEFING_TITLE) await loadChat(openChat.id);
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

  /** Coach playbooks: "coach <topic>", or any text while a session runs. */
  async function handleCoachCommand(text: string, chatId: string | null): Promise<boolean> {
    const intent = parseCoachIntent(text);
    const active = (coach.stateRef.current?.mode ?? "off") !== "off";
    // Only coach commands or (in a session) any text open the coach flow;
    // in-session words alone never do.
    if (!active && (!intent || isSessionWord(intent.kind))) return false;
    busy.current = true;
    try {
      const data = await coach.turn(text);
      if (!data || !data.handled) return false;
      await addLocal({ t: Date.now(), role: "user", content: text, who: "user" });
      await addLocal({ t: Date.now(), role: "assistant", content: data.reply, who: "preyas", model: "preyas" });
      if (data.escalate) {
        try {
          const escRes = await brainFetch(`${bag.brainUrl}/v1/coach/escalate`, { method: "POST" });
          const esc = await escRes.json();
          if (esc.allowed) {
            setDialog({ kind: "paid", text: esc.prompt });
          } else {
            await addLocal({
              t: Date.now(),
              role: "assistant",
              content: `Daily limit reached (today: $${Number(esc.spentTodayUsd || 0).toFixed(2)} of $${Number(esc.capUsd || 0).toFixed(2)}), so the paid ask stays blocked.`,
              who: "preyas",
              model: "preyas",
            });
          }
          if (esc.grokBotText) {
            await addLocal({
              t: Date.now(),
              role: "assistant",
              content: `For Grok Bot:\n\n${esc.grokBotText}`,
              who: "preyas",
              model: "preyas",
            });
          }
        } catch {
          /* the escalate card is a nicety, the honest reply already landed */
        }
      }
      void coach.refresh();
      return true;
    } catch {
      return false;
    } finally {
      busy.current = false;
    }
  }
  /** "search my vault for X", "what did I write about X", "save this to Obsidian". */
  async function handleVaultCommand(text: string, chatId: string | null): Promise<boolean> {
    const lower = text.trim().toLowerCase();
    const search = lower.match(/^(?:search|look in)\s+my\s+vault\s+(?:for\s+)?(.+)$/);
    const wrote = lower.match(/^what did i write about\s+(.+)$/);
    if (search || wrote) {
      const query = (search?.[1] || wrote?.[1] || "").trim();
      await addLocal({ t: Date.now(), role: "user", content: text, who: "user" });
      try {
        const res = await brainFetch(`${bag.brainUrl}/v1/vault/search?q=${encodeURIComponent(query)}`);
        const body = (await res.json()) as { results?: { title: string; excerpt: string }[] };
        const hits = body.results || [];
        const reply: Shown = {
          t: Date.now(),
          role: "assistant",
          content: hits.length
            ? hits.map((hit) => `From [[${hit.title}]]: ${hit.excerpt.slice(0, 160)}`).join("\n\n")
            : `I could not find anything in the vault about "${query}".`,
          who: "preyas",
          model: "preyas",
        };
        messagesRef.current = [...messagesRef.current, reply];
        setMessages(messagesRef.current);
        void remember(reply, chatId);
      } catch {
        setChip("Could not search the vault");
      }
      return true;
    }
    if (/^save (?:this|that) to obsidian\b/.test(lower)) {
      const last = [...messagesRef.current].reverse().find((row) => row.role === "assistant");
      if (!last) {
        setChip("Nothing to save yet");
        return true;
      }
      try {
        const res = await brainFetch(`${bag.brainUrl}/v1/vault/save`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title: `Chat ${new Date().toISOString().slice(0, 10)}`, text: last.content }),
        });
        const body = (await res.json()) as { ok?: boolean; path?: string };
        setChip(body.ok ? `Saved to ${body.path}` : "Could not save to the vault");
      } catch {
        setChip("Could not save to the vault");
      }
      return true;
    }
    return false;
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

  async function refreshVault() {
    if (!bag.brainUrl) return null;
    try {
      const res = await brainFetch(`${bag.brainUrl}/v1/vault/status`, {
        signal: AbortSignal.timeout(SETTINGS_PROBE_MS),
      });
      const read = await readProbe<{ path: string; obsidianUrl: string; notes: number; lastSync: number }>("Vault", res);
      if (!read.ok) {
        setVaultError(read.error);
        return null;
      }
      setVault(read.body);
      setVaultError("");
      return read.body;
    } catch (error) {
      setVaultError(probeThrownError("Vault", error));
      return null;
    }
  }

  async function refreshDriveMap() {
    try {
      const res = await brainFetch(`${bag.brainUrl}/v1/drive-map/status`);
      if (!res.ok) return null;
      const body = (await res.json()) as { ok: boolean; scanned: number; files: number; folders: number; models: number };
      if (!body.ok) return null;
      setDriveMap(body);
      return body;
    } catch {
      return null;
    }
  }

  async function refreshModel() {
    if (!bag.brainUrl) return null;
    try {
      const res = await brainFetch(`${bag.brainUrl}/v1/model`, {
        signal: AbortSignal.timeout(SETTINGS_PROBE_MS),
      });
      const read = await readProbe<ModelStatus>("Model status", res);
      if (!read.ok) {
        setModelError(read.error);
        return null;
      }
      const body = read.body;
      setModelStatus(body);
      setModelError("");
      // A failed big/huge switch rolls back to the 8B on the server, which
      // posts "couldn't load, back on small" into the newest chat. Pull that
      // line onto the screen once per rollback, without clobbering a reply
      // that is still being generated.
      if (body.rollback && body.rollback.note && body.rollback.at > rollbackSeenRef.current) {
        rollbackSeenRef.current = body.rollback.at;
        if (!busy.current && activeIdRef.current) {
          void loadChat(activeIdRef.current);
        }
      }
      return body;
    } catch (error) {
      setModelError(probeThrownError("Model status", error));
      return null;
    }
  }

  /** Ask the brain to switch. Returns "confirm" when a Yes/No card must come first. */
  async function switchModel(target: LocalModelId, confirmed: boolean): Promise<"started" | "confirm" | "failed"> {
    try {
      const res = await brainFetch(`${bag.brainUrl}/v1/model/switch`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: target, confirm: confirmed }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        needsConfirm?: boolean;
        freeGb?: number | null;
        current?: LocalModelId;
        status?: ModelStatus["status"];
        error?: string;
      };
      if (body.needsConfirm) {
        if (target === "big" || target === "huge") {
          setDialog({ kind: "model", target, freeGb: body.freeGb ?? null });
        }
        return "confirm";
      }
      if (!body.ok) {
        setChip(body.error || "Could not switch models");
        return "failed";
      }
      setModelStatus((prev) =>
        prev
          ? { ...prev, current: body.current ?? target, status: body.status ?? "loading", error: null }
          : null,
      );
      void refreshModel();
      return "started";
    } catch {
      setChip("Could not switch models");
      return "failed";
    }
  }

  /** "use small" / "use big" / "use huge" — switch, then say so in the chat. */
  async function handleModelCommand(trimmed: string): Promise<boolean> {
    const target = parseModelCommand(trimmed);
    if (!target) return false;
    busy.current = true;
    try {
      await addLocal({ t: Date.now(), role: "user", content: trimmed, who: "user" });
      const outcome = await switchModel(target, false);
      if (outcome === "confirm") {
        await addLocal({
          t: Date.now(),
          role: "assistant",
          content:
            target === "big"
              ? "The Mac is low on memory, so I'll check with you first."
              : "The 30B model will make the Mac swap. Just say yes or no on the card.",
          who: "preyas",
          model: "preyas",
        });
        return true;
      }
      if (outcome === "failed") {
        await addLocal({
          t: Date.now(),
          role: "assistant",
          content: "I couldn't switch models.",
          who: "preyas",
          model: "preyas",
        });
        return true;
      }
      await addLocal({
        t: Date.now(),
        role: "assistant",
        content: `Switching to the ${MODEL_LABELS[target]}… loading…`,
        who: "preyas",
        model: "preyas",
      });
      return true;
    } finally {
      busy.current = false;
    }
  }
  async function turnOffEverything() {
    try {
      await brainFetch(`${bag.brainUrl}/v1/power/off`, { method: "POST" });
      setChip("Preyas is turning off");
    } catch {
      setChip("Could not turn off. Is the Mac still awake?");
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
  async function runWebSearch(text: string, runId = ""): Promise<{ query: string; results: SearchResult[] }> {
    const query = searchQueryFrom(text) || text.trim();
    setSearching(true);
    const sink = runId ? runsRef.current.get(runId) : undefined;
    const stepId = sink ? sink.pushLocal({ kind: "tool", tool: "search_web", label: "Searched web", detail: query, status: "running" }) : "";
    try {
      const res = await brainFetch(
        `${bag.brainUrl}/v1/search?q=${encodeURIComponent(query)}`,
        runId ? { headers: { "x-preyas-run": runId } } : undefined,
      );
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
      if (sink && stepId) sink.markDone(stepId);
      setSearching(false);
    }
  }
  /** Prefer the local Kiwix library for encyclopedic/how-to questions. */
  async function runOfflineSearch(text: string, runId = ""): Promise<{ query: string; results: SearchResult[] }> {
    const query = searchQueryFrom(text) || text.trim();
    const sink = runId ? runsRef.current.get(runId) : undefined;
    const stepId = sink ? sink.pushLocal({ kind: "tool", tool: "search_offline", label: "Searched offline library", detail: query, status: "running" }) : "";
    try {
      const res = await brainFetch(
        `${bag.brainUrl}/v1/offline/search?q=${encodeURIComponent(query)}`,
        runId ? { headers: { "x-preyas-run": runId } } : undefined,
      );
      const body = (await res.json()) as { ok?: boolean; results?: SearchResult[]; error?: string };
      if (!body.ok || !body.results?.length) return { query, results: [] };
      return { query, results: body.results.slice(0, 5) };
    } catch {
      return { query, results: [] };
    } finally {
      if (sink && stepId) sink.markDone(stepId);
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
          const current = body.task;
          setTask(current);
          if (current.status === "done" || current.status === "error") {
            if (taskPoll.current) clearInterval(taskPoll.current);
            taskPoll.current = null;
            setLastRunActive(false);
            // The loop's final answer lands in the chat once.
            if (current.answer && !announcedTaskAnswers.current.has(current.id)) {
              announcedTaskAnswers.current.add(current.id);
              const reply: Shown = {
                t: Date.now(),
                role: "assistant",
                content: current.answer,
                who: current.model === "deepseek-flash" ? "paid" : "preyas",
                model: current.model === "deepseek-flash" ? "deepseek-flash" : "preyas",
              };
              messagesRef.current = [...messagesRef.current, reply];
              setMessages(messagesRef.current);
              void remember(reply, current.chatId || activeIdRef.current || "");
            }
            return;
          }
          // A paused tool step waits for a Yes/No card.
          const waiting = current.steps.find((step) => step.pendingConfirm && step.pendingConfirm.answered == null);
          if (current.status === "paused" && waiting && waiting.pendingConfirm) {
            setDialog((open) => {
              if (open && open.kind === "taskConfirm" && open.stepId === waiting.id) return open;
              if (open) return open; // never steal another dialog
              return {
                kind: "taskConfirm",
                taskId: current.id,
                stepId: waiting.id,
                token: waiting.pendingConfirm!.token,
                title: "May I run this?",
                body: `${waiting.text}\n\n${waiting.pendingConfirm!.why}${waiting.pendingConfirm!.detail ? `\n\n${waiting.pendingConfirm!.detail}` : ""}`,
              };
            });
          }
        } catch {
          /* the poll is best effort */
        }
      })();
    }, 1200);
  }
  /** Answer a tool-confirm card; the running task picks the result up. */
  async function answerTaskConfirm(taskId: string, stepId: number, token: string, yes: boolean) {
    try {
      const res = await brainFetch(`${bag.brainUrl}/v1/tasks/${encodeURIComponent(taskId)}/confirm`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ stepId, token, yes }),
      });
      if (!res.ok) {
        setChip(yes ? "That step expired before you answered." : "The step was already answered.");
      }
    } catch {
      setChip("I could not reach the brain with your answer.");
    }
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
      const started = body.task;
      setTask(started);
      // The task panel shows the placeholders; the Activity panel shows the
      // task's own tools, keyed by the task id the brain reports them under.
      const tagged = messagesRef.current.map((row) => (row.content === "On it…" ? { ...row, runId: started.id } : row));
      const last = tagged[tagged.length - 1];
      messagesRef.current = tagged;
      setMessages(tagged);
      if (started.chatId && last?.runId) void remember(last, started.chatId);
      setLastRunId(started.id);
      setLastRunActive(true);
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
      setBrainReady(Boolean(bag.brainUrl));
      if (cancel) return;
      void coach.refresh();
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
  // The recording timer, and the 60 second auto-stop (one place, no stray loops).
  useEffect(() => {
    if (tap.phase !== "recording") return;
    const id = setInterval(() => {
      const current = tapRef.current;
      if (current.phase !== "recording") return;
      const now = Date.now();
      setTapMs(recordedMs(current, now));
      if (shouldAutoStop(current, now)) void transcribeRecording();
    }, 250);
    return () => clearInterval(id);
    // transcribeRecording reads refs, so it does not need to be a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tap.phase]);
  // Esc throws a running recording away (never a finished transcription).
  useEffect(() => {
    if (tap.phase !== "recording" || typeof window === "undefined") return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      cancelTapping();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tap.phase]);
  // Closing the page mid-recording releases the microphone.
  useEffect(
    () => () => {
      tapEar.current?.cancel();
      tapEar.current = null;
    },
    [],
  );
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
  }, [bag]);
  // A reply that finishes after this screen was hidden still belongs in the thread.
  useEffect(() => {
    return subscribeFlight((outcome) => {
      if (outcome.chatId !== activeIdRef.current) return;
      if (outcome.reply) {
        const merged = mergeFlightReply(messagesRef.current, outcome.reply as Shown | null);
        if (merged.length !== messagesRef.current.length) {
          messagesRef.current = merged;
          setMessages(merged);
        }
      }
      if (outcome.error) setNote(outcome.error);
    });
  }, []);
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
      setModelError("");
      setVaultError("");
      if (!brainReady) return;
      void refreshPhone();
      void refreshBriefing();
      void refreshDriveMap();
      void refreshVault();
      void refreshModel();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section, brainReady]);
  // While a model is loading, keep asking the brain until it is ready or failed.
  useEffect(() => {
    if (!modelStatus || modelStatus.status !== "loading") return;
    const id = setInterval(() => void refreshModel(), 3000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelStatus?.status]);
  useEffect(() => {
    if (!modelStatus) return;
    if (modelStatus.status === "ready") setChip(`Ready: ${modelStatus.label}`);
    if (modelStatus.status === "error" && modelStatus.error) setChip(modelStatus.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelStatus?.status, modelStatus?.error]);
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
    queueSpokenLine(bag, text, speechMood(text), final);
  }
  async function ask(
    route: "local" | "paid",
    prior: ChatMessage[],
    userText: string,
    isCurrent: () => boolean = () => true,
    sources: SearchResult[] = [],
    searchQuery = "",
    think = false,
    runId = "",
  ) {
    // Local and paid both talk to the brain. The gateway forwards without the
    // pairing token, so a direct :4000 call comes back 401.
    const target = chatTarget(route, bag.brainUrl);
    const model = target.model;
    const base = target.base;
    let last = "";
    let lastThink = "";
    let spoke = false;
    let sawBackup = false;
    let thinkStarted = 0;
    let thinkStep = "";
    const result = await streamReply({
      base,
      model,
      messages: toModelMessages(prior, summaryRef.current, withSources(userText, searchQuery, sources)),
      think,
      timeoutMs:
        route === "paid"
          ? 45_000
          : // Huge takes the one shared budget the proxy also uses for its
            // load and reply timeouts, so the two never race.
            modelStatus?.current === "huge"
            ? HUGE_TIMEOUT_MS
            : think
              ? THINK_TIMEOUT_MS
              : modelStatus?.current === "big"
                ? 120_000
                : LOCAL_TIMEOUT_MS,
      onBrain: (source) => {
        if (source === "backup") sawBackup = true;
      },
      onDelta: (update) => {
        const shown = splitPaidHint(update.answer).text;
        last = shown;
        lastThink = update.thinking;
        // Thinking time is measured here: from the first thinking delta to the
        // first real answer text, and shown as "Thought 5s".
        const sink = runsRef.current.get(runId);
        if (update.thinking && !last && !thinkStarted && sink) {
          thinkStarted = Date.now();
          thinkStep = sink.pushLocal({ kind: "thought", tool: "think", label: "Thinking…", status: "running", startedAt: thinkStarted });
        }
        if (shown && thinkStarted && thinkStep && sink) {
          sink.markDone(thinkStep);
          thinkStep = "";
        }
        if (!isCurrent()) return;
        setLive(shown ? { who: route === "paid" ? "paid" : "preyas", text: shown, brain: sawBackup ? "backup" : undefined } : null);
        if (route === "local" && shown) {
          void speakPreyas(shown, false, !spoke);
          spoke = true;
        }
      },
    });
    if (thinkStarted && thinkStep) runsRef.current.get(runId)?.markDone(thinkStep);
    if (isCurrent()) setLive(null);
    const parsed = splitPaidHint(result.text || last);
    if (isCurrent() && route === "local" && parsed.text) void speakPreyas(parsed.text, true, !spoke);
    const { brain: headerBrain, ...rest } = result;
    const brain: "backup" | undefined = headerBrain === "backup" || sawBackup ? "backup" : undefined;
    return {
      ...rest,
      text: parsed.text,
      thinking: result.thinking || lastThink,
      suggestPaid: parsed.suggestPaid,
      model,
      brain,
      endpoint: { base, via: "proxy" as const },
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
    const runId = `r-${Date.now()}`;
    runsRef.current.set(runId, activityRef.current);
    activityRef.current.resubscribe();
    setLastRunId(runId);
    setLastRunActive(false);
    isRunActive.current = true;
    // Start polling only after the previous run's last look is in, so this run's
    // cursor never runs past a step that belongs to it.
    setTimeout(() => {
      if (isRunActive.current) setLastRunActive(true);
    }, 0);
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
    if (!askPaid && !affirmation && !dialog && (await handleCoachCommand(trimmed, chatId))) return;
    if (!askPaid && !affirmation && (await handleVaultCommand(trimmed, chatId))) return;
    if (!askPaid && !affirmation && (await handleStudyCommand(trimmed, chatId))) return;
    if (!askPaid && !affirmation && (await handleBriefingCommand(trimmed, chatId))) return;
    if (!askPaid && !affirmation && (await handleReminderCommand(trimmed, chatId))) return;
    if (!askPaid && !affirmation && !dialog && (await handleModelCommand(trimmed))) return;
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
        if (shouldOfflineSearch(trimmed)) {
          const found = await runOfflineSearch(trimmed, runId);
          sources = found.results;
          searchQuery = found.query;
        }
        if (!sources.length && shouldWebSearch(trimmed)) {
          const found = await runWebSearch(trimmed, runId);
          sources = found.results;
          searchQuery = found.query;
        }
        if (!sources.length && isCurrent() && (shouldOfflineSearch(trimmed) || shouldWebSearch(trimmed))) setChip("No library or web results");
        const think = thinkForced || wantsThinking(trimmed);
        if (think && isCurrent()) setThinking(true);
        const local = await ask("local", history, trimmed, isCurrent, sources, searchQuery, think, runId).finally(() => {
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
            runId,
            thinking: local.thinking || undefined,
            sources: sources.length ? sources : undefined,
            brain: local.brain === "backup" ? "backup" : undefined,
          };
          publishFlight({ chatId, reply, error: "" });
          void remember(reply, chatId);
          if (isCurrent()) {
            messagesRef.current = mergeFlightReply(messagesRef.current, reply);
            setMessages(messagesRef.current);
          }
          scheduleNotesCheck();
          return;
        }
        if (!isCurrent()) {
          publishFlight({
            chatId,
            reply: null,
            error: local.error === SWITCHING_CHAT_MESSAGE ? SWITCHING_CHAT_MESSAGE : "Preyas didn't answer. You can ask a paid model if it's on.",
          });
          return;
        }
        route = chooseRoute({
          askPaid: false,
          localFailed: true,
          paidAvailable: paid.available && paidButton({ available: paid.available, offPeakOnly: paid.offPeakOnly, now: new Date(), downReason: paid.reason }).enabled,
          allowPaidOnFailure: escalate,
        });
        if (route.route === "local") {
          // Offline pack hits still belong on screen when the local model fails —
          // otherwise encyclopedic questions show "didn't answer" with no pictures.
          if (sources.length) {
            const reply: Shown = {
              t: Date.now(),
              role: "assistant",
              content:
                cleaned.text?.trim() ||
                "I couldn't finish a spoken answer, but here is what the offline library has:",
              who: "preyas",
              model: "preyas",
              runId,
              sources,
            };
            const offlineNote =
              local.error === SWITCHING_CHAT_MESSAGE
                ? SWITCHING_CHAT_MESSAGE
                : "Preyas didn't finish answering, but offline sources are above.";
            publishFlight({ chatId, reply, error: offlineNote });
            void remember(reply, chatId);
            if (isCurrent()) {
              messagesRef.current = mergeFlightReply(messagesRef.current, reply);
              setMessages(messagesRef.current);
              setNote(offlineNote);
            }
            return;
          }
          const missed =
            local.error === SWITCHING_CHAT_MESSAGE
              ? SWITCHING_CHAT_MESSAGE
              : "Preyas didn't answer. You can ask a paid model if it's on.";
          publishFlight({ chatId, reply: null, error: missed });
          setNote(missed);
          return;
        }
      }
      if (route.route !== "paid") return;
      const paidReply = await ask("paid", history, trimmed, isCurrent, [], "", false, runId);
      if (!paidReply.ok) {
        const missed = paidReply.error || "The paid model didn't answer.";
        publishFlight({ chatId, reply: null, error: missed });
        if (isCurrent()) setNote(missed);
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
        runId,
        thinking: paidReply.thinking || undefined,
      };
      publishFlight({ chatId, reply: paidMsg, error: "" });
      void remember(paidMsg, chatId);
      if (isCurrent()) {
        messagesRef.current = mergeFlightReply(messagesRef.current, paidMsg);
        setMessages(messagesRef.current);
      }
      scheduleNotesCheck();
      const reactionHistory: ChatMessage[] = [...history, userMsg, paidMsg];
      const reaction = await ask(
        "local",
        reactionHistory,
        "In one or two sentences, react to what the paid model just said. Stay in your voice.",
        isCurrent,
        [],
        "",
        false,
        runId,
      );
      if (reaction.ok) {
        const line = splitPaidHint(reaction.text).text;
        const reply: Shown = {
          t: Date.now(),
          role: "assistant",
          content: line,
          who: "preyas",
          model: "preyas",
          runId,
          thinking: reaction.thinking || undefined,
        };
        publishFlight({ chatId, reply, error: "" });
        void remember(reply, chatId);
        if (isCurrent()) {
          messagesRef.current = mergeFlightReply(messagesRef.current, reply);
          setMessages(messagesRef.current);
        }
        scheduleNotesCheck();
      }
    } finally {
      bag.thinking = false;
      busy.current = false;
      isRunActive.current = false;
      setLastRunActive(false);
    }
  }
  sendRef.current = send;
  const submitDraft = () => {
    const text = draft;
    if (!text.trim() || busy.current) return;
    setDraft("");
    void send(text, false);
  };
  draftRef.current = draft;
  sendRefTap.current = async (text: string) => {
    await send(text, false);
  };
  /** Move the mic to a new phase, in the ref first so a fast second tap agrees. */
  const setTapPhase = (next: TapState) => {
    tapRef.current = next;
    setTap(next);
  };
  /**
   * Tap-to-talk, step 2: close the mic, send the wav to the brain's existing
   * /v1/stt, and put the words in the message box (or send them when the
   * "Send voice right away" switch is on). Silence leaves the box untouched.
   */
  async function transcribeRecording(): Promise<void> {
    const ear = tapEar.current;
    tapEar.current = null;
    setTapPhase(startTranscribing());
    setTapNote("");
    const wav = ear ? await ear.stop() : null;
    let heard = "";
    if (wav) {
      const result = await transcribeClip(bag.brainUrl, wav, 30_000);
      const text = result?.text?.trim() ?? "";
      heard = isWhisperHallucination(text) ? "" : text;
    }
    setTapPhase(finishTranscribing());
    setTapMs(0);
    if (!heard) {
      setTapNote("heardNothing");
      return;
    }
    if (shouldAutoSend(voice.autoSend, heard)) {
      setDraft("");
      void sendRefTap.current(heard);
      return;
    }
    const next = boxAfterTranscription(heard, draftRef.current);
    setDraft(next.text);
  }
  /** Tap-to-talk, step 1: interrupt Preyas, ask for the mic, start recording. */
  async function startTapping(): Promise<void> {
    if (tapRef.current.phase !== "idle") return;
    // Preyas talking over his own user is the first thing to stop.
    if (bag.playing) interruptTalk(bag);
    setTapNote("");
    const opened = await openTapEar();
    if ("denied" in opened) {
      setTapNote("denied");
      return;
    }
    const started = await opened.ear.start();
    if (!started) {
      opened.ear.cancel();
      setTapNote("denied");
      return;
    }
    tapEar.current = opened.ear;
    const now = Date.now();
    setTapMs(0);
    setTapPhase(startRecording(now));
  }
  /** Throw the recording away: nothing is transcribed and nothing is sent. */
  function cancelTapping(): void {
    if (!cancelsRecording(tapRef.current)) return;
    tapEar.current?.cancel();
    tapEar.current = null;
    setTapPhase(idleTapState());
    setTapMs(0);
    setTapNote("");
  }
  /** The one mic button: start, stop, or (while waiting) nothing at all. */
  function onMicTap(): void {
    const phase = tapRef.current.phase;
    if (phase === "recording") {
      void transcribeRecording();
      return;
    }
    if (phase === "idle") void startTapping();
    // "transcribing": a second tap must not open the mic again.
  }
  function saveVoice(patch: Partial<VoiceSettings>): void {
    const next = patchVoiceSettings(voice, patch);
    setVoice(next);
    setChip(patch.autoSend !== undefined ? (next.autoSend ? "Voice sends right away" : "Voice waits for Send") : next.handsFree ? "Hands-free listening on" : "Hands-free listening off");
  }
  const button = paidButton({
    available: paid.available,
    offPeakOnly: paid.offPeakOnly,
    now: new Date(),
    downReason: paid.reason,
  });
  const lastUser = [...messages].reverse().find((message) => message.who === "user");
  const go = (tab: "room" | "body" | "bench" | "raw") => {
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
          : dialog.kind === "powerOff"
        ? {
            title: TURN_OFF_CONFIRM.title,
            body: TURN_OFF_CONFIRM.body,
            confirm: TURN_OFF_CONFIRM.confirm,
            no: TURN_OFF_CONFIRM.no,
            danger: true,
            run: () => {
              setDialog(null);
              void turnOffEverything();
            },
          }
        : dialog.kind === "model"
          ? {
              title: confirmFor({ kind: "slow_model", target: dialog.target, freeGb: dialog.freeGb }).title,
              body: confirmFor({ kind: "slow_model", target: dialog.target, freeGb: dialog.freeGb }).body,
              confirm: "Yes",
              no: "No",
              danger: false,
              run: () => {
                const target = dialog.target;
                setDialog(null);
                void switchModel(target, true).then((outcome) => {
                  if (outcome === "started") {
                    void addLocal({
                      t: Date.now(),
                      role: "assistant",
                      content: `Switching to the ${MODEL_LABELS[target]}… loading…`,
                      who: "preyas",
                      model: "preyas",
                    });
                  }
                });
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
        : dialog.kind === "taskConfirm"
          ? {
              title: dialog.title,
              body: dialog.body,
              confirm: "Yes",
              no: "No",
              danger: false,
              run: () => {
                setDialog(null);
                void answerTaskConfirm(dialog.taskId, dialog.stepId, dialog.token, true);
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
          <Pressable
            onPress={() => setDrawerOpen(false)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Close chats"
          >
            <Text style={styles.sidebarClose}>✕</Text>
          </Pressable>
        ) : null}
      </View>
      <Pressable style={styles.newChat} onPress={() => void newChat()}>
        <Text style={styles.newChatText}>+ New chat</Text>
      </Pressable>
      {withClose ? (
        <View style={styles.drawerExtras}>
          <Pressable
            style={styles.drawerExtraBtn}
            onPress={() => {
              setDrawerOpen(false);
              setProfile(true);
            }}
            accessibilityRole="button"
            accessibilityLabel="View profile"
          >
            <Text style={styles.drawerExtraText}>View profile</Text>
          </Pressable>
          <Pressable
            style={styles.drawerExtraBtn}
            onPress={() => {
              setDrawerOpen(false);
              onSection?.("settings");
            }}
            accessibilityRole="button"
            accessibilityLabel="Settings"
          >
            <Text style={styles.drawerExtraText}>Settings</Text>
          </Pressable>
          <Pressable
            style={styles.drawerExtraBtn}
            onPress={() => {
              setDrawerOpen(false);
              setCoachPanel(true);
            }}
            accessibilityRole="button"
            accessibilityLabel="Coach"
          >
            <Text style={styles.drawerExtraText}>Coach</Text>
          </Pressable>
        </View>
      ) : null}
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
              accessibilityRole="button"
              accessibilityLabel={`Rename ${chat.title}`}
              onPress={() => setDialog({ kind: "rename", id: chat.id, value: chat.title })}
            >
              <Text style={styles.chatRowIconText}>✎</Text>
            </Pressable>
            <Pressable
              style={styles.chatRowIcon}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel={`Delete ${chat.title}`}
              onPress={() => setDialog({ kind: "delete", id: chat.id, title: chat.title })}
            >
              <Text style={styles.chatRowIconText}>🗑</Text>
            </Pressable>
          </View>
        ))}
        {chats.length === 0 ? <Text style={styles.chatEmpty}>No chats yet.</Text> : null}
      </ScrollView>
      {withClose ? null : (
        <Pressable style={styles.listHide} onPress={() => setListOpen(false)} accessibilityLabel="Hide chats list">
          <Text style={styles.listHideText}>« Hide</Text>
        </Pressable>
      )}
    </View>
  );
  const lastAssistant = [...messages].reverse().find((row) => row.role === "assistant");
  const faceSignals: FaceSignals = {
    recording: tap.phase === "recording",
    generating: thinking || searching || Boolean(docBusy) || phase === "thinking" || Boolean(live),
    speaking: phase === "speaking",
    reply: live?.text || lastAssistant?.content || "",
  };
  const facePlayback = (): FacePlayback => ({
    envelope: bag.talkEnv,
    talkStart: bag.talkStart,
    playing: Boolean(bag.playing),
  });
  const faceNow = liveExpression(faceSignals, Boolean(bag.playing));
  return (
    <View style={styles.root}>
      <VoiceSession sinks={bag} handsFreeOn={voice.handsFree} />
      {section === "settings" ? (
        <ScrollView style={styles.fill} contentContainerStyle={[styles.pad, page]}>
          <Text style={styles.skyTitle} accessibilityRole="header">Settings</Text>
          <AppearanceSetting />
          <BackgroundPhotoCard />
          <PowerPanel brainUrl={bag.brainUrl} onTurnOff={() => setDialog({ kind: "powerOff" })} />
          <View style={styles.phoneCard}>
            <Text style={styles.kicker}>MODEL</Text>
            <Text style={styles.dim}>
              {modelStatus
                ? `${modelStatus.label}${modelStatus.status === "loading" ? " · loading…" : modelStatus.status === "down" || modelStatus.status === "error" ? ` · ${modelStatus.status}` : ""}`
                : modelError || "Checking…"}
            </Text>
            <View style={styles.modelRow}>
              {MODEL_BUTTONS.map((tier) => {
                const active = modelStatus?.current === tier.id;
                const loading = modelStatus?.status === "loading";
                return (
                  <Pressable
                    key={tier.id}
                    disabled={loading}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active, disabled: loading }}
                    accessibilityLabel={`Use ${tier.short}${active ? ", active" : ""}`}
                    style={[styles.modelBtn, active && styles.modelBtnActive, loading && styles.modelBtnDim]}
                    onPress={() => void switchModel(tier.id, false)}
                  >
                    <Text style={[styles.modelBtnText, active && styles.modelBtnTextActive]}>{tier.short}</Text>
                  </Pressable>
                );
              })}
            </View>
            {modelStatus?.freeGb != null ? <Text style={styles.dim}>About {modelStatus.freeGb} GB free on the Mac.</Text> : null}
            <Text style={styles.dim}>Back to the 8B after 20 idle minutes. Chat: "use small", "use big", "use huge".</Text>
          </View>
          <View style={styles.phoneCard}>
            <Text style={styles.kicker}>DRIVE MAP</Text>
            <Text style={styles.dim}>
              {driveMap
                ? `Last scanned ${new Date(driveMap.scanned).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}, ${driveMap.files} files`
                : "Not scanned yet"}
            </Text>
          </View>
          <Pressable
            style={styles.profileBtn}
            onPress={() => {
              setModelError("");
              setVaultError("");
              void refreshPhone();
              void refreshVault();
              void refreshDriveMap();
              void refreshModel();
            }}
          >
            <Text style={styles.profileText}>Refresh</Text>
          </Pressable>
          <DailyLimit />
          <BitModeSetting />
          <SoundToggle />
          <TrackpadVoice />
          {typeof __DEV__ !== "undefined" && __DEV__ ? <SoundLab /> : null}
          <View style={styles.phoneCard}>
            <Text style={styles.kicker}>VAULT</Text>
            <Text style={styles.dim}>
              {vault
                ? `${vault.path}\n${vault.notes} notes · last sync ${vault.lastSync ? new Date(vault.lastSync).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "never"}`
                : vaultError || "Checking…"}
            </Text>
            <Pressable
              style={styles.docBtn}
              onPress={() => {
                const url = vault?.obsidianUrl || "obsidian://open?vault=vault";
                if (typeof window !== "undefined" && window.open) window.open(url, "_blank");
              }}
            >
              <Text style={styles.docBtnText}>Open in Obsidian</Text>
            </Pressable>
          </View>

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
              <Text style={styles.dim}>Pair this app to view phone details. The first code is in /Volumes/Agent/BakuganBuddy/memory/pairing-code on the Mac.</Text>
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
          <View style={styles.phoneCard}>
            <Text style={styles.kicker}>VOICE</Text>
            <View style={styles.switchRow}>
              <Text style={styles.dim}>Send voice right away</Text>
              <Switch
                value={voice.autoSend}
                onValueChange={(on) => saveVoice({ autoSend: on })}
                accessibilityLabel="Send voice right away"
              />
            </View>
            <Text style={styles.dim}>
              Text switches: tap the mic, speak, tap it again and press Send. With this on, what it hears is sent at once.
            </Text>
            <View style={styles.switchRow}>
              <Text style={styles.dim}>Hands-free listening</Text>
              <Switch
                value={voice.handsFree}
                onValueChange={(on) => saveVoice({ handsFree: on })}
                accessibilityLabel="Hands-free listening"
              />
            </View>
            <Text style={styles.dim}>
              Always listening while the page is open. Off by default; the tap works either way and the two never record together.
            </Text>
          </View>
          <View style={styles.phoneCard}>
            <Text style={styles.kicker}>HARDER QUESTIONS</Text>
            <View style={styles.switchRow}>
              <Text style={styles.dim}>Timeout → DeepSeek</Text>
              <Switch value={escalate} onValueChange={setEscalate} />
            </View>
            <Text style={styles.dim}>
              If the local model is taking too long, this one question is sent to DeepSeek.
            </Text>
            <Text style={styles.dim}>Preyas is a great listener.</Text>
          </View>
          <AboutPreyas brainUrl={bag.brainUrl} />
          <View style={styles.phoneCard}>
            <Text style={styles.kicker}>ADVANCED</Text>
            <View style={styles.advRow}>
              <Pressable onPress={() => go("room")}><Text style={styles.advLink}>Preyas' room</Text></Pressable>
              <Pressable onPress={() => go("body")}><Text style={styles.advLink}>Body</Text></Pressable>
              <Pressable onPress={() => go("bench")}><Text style={styles.advLink}>Benchmark</Text></Pressable>
              <Pressable onPress={() => go("raw")}><Text style={styles.advLink}>Raw Qwen</Text></Pressable>
            </View>
          </View>
        </ScrollView>
      ) : section === "learn" ? (
        <ScrollView style={styles.fill} contentContainerStyle={[styles.pad, page]}>
          <Text style={styles.skyTitle} accessibilityRole="header">Learn</Text>
          <Text style={styles.skyNote}>{tabById("learn").empty}</Text>
          {decks.length === 0 ? (
            <View style={styles.emptyTab}>
              <Text style={styles.skyNote}>{tabById("learn").example}</Text>
            </View>
          ) : null}
          <View style={[styles.pageGrid, pageCols === 2 && styles.pageGridWide]}>
            {decks.map((deck) => (
              <View key={deck.id} style={[styles.deckRow, styles.solidCard, pageCols === 2 && styles.pageGridItem]}>
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
                <Pressable
                  style={styles.chatRowIcon}
                  hitSlop={6}
                  accessibilityRole="button"
                  accessibilityLabel={`Delete ${deck.title}`}
                  onPress={() => setDialog({ kind: "deleteDeck", id: deck.id, title: deck.title })}
                >
                  <Text style={styles.chatRowIconText}>🗑</Text>
                </Pressable>
              </View>
            ))}
          </View>
        </ScrollView>
      ) : section === "memory" ? (
        <View style={styles.fill}>
          <View style={[styles.memHead, page]}>
            <Text style={styles.skyTitle} accessibilityRole="header">Memory</Text>
            <Text style={styles.skyNote}>{tabById("memory").empty}</Text>
            <TextInput
              style={styles.searchInput}
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
                  style={[styles.filterChip, memFilter === filter && styles.filterChipOn]}
                  onPress={() => {
                    setMemFilter(filter);
                    if (filter === "notes" || filter === "all") void refreshNotes(notesQuery);
                  }}
                >
                  <Text style={[styles.filterChipText, memFilter === filter && styles.filterChipTextOn]}>{filter === "all" ? "All" : filter === "notes" ? "Notes" : filter === "reminders" ? "Reminders" : "Documents"}</Text>
                </Pressable>
              ))}
            </View>
          </View>
          <ScrollView style={styles.fill} contentContainerStyle={[styles.pad, page]}>
            {(memFilter === "all" || memFilter === "notes") ? (
              <>
                {notesList.length === 0 && memFilter === "notes" ? (
                  <Text style={styles.skyNote}>{tabById("memory").example}</Text>
                ) : null}
                {notesList.map((noteRow) => (
                  <View key={noteRow.id} style={[styles.noteRow, styles.solidCard]}>
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
                        <Pressable
                          style={styles.chatRowIcon}
                          hitSlop={6}
                          accessibilityRole="button"
                          accessibilityLabel="Delete note"
                          onPress={() => setDialog({ kind: "deleteNote", id: noteRow.id, text: noteRow.text })}
                        >
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
                  <Text style={styles.skyNote}>No reminders. Tell Preyas: "remind me to call mum at 6".</Text>
                ) : null}
                {reminders.filter((row) => row.status !== "done").map((row) => (
                  <View key={row.id} style={[styles.noteRow, styles.solidCard]}>
                    <View style={styles.noteMain}>
                      <Text style={styles.noteKind}>
                        {formatDue(new Date(row.dueAt))}
                        {row.repeat !== "none" ? ` · ${row.repeat}` : ""}
                      </Text>
                      <Text style={styles.noteText}>{row.text}</Text>
                    </View>
                    <Pressable
                      style={styles.chatRowIcon}
                      hitSlop={6}
                      onPress={() => void updateReminder(row.id, { action: "done" })}
                    >
                      <Text style={styles.deckBtnText}>Done</Text>
                    </Pressable>
                    <Pressable
                      style={styles.chatRowIcon}
                      hitSlop={6}
                      onPress={() => void updateReminder(row.id, { action: "snooze", snooze: "10m" })}
                    >
                      <Text style={styles.dim}>+10m</Text>
                    </Pressable>
                  </View>
                ))}
              </>
            ) : null}
            {(memFilter === "all" || memFilter === "docs") ? (
              <>
                {inbox.length === 0 && memFilter === "docs" ? (
                  <Text style={styles.skyNote}>
                    No documents yet. Drop a PDF or text file into the inbox folder{inboxPath ? ` (${inboxPath})` : ""} and ask Preyas to read it.
                  </Text>
                ) : null}
                {inbox.map((file) => (
                  <View key={file.name} style={[styles.noteRow, styles.solidCard]}>
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
              <Text style={styles.skyNote}>{tabById("memory").example}</Text>
            ) : null}
          </ScrollView>
        </View>
      ) : (
        <View style={[styles.split, !wide && styles.stack]}>
          {wide && listOpen ? <View style={styles.sidebar}>{chatList(false)}</View> : null}
          <View style={styles.chatCard}>
            <View style={styles.thread}>
            <View style={styles.chatHead}>
              <Pressable
                style={styles.drawerBtn}
                onPress={() => (wide ? setListOpen(!listOpen) : setDrawerOpen(true))}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={wide && listOpen ? "Hide chats" : "Show chats"}
              >
                <Text style={styles.drawerBtnText}>☰</Text>
              </Pressable>
              <FaceButton
                signals={faceSignals}
                playback={facePlayback}
                size={wide ? 56 : 46}
                open={faceOpen}
                paused={faceOpen}
                onToggle={() => setFaceOpen((open) => !open)}
                onLongPress={() => setProfile(true)}
              />
              <View style={styles.chatHeadText}>
                <Text style={styles.chatName} numberOfLines={1} ellipsizeMode="tail">
                  Preyas
                </Text>
                <Text style={styles.subtitle} numberOfLines={1} ellipsizeMode="tail">
                  {faceNow === "idle" ? `Aquos · level ${partner.level}` : `Aquos · ${EXPRESSION_LABEL[faceNow]}`}
                </Text>
              </View>
              {wide ? <CoachChip state={coach.state} compact={false} onPress={() => setCoachPanel(true)} /> : null}
              {wide ? (
                <View style={styles.bondInline}>
                  <View
                    style={styles.track}
                    accessibilityRole="progressbar"
                    accessibilityValue={{ min: 0, max: 100, now: partner.bond }}
                    accessibilityLabel={`Bond ${partner.bond} percent`}
                  >
                    <View style={[styles.fillBar, { width: `${partner.bond}%` }]} />
                  </View>
                  <Text style={styles.bondInlineText}>Bond {partner.bond}%</Text>
                </View>
              ) : null}
              <View style={styles.onlineRow}>
                <View style={[styles.dot, online ? styles.dotOn : styles.dotOff]} />
                <Text style={[styles.online, !wide && styles.onlineCompact]}>{online ? "Online" : "Offline"}</Text>
              </View>
              {wide ? (
                <>
                  <Pressable style={styles.profileBtnHead} onPress={() => setProfile(true)} accessibilityLabel="View profile">
                    <Text style={styles.profileText}>View profile</Text>
                  </Pressable>
                  <Pressable
                    style={styles.gearBtn}
                    onPress={() => onSection?.("settings")}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel="Settings"
                  >
                    <Text style={styles.gearText}>⚙</Text>
                  </Pressable>
                </>
              ) : null}
            </View>
            <View style={[styles.column, column, phone && styles.columnPhone]}>
            <View style={styles.logWrap}>
              <ScrollView
                ref={logRef}
                style={styles.log}
                contentContainerStyle={[styles.logInner, jumpVisible && styles.logInnerJump]}
                horizontal={false}
                showsHorizontalScrollIndicator={false}
                onScroll={onLogScroll}
                scrollEventThrottle={16}
                onContentSizeChange={() => {
                  if (pinned.current) scrollToLatest();
                }}
              >
              {briefing && !briefingDismissed ? (
                <View style={[styles.briefingCard, styles.briefingTop]}>
                  <View style={styles.briefingCardHead}>
                    <Text style={styles.briefingTitle}>{briefingKicker(briefing.day)}</Text>
                    <Pressable
                      onPress={() => setBriefingDismissed(true)}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel="Dismiss briefing"
                    >
                      <Text style={styles.sidebarClose}>✕</Text>
                    </Pressable>
                  </View>
                  {briefing.opening ? <Text style={styles.briefingText}>{briefing.opening}</Text> : null}
                  {briefing.items.map((item, row) => (
                    <View key={`${row}-${item}`} style={styles.briefingItemRow}>
                      <Text style={styles.briefingBullet}>•</Text>
                      <Text style={styles.briefingItem}>{item}</Text>
                    </View>
                  ))}
                  {hasFlashcardsDue(briefing) ? (
                    <Pressable
                      style={styles.studyNow}
                      onPress={() => {
                        onSection?.("learn");
                        void refreshDecks();
                      }}
                    >
                      <Text style={styles.studyNowText}>Study now</Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : null}
              {messages.length === 0 && !live && !(briefing && !briefingDismissed) ? (
                <View style={styles.emptyChat}>
                  <Text style={styles.emptyTitle}>Say hi to Preyas.</Text>
                  <Text style={styles.emptyText}>{tabById("chat").empty}</Text>
                  <Text style={styles.emptyText}>{tabById("chat").example}</Text>
                </View>
              ) : null}
              {messages.map((message, index) => {
                const mine = message.who === "user";
                const read = mine && messages.slice(index + 1).some((row) => row.who !== "user");
                const label = replySourceLabel(message.who, message.brain);
                // Skip history rows that duplicate today's "Your day" card.
                if (
                  message.briefingDay &&
                  briefing &&
                  !briefingDismissed &&
                  message.briefingDay === briefing.day
                ) {
                  return null;
                }
                return (
                  <View
                    key={`${message.t}-${index}`}
                    style={[styles.msgColumn, mine ? styles.msgMine : styles.msgHis]}
                  >
                  <View style={[styles.bubbleWrap, mine ? styles.bubbleRight : styles.bubbleLeft]}>
                    {!mine ? <View style={styles.miniBall} /> : null}
                    <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleHis]}>
                      {!mine ? (
                        <Text style={styles.bubbleWho}>
                          {label}
                          {message.who === "paid" && message.costUsd != null ? ` · ~$${message.costUsd.toFixed(4)}` : ""}
                        </Text>
                      ) : null}
                      <EmojiText style={[styles.bubbleText, mine && styles.bubbleTextMine]}>{message.content}</EmojiText>
                      {!mine && message.thinking ? (
                        <Pressable onPress={() => setOpenThink((current) => ({ ...current, [index]: !current[index] }))}>
                          <Text style={styles.thinkToggle}>{openThink[index] ? "Hide thinking" : "Show thinking"}</Text>
                        </Pressable>
                      ) : null}
                      {openThink[index] && message.thinking ? <Text style={styles.thinkBody}>{message.thinking}</Text> : null}
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
                          {(() => {
                            const cited = citedSourceEntries(message.content, message.sources);
                            // Offline pack hits still show when the model never cited [n]
                            // (or failed before writing citations).
                            return cited.length
                              ? cited
                              : message.sources
                                  .map((source, index) => ({ n: index + 1, source }))
                                  .filter(({ source }) => source.offline);
                          })().map(({ n, source }) => {
                            const view = offlineSourceView(source, bag.brainUrl, "");
                            return (
                              <View key={`${source.url}-${n}`}>
                                {view.imageUrl ? (
                                  <OfflinePicture
                                    remoteUrl={view.imageUrl}
                                    style={styles.offlineSourceImage}
                                    label={`Enlarge picture for ${view.title}`}
                                    onOpen={(uri) => setZoomImage(uri)}
                                  />
                                ) : null}
                                <Pressable
                                  onPress={() => {
                                    const target = view.articleUrl || source.url;
                                    if (view.articleUrl) {
                                      void openAuthedPage(target);
                                      return;
                                    }
                                    if (typeof window !== "undefined" && window.open) {
                                      window.open(target, "_blank", "noopener");
                                    }
                                  }}
                                >
                                  <Text style={styles.sourceLink} numberOfLines={2}>
                                    [{n}] {view.tag ? (
                                      <Text style={styles.offlineSourceTag}>{view.tag}</Text>
                                    ) : null}
                                    {view.tag ? " " : ""}
                                    {view.title}
                                  </Text>
                                </Pressable>
                              </View>
                            );
                          })}
                        </View>
                      ) : null}
                      <Text style={[styles.time, mine && styles.timeMine]}>{clock(message.t)}{mine ? (read ? "  ✓✓" : "  ✓") : ""}</Text>
                    </View>
                  </View>
                  {!mine && message.runId ? (
                    <ActivityPanel state={activity.state} runId={message.runId} style={styles.activityInline} />
                  ) : null}
                  </View>
                );
              })}
              {live ? (
                <View style={[styles.bubbleWrap, styles.bubbleLeft]}>
                  <View style={styles.miniBall} />
                  <View style={[styles.bubble, styles.bubbleHis]}>
                    <Text style={styles.bubbleWho}>{replySourceLabel(live.who, live.brain)}</Text>
                    <EmojiText style={styles.bubbleText}>{live.text}</EmojiText>
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
                          {step.status === "done" ? "✓" : step.status === "running" || step.status === "paused" ? "…" : step.status === "error" ? "!" : "•"}{" "}
                          {step.id}. {step.text}
                        </Text>
                      </Pressable>
                      {step.status === "paused" ? (
                        <Text style={styles.stepResult}>Waiting for your Yes or No…</Text>
                      ) : openSteps[step.id] && step.result ? (
                        <Text style={styles.stepResult}>{step.result}</Text>
                      ) : null}
                    </View>
                  ))}
                  {task.status === "paused" || task.status === "error" ? (
                    task.steps.some((step) => step.pendingConfirm && step.pendingConfirm.answered == null) ? null : (
                      <Pressable style={styles.resumeBtn} onPress={() => void resumeTask(task.id)}>
                        <Text style={styles.resumeText}>Resume</Text>
                      </Pressable>
                    )
                  ) : null}
                </View>
              ) : null}
            </ScrollView>
            </View>
            {jumpVisible ? (
              <View style={styles.jumpRow}>
                <Pressable
                  style={styles.jump}
                  onPress={jumpToLatest}
                  accessibilityRole="button"
                  accessibilityLabel="Jump to latest"
                >
                  <Text style={styles.jumpText}>Jump to latest ↓</Text>
                </Pressable>
              </View>
            ) : null}
            {zoomImage ? (
              <Modal visible transparent animationType="fade" onRequestClose={() => setZoomImage("")}>
                <Pressable
                  style={styles.zoomBackdrop}
                  onPress={() => setZoomImage("")}
                  accessibilityRole="button"
                  accessibilityLabel="Close picture"
                >
                  <Image source={{ uri: zoomImage }} style={styles.zoomImage} resizeMode="contain" />
                  <Pressable style={styles.zoomClose} onPress={() => setZoomImage("")}>
                    <Text style={styles.zoomCloseText}>Close</Text>
                  </Pressable>
                </Pressable>
              </Modal>
            ) : null}
            {/* In normal flow right above the composer, so it can never cover it. */}
            <View style={styles.previewRow} pointerEvents="box-none">
              <PreviewCard state={activity.state} runId={lastRunId} mode={preview} brainUrl={bag.brainUrl} />
            </View>
            {chip ? (
              <View style={styles.chipSaved}>
                <Text style={styles.chipSavedText}>✓ {chip}</Text>
              </View>
            ) : null}
            <View style={styles.composerBox}>
              <TextInput
                value={draft}
                onChangeText={setDraft}
                placeholder="Message Preyas..."
                placeholderTextColor={theme.faint}
                style={styles.input}
                onSubmitEditing={submitDraft}
              />
              {micOk ? (
                tap.phase === "recording" ? (
                  <>
                    <Pressable
                      style={styles.tapMicOn}
                      onPress={onMicTap}
                      accessibilityRole="button"
                      accessibilityLabel={`Stop recording, ${formatClock(tapMs)} so far`}
                    >
                      <Text style={styles.tapMicOnText}>●</Text>
                    </Pressable>
                    <Text style={styles.tapTimer}>{formatClock(tapMs)}</Text>
                    <Pressable
                      style={styles.tapCancel}
                      onPress={cancelTapping}
                      accessibilityRole="button"
                      accessibilityLabel="Cancel recording"
                    >
                      <Text style={styles.tapCancelText}>✕</Text>
                    </Pressable>
                  </>
                ) : (
                  <Pressable
                    style={[styles.composerBtn, tap.phase === "transcribing" && styles.composerBtnBusy]}
                    onPress={onMicTap}
                    disabled={tap.phase === "transcribing"}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: tap.phase === "transcribing" }}
                    accessibilityLabel={
                      tap.phase === "transcribing" ? "Turning speech into text" : `Microphone ${phase}`
                    }
                  >
                    <Text style={styles.composerBtnText}>{tap.phase === "transcribing" ? "…" : MIC_ICON[phase] ?? "🎤"}</Text>
                  </Pressable>
                )
              ) : null}
              <Pressable
                style={[styles.thinkBtn, thinkForced && styles.thinkBtnOn]}
                onPress={() => setThinkForced((on) => !on)}
                accessibilityRole="button"
                accessibilityLabel={thinkForced ? "Thinking on" : "Thinking off"}
              >
                <Text style={styles.thinkBtnText}>🧠</Text>
              </Pressable>
              <Pressable
                style={styles.send}
                onPress={submitDraft}
                accessibilityRole="button"
                accessibilityLabel="Send"
              >
                <Text style={styles.sendText}>➤</Text>
              </Pressable>
              {wide ? (
                <HarnessLauncher chatId={activeChatId} onOpenSettings={() => onSection?.("settings")} />
              ) : null}
            </View>
            {tap.phase === "transcribing" ? (
              <Text style={styles.voiceHint}>{TRANSCRIBING_LABEL}</Text>
            ) : tap.phase === "recording" ? (
              <Text style={styles.voiceHint}>Listening… tap ● to stop, ✕ or Esc to cancel</Text>
            ) : tapNote === "heardNothing" ? (
              <Text style={styles.voiceHint}>{HEARD_NOTHING_LABEL}</Text>
            ) : tapNote === "denied" ? (
              <Text style={styles.voiceHint}>{MIC_DENIED_LABEL}</Text>
            ) : null}
            {!micOk ? <Text style={styles.voiceHint}>Voice works on the Mac; type here</Text> : null}
            <View style={[styles.chips, phone && styles.chipsPhone]}>
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
                placeholderTextColor={theme.faint}
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
          <Pressable
            onPress={() => setPendingReminder(null)}
            accessibilityRole="button"
            accessibilityLabel="Close reminder"
          >
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
      {coachPanel ? (
        <CoachPanel
          state={coach.state}
          skills={coach.skills}
          onClose={() => setCoachPanel(false)}
          onStop={() => {
            setCoachPanel(false);
            void coach.turn("stop");
          }}
          onHint={(text) => {
            setCoachPanel(false);
            setNote(text);
          }}
        />
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
              <Pressable
                onPress={() => {
                  setDialog(null);
                  // "No" on a tool-confirm card must reach the running task.
                  if (dialog?.kind === "taskConfirm") {
                    void answerTaskConfirm(dialog.taskId, dialog.stepId, dialog.token, false);
                  }
                }}
              >
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
              Enter the 6-digit code from /Volumes/Agent/BakuganBuddy/memory/pairing-code on the Mac. After pairing, Settings → Open on iPhone shows the code for other devices.
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
              placeholderTextColor={theme.faint}
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
        <View style={styles.profileWrap}>
          <Pressable style={styles.scrim} onPress={() => setProfile(false)} accessibilityLabel="Close profile" />
          <View style={styles.profilePanel}>
            <View style={styles.profileHead}>
              <Text style={styles.sectionTitle} accessibilityRole="header">Profile</Text>
              <Pressable style={styles.profileBtn} onPress={() => setProfile(false)} accessibilityLabel="Close profile">
                <Text style={styles.profileText}>Close ✕</Text>
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={styles.profileBody}>
              <View style={styles.profileHero}>
                {/* fitBox: the pixel Preyas is centred at an integer scale in this box (FIX-2). */}
                <PreyasHeroSwitch talking={phase === "speaking"} short={false} fill fitBox />
              </View>
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
                <View
                  style={styles.track}
                  accessibilityRole="progressbar"
                  accessibilityValue={{ min: 0, max: 100, now: partner.bond }}
                  accessibilityLabel={`Bond ${partner.bond} percent`}
                >
                  <View style={[styles.fillBar, { width: `${partner.bond}%` }]} />
                </View>
                <Text style={styles.caption}>{partner.caption}</Text>
              </View>
              <Text style={styles.dim}>Talking to the local brain.</Text>
            </ScrollView>
          </View>
        </View>
      ) : null}
      {faceOpen ? (
        <FaceMode signals={faceSignals} playback={facePlayback} onClose={() => setFaceOpen(false)} />
      ) : null}
    </View>
  );
}
/** Accent fill (bars, the send button, badges); text that needs contrast uses accentText. */
const aqua = theme.accent;
/** Paper panel: card, hairline accentLine edge, 16px radius, soft drop shadow. */
const panel: ViewStyle = { backgroundColor: theme.card, borderWidth: 1, borderColor: theme.accentLine, borderRadius: 16, shadowColor: theme.shadow, shadowOpacity: 1, shadowRadius: 8, shadowOffset: { width: 0, height: 8 }, elevation: 3 };
/** Secondary paper surface: no shadow, same hairline edge. */
const paperSoft: ViewStyle = { backgroundColor: theme.cardSoft, borderWidth: 1, borderColor: theme.accentLine };
/** Ghost button: hairline lineStrong edge, 10px radius, a 36px-tall hit area. */
const ghost: ViewStyle = { borderWidth: 1, borderColor: theme.lineStrong, borderRadius: 10, minHeight: 36, minWidth: 36, alignItems: "center", justifyContent: "center" };
/** Primary button: accent fill with onAccent text, 10px radius. */
const primary: ViewStyle = { backgroundColor: theme.accent, borderRadius: 10, minHeight: 36, alignItems: "center", justifyContent: "center" };
const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: isWeb ? "transparent" : theme.bg,
    // Belt and braces: no child may widen the page, so it never scrolls sideways.
    overflow: "hidden",
    maxWidth: "100%",
    paddingTop: "env(safe-area-inset-top)" as unknown as number,
    paddingBottom: "env(safe-area-inset-bottom)" as unknown as number,
  },
  voiceHint: { color: theme.dim, fontSize: 11, marginTop: 6, textAlign: "center", width: "100%" },
  pairInput: { fontSize: 24, letterSpacing: 6, textAlign: "center" },
  // Phone: one column with 16px side padding. Mac: chats list + the thread.
  split: { flex: 1, flexDirection: "row", padding: theme.space.md, gap: theme.space.md, minWidth: 0, maxWidth: "100%" },
  stack: { flexDirection: "column", padding: 0, gap: 0 },
  kicker: { color: theme.accentText, fontSize: theme.type.label, fontWeight: "700", letterSpacing: 1.3, textTransform: "uppercase", marginTop: theme.space.sm },
  bigName: { fontFamily: theme.font.display, color: theme.text, fontSize: theme.type.hero * 1.5, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.48 },
  tagline: { color: theme.dim, fontSize: theme.type.body },
  pills: { flexDirection: "row", flexWrap: "wrap", gap: theme.space.sm, marginTop: theme.space.xs },
  pill: { color: theme.text, borderWidth: 1, borderColor: theme.accentLine, borderRadius: theme.radius.md, paddingHorizontal: theme.space.sm + 2, paddingVertical: theme.space.xs + 2, fontSize: theme.type.caption },
  bondCard: { marginTop: theme.space.sm, padding: theme.space.md - 4, borderRadius: 14, ...paperSoft },
  bondHead: { flexDirection: "row", justifyContent: "space-between" },
  bondTitle: { color: theme.text, fontWeight: "700", fontSize: theme.type.body },
  bondPct: { color: theme.accentText, fontWeight: "700", fontSize: theme.type.body },
  track: { height: theme.space.sm, borderRadius: theme.space.xs, backgroundColor: theme.track, marginTop: theme.space.sm, overflow: "hidden" },
  // The Bond bar is a plain accent fill: the stripes never go here.
  fillBar: { height: theme.space.sm, backgroundColor: aqua },
  caption: { color: theme.dim, fontSize: theme.type.caption, marginTop: theme.space.xs + 2 },
  /** Ghost button with a short label (Refresh, Close and the like). */
  profileBtn: { alignSelf: "flex-start", ...ghost, paddingHorizontal: theme.space.md },
  profileText: { color: theme.text, fontSize: theme.type.caption, fontWeight: "600", paddingVertical: theme.space.xs },
  /** The header ghost buttons: View profile and the gear. */
  profileBtnHead: { ...ghost, paddingHorizontal: theme.space.sm + 2 },
  chatCard: { flex: 1, flexDirection: "row", ...panel, padding: theme.space.sm, minHeight: theme.space.xl * 10, minWidth: 0, maxWidth: "100%" },
  thread: { flex: 1, minWidth: 0 },
  /** The reading column: messages, briefing and composer, centred on a Mac. */
  column: { flex: 1, alignSelf: "center", minWidth: 0, paddingHorizontal: theme.space.md },
  /** Extra bottom room so quick-reply chips sit above the phone tab bar. */
  columnPhone: { paddingBottom: theme.space.sm },
  /** The chats list: secondary paper (cardSoft) under the same panel edge. */
  sidebar: { width: theme.size.list, ...panel, backgroundColor: theme.cardSoft, padding: theme.space.sm, marginRight: theme.space.sm },
  sidebarInner: { flex: 1, gap: 8 },
  sidebarHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sidebarTitle: { color: theme.faint, fontSize: theme.type.label, fontWeight: "700", letterSpacing: 1.6 },
  sidebarClose: { color: theme.dim, fontSize: 16, minWidth: 36, minHeight: 36, textAlign: "center", textAlignVertical: "center" },
  newChat: { ...ghost, minHeight: 44, paddingHorizontal: theme.space.sm + 2 },
  newChatText: { color: theme.text, fontSize: 13, fontWeight: "600" },
  chatList: { flex: 1 },
  chatListInner: { gap: theme.space.xs, paddingBottom: theme.space.sm },
  listHide: { borderTopWidth: 1, borderTopColor: theme.accentLine, paddingTop: theme.space.sm, alignItems: "flex-start" },
  listHideText: { color: theme.dim, fontSize: theme.type.caption, fontWeight: "600", minHeight: 36, textAlignVertical: "center" },
  // 3px accent bar on the left of the active row; the left border only shows then.
  chatRow: { flexDirection: "row", alignItems: "center", borderLeftWidth: 3, borderLeftColor: "transparent", borderRadius: 10, paddingHorizontal: 6, paddingVertical: 4, gap: 2, minHeight: 44 },
  chatRowOn: { backgroundColor: theme.accentSoft, borderLeftColor: aqua },
  chatRowMain: { flex: 1, minWidth: 0, justifyContent: "center" },
  chatRowTitle: { color: theme.text, fontSize: 14, fontWeight: "500" },
  chatRowDate: { color: theme.dim, fontSize: 12, marginTop: 1 },
  chatRowIcon: { minWidth: 36, minHeight: 36, alignItems: "center", justifyContent: "center" },
  chatRowIconText: { color: theme.dim, fontSize: 13 },
  chatEmpty: { color: theme.faint, fontSize: 12 },
  emptyChat: { alignItems: "center", paddingVertical: 36, paddingHorizontal: 20, gap: 6 },
  emptyTitle: { color: theme.text, fontSize: 16, fontWeight: "800" },
  emptyText: { color: theme.dim, fontSize: 13, lineHeight: 19, textAlign: "center" },
  chipSaved: { alignSelf: "center", ...paperSoft, borderRadius: theme.radius.md, paddingHorizontal: theme.space.sm + 2, paddingVertical: theme.space.xs, marginBottom: theme.space.xs },
  chipSavedText: { color: theme.accentText, fontSize: 12, fontWeight: "700" },
  noteRow: { flexDirection: "row", alignItems: "flex-start", gap: 6, borderRadius: 16, padding: 12 },
  noteEditing: { flex: 1, gap: 6 },
  kindRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  kindChip: { borderWidth: 1, borderColor: theme.lineStrong, borderRadius: 10, minHeight: 36, alignItems: "center", justifyContent: "center", paddingHorizontal: 8 },
  kindChipOn: { backgroundColor: theme.accentSoft },
  kindText: { color: theme.text, fontSize: theme.type.label },
  noteActions: { flexDirection: "row", justifyContent: "flex-end", gap: 14 },
  noteMain: { flex: 1, minWidth: 0 },
  noteKind: { color: theme.accentText, fontSize: 10, fontWeight: "700", letterSpacing: 1, textTransform: "uppercase" },
  noteText: { color: theme.text, fontSize: 13, lineHeight: 18, marginTop: 2 },
  taskCard: { borderWidth: 1, borderColor: theme.accentLine, borderRadius: 14, backgroundColor: theme.cardSoft, padding: 10, gap: 6, marginTop: 6 },
  taskStatus: { color: theme.accentText, fontSize: 12, fontWeight: "700" },
  stepRow: { gap: 2 },
  stepTitle: { color: theme.text, fontSize: 13 },
  stepResult: { color: theme.dim, fontSize: 12, lineHeight: 17, marginLeft: 14 },
  resumeBtn: { alignSelf: "flex-start", ...ghost, paddingHorizontal: 10, marginTop: 2 },
  resumeText: { color: theme.text, fontSize: 12, fontWeight: "600", paddingVertical: theme.space.xs },
  drawerBtn: { minWidth: 36, minHeight: 36, alignItems: "center", justifyContent: "center" },
  drawerBtnText: { color: theme.dim, fontSize: 20 },
  drawerWrap: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 20, flexDirection: "row" },
  scrim: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: theme.scrim },
  drawer: { width: 260, maxWidth: "82%", backgroundColor: theme.card, borderRightWidth: 1, borderRightColor: theme.accentLine, padding: 12, zIndex: 21 },
  modalWrap: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 30, backgroundColor: theme.scrim, alignItems: "center", justifyContent: "center", padding: 20 },
  modal: { width: "100%", maxWidth: 360, ...panel, padding: 16, gap: 10 },
  modalTitle: { color: theme.text, fontSize: 16, fontWeight: "800" },
  modalBody: { color: theme.dim, fontSize: 13, lineHeight: 19 },
  modalInput: { borderWidth: 1, borderColor: theme.lineStrong, borderRadius: 12, color: theme.text, paddingHorizontal: 10, paddingVertical: 8, fontSize: 16, minHeight: 44 },
  modalRow: { flexDirection: "row", justifyContent: "flex-end", gap: 16, marginTop: 4 },
  modalCancel: { color: theme.text, fontWeight: "700", minHeight: 36, minWidth: 36, textAlign: "center", textAlignVertical: "center" },
  modalOk: { color: theme.accentText, fontWeight: "800", minHeight: 36, minWidth: 36, textAlign: "center", textAlignVertical: "center" },
  modalDanger: { color: theme.danger },
  chatHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space.sm,
    minHeight: theme.size.header,
    paddingHorizontal: theme.space.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.accentLine,
    minWidth: 0,
  },
  chatHeadText: { flex: 1, minWidth: 0 },
  /** Oswald display, the only place the name is set in the heading face. */
  chatName: {
    fontFamily: theme.font.display,
    color: theme.text,
    fontWeight: "700",
    fontSize: 22,
    textTransform: "uppercase",
    letterSpacing: 0.44,
    flexShrink: 1,
  },
  subtitle: { color: theme.dim, fontSize: 13, flexShrink: 1 },
  drawerExtras: { gap: theme.space.xs, marginBottom: theme.space.sm },
  drawerExtraBtn: { ...ghost, minHeight: 44, paddingHorizontal: theme.space.sm + 2, alignSelf: "stretch" },
  drawerExtraText: { color: theme.text, fontSize: 13, fontWeight: "600" },
  onlineRow: { flexDirection: "row", alignItems: "center", gap: theme.space.xs },
  onlineCompact: { display: "none" },
  dot: { width: theme.space.sm, height: theme.space.sm, borderRadius: theme.space.xs },
  dotOn: { backgroundColor: theme.good },
  dotOff: { backgroundColor: theme.off },
  online: { color: theme.dim, fontSize: theme.type.caption },
  bondInline: { width: theme.size.bond, gap: theme.space.xs },
  bondInlineText: { color: theme.dim, fontSize: theme.type.label },
  miniBall: { width: theme.size.dot, height: theme.size.dot, borderRadius: theme.size.dot / 2, backgroundColor: theme.accentSoft, borderWidth: 1, borderColor: aqua },
  log: { flex: 1, width: "100%" },
  /** A message and its Activity panel share one column. */
  msgColumn: { flexDirection: "column", width: "100%" },
  msgHis: { alignItems: "flex-start" },
  msgMine: { alignItems: "flex-end" },
  activityInline: { maxWidth: 420, alignSelf: "flex-start" },
  /** The corner preview lives in the flow above the composer. */
  previewRow: { alignItems: "flex-end", marginTop: theme.space.xs + 2 },
  logWrap: { flex: 1, position: "relative", minHeight: 0 },
  /** Jump sits in normal flow between the log and the composer — never overlays chips. */
  jumpRow: { alignItems: "center", paddingVertical: theme.space.xs },
  jump: { ...panel, borderRadius: 16, minHeight: 36, justifyContent: "center", paddingHorizontal: 12, paddingVertical: 6 },
  jumpText: { color: theme.accentText, fontSize: 12, fontWeight: "700" },
  logInner: { gap: 10, paddingVertical: 8, width: "100%" },
  logInnerJump: { paddingBottom: theme.space.sm },
  // A bubble is capped by the screen, never by a pixel width: 420px overflowed a
  // 390px phone. flexShrink lets the row give way instead of pushing sideways.
  bubbleWrap: { flexDirection: "row", alignItems: "flex-end", gap: theme.space.sm, maxWidth: "75%", flexShrink: 1 },
  bubbleLeft: { alignSelf: "flex-start" },
  bubbleRight: { alignSelf: "flex-end" },
  bubble: { borderRadius: 14, paddingHorizontal: theme.type.body, paddingVertical: theme.space.sm + 2, maxWidth: "100%", flexShrink: 1 },
  /** His: soft paper with a hairline edge. */
  bubbleHis: { ...paperSoft },
  /** Mine: accent fill, onAccent text. */
  bubbleMine: { backgroundColor: theme.accent },
  bubbleWho: { color: theme.accentText, fontSize: theme.type.label, fontWeight: "700", marginBottom: theme.space.xs / 2 },
  bubbleText: {
    color: theme.text,
    fontSize: 15,
    lineHeight: 24,
    flexShrink: 1,
    fontFamily: isWeb ? CHAT_FONT_FAMILY : undefined,
  },
  /** My bubble is accent-filled, so its text is onAccent. */
  bubbleTextMine: { color: theme.onAccent },
  time: { color: theme.faint, fontSize: theme.type.label, marginTop: theme.space.xs, textAlign: "right" },
  /** On the accent bubble, faint text fails contrast. onAccent stays readable. */
  timeMine: { color: theme.onAccent },
  typing: { color: theme.dim, fontSize: 13, marginTop: 4 },
  sources: { marginTop: 6, gap: 2 },
  briefingTop: { marginTop: theme.space.sm },
  /** The briefing card: soft paper, hairline edge, 14px radius. */
  briefingCard: { ...paperSoft, borderRadius: 14, padding: theme.space.sm + 2, gap: theme.space.xs + 2, width: "100%" },
  briefingTitle: { color: theme.accentText, fontSize: theme.type.label, fontWeight: "700", letterSpacing: 1.3, textTransform: "uppercase" },
  briefingText: { color: theme.text, fontSize: 14, lineHeight: 19 },
  briefingItemRow: { flexDirection: "row", gap: 6, alignItems: "flex-start" },
  briefingBullet: { color: theme.text, fontSize: 14, lineHeight: 19 },
  briefingItem: { color: theme.text, fontSize: 14, lineHeight: 19, flexShrink: 1 },
  briefingActions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  modelRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  modelBtn: {
    borderWidth: 1,
    borderColor: theme.accentLine,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: theme.bg,
  },
  modelBtnActive: { borderColor: theme.accent, backgroundColor: theme.accent },
  modelBtnDim: { opacity: 0.5 },
  modelBtnText: { color: theme.text, fontSize: 13, fontWeight: "600" },
  modelBtnTextActive: { color: theme.onAccent },
  phoneCard: { marginVertical: 10, padding: 12, ...paperSoft, borderRadius: 14, gap: 6 },
  phoneUrl: { color: theme.accentText, fontSize: 16, fontWeight: "700" },
  reviewQuestion: { color: theme.text, fontSize: 16, fontWeight: "700", lineHeight: 22 },
  reviewAnswer: { color: theme.dim, fontSize: 14, lineHeight: 20 },
  gradeRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  gradeAgain: { borderColor: theme.danger },
  quizOptions: { gap: 6 },
  reminderBanner: { position: "absolute", top: 56, left: 12, right: 12, zIndex: 15, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, ...panel, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 8 },
  reminderBannerText: { color: theme.text, fontSize: 13, flex: 1 },
  docBtn: { ...ghost, paddingHorizontal: 8 },
  docBtnText: { color: theme.text, fontSize: theme.type.label, fontWeight: "600", paddingVertical: theme.space.xs },
  /** "Study now" in the briefing is the one primary button there. */
  studyNow: { ...primary, paddingHorizontal: theme.space.md - 4 },
  studyNowText: { color: theme.onAccent, fontSize: 12, fontWeight: "700", paddingVertical: theme.space.xs },
  docChoice: { borderWidth: 1, borderColor: theme.accentLine, borderRadius: 10, padding: 8, minHeight: 36, justifyContent: "center" },
  savePoints: { marginTop: 8, alignSelf: "flex-start", ...ghost, borderRadius: 12, paddingHorizontal: 10 },
  savePointsText: { color: theme.text, fontSize: 12, fontWeight: "600", paddingVertical: theme.space.xs },
  sourceLink: { color: theme.accentText, fontSize: 12, textDecorationLine: "underline" },
  offlineSourceTag: { color: theme.faint, fontSize: 11 },
  offlineSourceImage: { width: "100%", height: 180, borderRadius: 12, marginBottom: 6, backgroundColor: theme.off },
  zoomBackdrop: {
    flex: 1,
    backgroundColor: theme.scrim,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.space.md,
  },
  zoomImage: { width: "100%", height: "82%" },
  zoomClose: {
    ...ghost,
    marginTop: theme.space.md,
    borderRadius: 12,
    paddingHorizontal: 16,
    minHeight: 44,
    justifyContent: "center",
  },
  zoomCloseText: { color: theme.onAccent, fontSize: 13, fontWeight: "600" },
  thinkToggle: { color: theme.faint, fontSize: 11, marginTop: 6, minHeight: 36, textAlignVertical: "center" },
  thinkBody: { color: theme.dim, fontSize: 12, marginTop: 4 },
  note: { color: theme.note, fontSize: 13 },
  /** The composer: one paper box holding text, mic, brain and the accent send. */
  composerBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space.sm,
    borderWidth: 1,
    borderColor: theme.lineStrong,
    borderRadius: 12,
    paddingLeft: theme.space.md,
    paddingRight: theme.space.xs,
    paddingVertical: theme.space.xs,
    backgroundColor: theme.card,
    marginTop: theme.space.sm,
    minHeight: 44,
  },
  input: {
    flex: 1,
    minWidth: 0,
    color: theme.text,
    paddingVertical: theme.space.sm,
    fontSize: theme.type.input,
    minHeight: 44,
    fontFamily: isWeb ? CHAT_FONT_FAMILY : undefined,
  },
  /** Mic and attach: 36x36 ghost squares. */
  composerBtn: { width: 36, height: 36, borderRadius: 10, borderWidth: 1, borderColor: theme.lineStrong, alignItems: "center", justifyContent: "center" },
  composerBtnText: { color: theme.text, fontSize: theme.type.title, lineHeight: theme.type.title + 4 },
  /** While waiting for the words the mic is quiet, not disabled-looking. */
  composerBtnBusy: { backgroundColor: theme.accentSoft, borderColor: theme.accentLine },
  /** Recording: accent fill with an onAccent dot, never red (slice V1). */
  tapMicOn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.accent,
    backgroundColor: theme.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  tapMicOnText: { color: theme.onAccent, fontSize: theme.type.body, lineHeight: theme.type.body + 4 },
  /** The mm:ss counter beside the dot, in the display face. */
  tapTimer: {
    fontFamily: theme.font.display,
    color: theme.accentText,
    fontSize: theme.type.display.timer,
    fontWeight: "700",
    minWidth: 38,
    textAlign: "center",
  },
  /** ✕ throws the recording away; it sits where the send button does. */
  tapCancel: {
    width: 36,
    height: 36,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.lineStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  tapCancelText: { color: theme.text, fontSize: theme.type.body, lineHeight: theme.type.body + 4 },
  thinkBtn: { width: 36, height: 36, borderRadius: 10, borderWidth: 1, borderColor: theme.lineStrong, alignItems: "center", justifyContent: "center" },
  thinkBtnOn: { backgroundColor: theme.accentSoft, borderColor: aqua },
  thinkBtnText: { color: theme.text, fontSize: theme.type.body, lineHeight: theme.type.body + 4 },
  /** Send: accent fill, onAccent glyph, 10px radius. */
  send: { ...primary, minHeight: 36, minWidth: 44, paddingHorizontal: theme.space.sm },
  sendText: { color: theme.onAccent, fontSize: theme.type.body, fontWeight: "700" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: theme.space.xs + 2, marginTop: theme.space.sm },
  chipsPhone: { paddingBottom: theme.space.md, marginBottom: theme.space.xs },
  chip: { borderWidth: 1, borderColor: theme.lineStrong, borderRadius: theme.radius.md, minHeight: 36, alignItems: "center", justifyContent: "center", paddingHorizontal: theme.space.sm + 2 },
  chipOff: { opacity: 0.45 },
  chipHint: { backgroundColor: theme.accentSoft },
  chipText: { color: theme.text, fontSize: 12 },
  /** Memory filters sit on the sky, so they use a paper fill. Text on card, and onAccent on the selected accent fill, both pass WCAG AA. */
  filterChip: {
    borderWidth: 1,
    borderColor: theme.lineStrong,
    borderRadius: theme.radius.md,
    minHeight: 36,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: theme.space.sm + 2,
    backgroundColor: theme.card,
  },
  filterChipOn: { backgroundColor: theme.accent, borderColor: theme.accent },
  filterChipText: { color: theme.text, fontSize: 12, fontWeight: "600" },
  filterChipTextOn: { color: theme.onAccent },
  /** Search field on the sky: paper fill so placeholder and typed text meet AA. */
  searchInput: {
    borderWidth: 1,
    borderColor: theme.lineStrong,
    borderRadius: 12,
    backgroundColor: theme.card,
    color: theme.text,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 16,
    minHeight: 44,
  },
  solidCard: {
    backgroundColor: theme.card,
    borderWidth: 1,
    borderColor: theme.accentLine,
    borderRadius: 16,
    shadowColor: theme.shadow,
    shadowOpacity: 1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  pageGrid: { gap: theme.space.sm },
  pageGridWide: { flexDirection: "row", flexWrap: "wrap" },
  pageGridItem: { width: "48%", flexGrow: 1 },
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: theme.space.sm },
  fill: { flex: 1 },
  pad: { padding: 20, gap: 8 },
  dim: { color: theme.dim, fontSize: 14 },
  // Profile: a centred paper panel that holds the hero, pills and Bond card.
  profileWrap: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 25, alignItems: "center", justifyContent: "center", padding: theme.space.md },
  profilePanel: {
    width: "100%",
    maxWidth: theme.size.maxChat / 2,
    maxHeight: "100%",
    ...panel,
    padding: theme.space.md,
    gap: theme.space.sm,
  },
  profileHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  profileBody: { gap: theme.space.xs, paddingBottom: theme.space.sm },
  profileHero: { height: theme.space.xl * 8 },
  /** One heading per screen, in the same Oswald style as SectionTitle. */
  sectionTitle: { fontFamily: theme.font.display, color: theme.text, fontWeight: "700", fontSize: theme.type.display.section, textTransform: "uppercase", letterSpacing: 0.78 },
  /** Page titles and notes drawn on the sky (Learn, Memory, Settings). */
  skyTitle: { fontFamily: theme.font.display, color: theme.onSky, fontWeight: "700", fontSize: theme.type.display.section, textTransform: "uppercase", letterSpacing: 0.78 },
  skyNote: { color: theme.onSkyMuted, fontSize: 14, lineHeight: 20 },
  gearBtn: { ...ghost },
  gearText: { color: theme.text, fontSize: 18, lineHeight: 22 },
  briefingCardHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  briefingRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  advRow: { flexDirection: "row", flexWrap: "wrap", gap: 16 },
  advLink: { color: theme.accentText, fontSize: 14, fontWeight: "700", paddingVertical: 4, minHeight: 36, textAlignVertical: "center" },
  memHead: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 4, gap: 8 },
  emptyTab: { marginTop: 16, alignItems: "center", gap: 6 },
  deckRow: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 16, padding: 12 },
  deckTitle: { color: theme.text, fontSize: 14, fontWeight: "700" },
  deckBtn: { ...ghost, paddingHorizontal: 10 },
  deckBtnText: { color: theme.text, fontSize: 12, fontWeight: "600", paddingVertical: theme.space.xs },
});
