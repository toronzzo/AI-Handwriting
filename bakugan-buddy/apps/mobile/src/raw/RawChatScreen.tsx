/**
 * Raw Qwen: a plain llama.cpp chat, laid out like llama-server's built-in web
 * UI (left chat list, centred empty state, bubbles, thinking block, message
 * stats and a rounded composer). The layout is recreated for Expo; the
 * llama.cpp web UI itself is MIT licensed (see RAW_QWEN_LICENSE.md).
 *
 * Raw chats are device-local (AsyncStorage under RAW_CHATS_KEY). This screen
 * never calls the brain's chat, memory or facts routes.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { theme } from "../theme";
import { brainFetch } from "../room/brain/token";
import { currentBrainUrl } from "../room/brain/brainLink";
import {
  DEFAULT_RAW_SETTINGS,
  addRawMessage,
  formatRawStats,
  liveStats,
  loadRawChats,
  loadRawSettings,
  newRawChat,
  normalizeRawSettings,
  parseRawSse,
  rawChatPayload,
  removeRawChat,
  saveRawChats,
  saveRawSettings,
  statsFromTimings,
  upsertRawChat,
  type RawChat,
  type RawMessage,
  type RawSettings,
  type RawSseFrame,
  type RawStats,
} from "./rawChatModel";

type Props = { brainUrl?: string };

type SettingsDraft = {
  temperature: string;
  topP: string;
  maxTokens: string;
  systemPrompt: string;
};

function draftFromSettings(settings: RawSettings): SettingsDraft {
  return {
    temperature: String(settings.temperature),
    topP: String(settings.topP),
    maxTokens: String(settings.maxTokens),
    systemPrompt: settings.systemPrompt,
  };
}

function isAbort(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "name" in error && (error as { name?: string }).name === "AbortError");
}

async function responseError(res: Response): Promise<string> {
  const raw = await res.text().catch(() => "");
  try {
    const body = JSON.parse(raw) as { error?: unknown };
    if (typeof body.error === "string" && body.error.trim()) return body.error;
  } catch {
    /* not JSON */
  }
  if (res.status === 401 || res.status === 429) return "Pair this device with the Mac first.";
  return raw.trim() || "The brain answered " + res.status + ".";
}

export function RawChatScreen({ brainUrl }: Props = {}) {
  const { width } = useWindowDimensions();
  const wide = width >= 760;
  const [chats, setChats] = useState<RawChat[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [settings, setSettings] = useState<RawSettings>(DEFAULT_RAW_SETTINGS);
  const [draft, setDraft] = useState<SettingsDraft>(() => draftFromSettings(DEFAULT_RAW_SETTINGS));
  const [input, setInput] = useState("");
  const [ready, setReady] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState("");
  const [showList, setShowList] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [thinkingOpen, setThinkingOpen] = useState<Record<string, boolean>>({});
  const chatsRef = useRef<RawChat[]>([]);
  const activeIdRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const streamingRef = useRef(false);
  const listRef = useRef<FlatList<RawMessage>>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [storedChats, storedSettings] = await Promise.all([
        loadRawChats(AsyncStorage),
        loadRawSettings(AsyncStorage),
      ]);
      if (cancelled) return;
      chatsRef.current = storedChats;
      setChats(storedChats);
      setActiveId(storedChats[0]?.id ?? null);
      activeIdRef.current = storedChats[0]?.id ?? null;
      setSettings(storedSettings);
      setDraft(draftFromSettings(storedSettings));
      setReady(true);
    })();
    return () => {
      cancelled = true;
      abortRef.current?.abort();
    };
  }, []);

  const persistChats = useCallback((next: RawChat[]) => {
    chatsRef.current = next;
    setChats(next);
    void saveRawChats(AsyncStorage, next).catch(() => {
      /* a failed save keeps the screen usable for this session */
    });
  }, []);

  const showLive = useCallback((chatId: string, messageId: string, patch: Partial<RawMessage>) => {
    setChats((previous) => {
      const next = previous.map((chat) =>
        chat.id === chatId
          ? {
              ...chat,
              updatedAt: Date.now(),
              messages: chat.messages.map((message) => (message.id === messageId ? { ...message, ...patch } : message)),
            }
          : chat,
      );
      chatsRef.current = next;
      return next;
    });
  }, []);

  const activeChat = chats.find((chat) => chat.id === activeId) ?? null;
  const messages = activeChat?.messages ?? [];

  const openChat = (id: string) => {
    setActiveId(id);
    activeIdRef.current = id;
    setShowList(false);
    setError("");
  };

  const startNewChat = () => {
    if (streamingRef.current) abortRef.current?.abort();
    const chat = newRawChat();
    persistChats(upsertRawChat(chatsRef.current, chat));
    setActiveId(chat.id);
    activeIdRef.current = chat.id;
    setInput("");
    setError("");
    setShowList(false);
  };

  const removeChat = (id: string) => {
    if (streamingRef.current && activeIdRef.current === id) abortRef.current?.abort();
    const next = removeRawChat(chatsRef.current, id);
    persistChats(next);
    if (activeIdRef.current === id) {
      const nextId = next[0]?.id ?? null;
      setActiveId(nextId);
      activeIdRef.current = nextId;
    }
  };

  const stopReply = () => {
    abortRef.current?.abort();
  };

  const applySettings = () => {
    const next = normalizeRawSettings({
      temperature: Number(draft.temperature),
      topP: Number(draft.topP),
      maxTokens: Number(draft.maxTokens),
      systemPrompt: draft.systemPrompt,
    });
    setSettings(next);
    setDraft(draftFromSettings(next));
    setSettingsOpen(false);
    void saveRawSettings(AsyncStorage, next).catch(() => {
      /* the settings still apply for this session */
    });
  };

  const resetSettings = () => {
    setDraft(draftFromSettings(DEFAULT_RAW_SETTINGS));
  };

  const toggleThinking = (messageId: string) => {
    setThinkingOpen((current) => ({ ...current, [messageId]: current[messageId] === false }));
  };

  const send = async () => {
    const text = input.trim();
    if (!text || streamingRef.current) return;
    setInput("");
    setError("");

    let chat = activeChat;
    if (!chat) {
      chat = newRawChat();
      persistChats(upsertRawChat(chatsRef.current, chat));
      setActiveId(chat.id);
      activeIdRef.current = chat.id;
    }

    const now = Date.now();
    const userMessage: RawMessage = {
      id: "user-" + now,
      role: "user",
      content: text,
      reasoning: "",
      stats: null,
      at: now,
    };
    const assistantId = "qwen-" + (now + 1) + "-" + Math.random().toString(36).slice(2, 7);
    const assistantMessage: RawMessage = {
      id: assistantId,
      role: "assistant",
      content: "",
      reasoning: "",
      stats: null,
      at: now + 1,
    };
    const withUser = addRawMessage(chat, userMessage);
    const withAssistant = addRawMessage(withUser, assistantMessage);
    const chatId = chat.id;
    persistChats(upsertRawChat(chatsRef.current, withAssistant));

    const payload = rawChatPayload(withUser, settings);
    const base = (brainUrl || currentBrainUrl()).replace(/\/$/, "");
    const controller = new AbortController();
    abortRef.current = controller;
    streamingRef.current = true;
    setStreaming(true);

    let content = "";
    let reasoning = "";
    let stats: RawStats | null = null;
    let chunks = 0;
    const startedAt = Date.now();

    const applyFrame = (frame: RawSseFrame) => {
      if (frame.done) return;
      let touched = false;
      if (frame.reasoning) {
        reasoning += frame.reasoning;
        chunks += 1;
        touched = true;
      }
      if (frame.content) {
        content += frame.content;
        chunks += 1;
        touched = true;
      }
      if (frame.timings && (frame.timings.predicted_n || 0) > 0) {
        stats = statsFromTimings(frame.timings, startedAt, Date.now(), chunks);
        touched = true;
      } else if (touched && !stats) {
        stats = liveStats(chunks, startedAt, Date.now());
      }
      if (touched) {
        showLive(chatId, assistantId, { content, reasoning, stats });
      }
    };

    try {
      const res = await brainFetch(base + "/v1/raw/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(await responseError(res));
      if (!res.body) throw new Error("The brain did not stream a reply.");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const step = await reader.read();
        if (step.done) break;
        buffer += decoder.decode(step.value, { stream: true });
        const parsed = parseRawSse(buffer);
        buffer = parsed.rest;
        for (const frame of parsed.frames) applyFrame(frame);
      }
      buffer += decoder.decode();
      for (const frame of parseRawSse(buffer + "\n\n").frames) applyFrame(frame);
      if (!stats) stats = liveStats(chunks, startedAt, Date.now());
      showLive(chatId, assistantId, { content, reasoning, stats, stopped: false });
      if (!content && reasoning) {
        showLive(chatId, assistantId, { content: "…", reasoning, stats, stopped: false });
      }
    } catch (caught) {
      const stopped = controller.signal.aborted || isAbort(caught);
      const message = stopped ? "" : caught instanceof Error ? caught.message : "Raw chat failed.";
      const failure = message ? "Could not reach llama-server. " + message : "Stopped.";
      showLive(chatId, assistantId, {
        content: content || failure,
        reasoning,
        stats,
        stopped: true,
      });
      if (message) setError(message);
    } finally {
      streamingRef.current = false;
      setStreaming(false);
      abortRef.current = null;
      persistChats(chatsRef.current);
    }
  };

  if (!ready) {
    return (
      <View style={styles.root}>
        <Text style={styles.loading}>Loading raw chats…</Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text style={styles.title} accessibilityRole="header">
            Raw Qwen
          </Text>
          <Text style={styles.subtitle}>llama.cpp chat · on this device</Text>
        </View>
        <View style={styles.headerActions}>
          {!wide ? (
            <Pressable
              style={styles.headButton}
              onPress={() => setShowList((open) => !open)}
              accessibilityRole="button"
              accessibilityLabel="Show raw chat conversations"
              testID="raw-chat-list-toggle"
            >
              <Text style={styles.headButtonText}>Chats</Text>
            </Pressable>
          ) : null}
          <Pressable
            style={styles.headButton}
            onPress={startNewChat}
            accessibilityRole="button"
            accessibilityLabel="New raw chat"
          >
            <Text style={styles.headButtonText}>New</Text>
          </Pressable>
          <Pressable
            style={styles.headButton}
            onPress={() => {
              setDraft(draftFromSettings(settings));
              setSettingsOpen(true);
            }}
            accessibilityRole="button"
            accessibilityLabel="Raw chat settings"
            testID="raw-chat-settings-button"
          >
            <Text style={styles.headButtonText}>Settings</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.body}>
        {wide ? (
          <ChatList
            chats={chats}
            activeId={activeId}
            onSelect={openChat}
            onDelete={removeChat}
            onNew={startNewChat}
            wide
          />
        ) : null}
        {!wide && showList ? (
          <>
            <Pressable
              style={styles.listScrim}
              onPress={() => setShowList(false)}
              accessibilityRole="button"
              accessibilityLabel="Close raw chat conversations"
            />
            <ChatList
              chats={chats}
              activeId={activeId}
              onSelect={openChat}
              onDelete={removeChat}
              onNew={startNewChat}
              wide={false}
            />
          </>
        ) : null}

        <KeyboardAvoidingView
          style={styles.thread}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(message) => message.id}
            contentContainerStyle={[styles.threadContent, messages.length === 0 && styles.threadEmpty]}
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={
              <View style={styles.empty}>
                <Text style={styles.emptyTitle}>Hello there</Text>
                <Text style={styles.emptyCopy}>Type a message to get started.</Text>
                <Text style={styles.emptyHint}>
                  Raw Qwen talks to llama-server directly. Nothing here is added to Preyas&apos;s notes or Memory.
                </Text>
              </View>
            }
            renderItem={({ item }) => (
              <MessageBubble
                message={item}
                thinkingOpen={thinkingOpen[item.id] !== false}
                live={streaming && item === messages[messages.length - 1]}
                onToggleThinking={() => toggleThinking(item.id)}
              />
            )}
          />

          {error ? (
            <Text style={styles.error} accessibilityRole="alert">
              {error}
            </Text>
          ) : null}

          <View style={styles.composer}>
            <TextInput
              style={styles.input}
              value={input}
              onChangeText={setInput}
              placeholder="Type a message…"
              placeholderTextColor={theme.faint}
              multiline
              editable={!streaming}
              accessibilityLabel="Raw chat message"
              testID="raw-chat-input"
            />
            {streaming ? (
              <Pressable
                style={styles.stopButton}
                onPress={stopReply}
                accessibilityRole="button"
                accessibilityLabel="Stop reply"
                testID="raw-chat-stop"
              >
                <Text style={styles.stopText}>■ Stop</Text>
              </Pressable>
            ) : (
              <Pressable
                style={[styles.sendButton, !input.trim() && styles.sendButtonOff]}
                onPress={() => void send()}
                disabled={!input.trim()}
                accessibilityRole="button"
                accessibilityLabel="Send raw chat message"
                testID="raw-chat-send"
              >
                <Text style={styles.sendText}>↑ Send</Text>
              </Pressable>
            )}
          </View>
          <Text style={styles.localNote}>
            Saved on this device only · no Memory writes · llama.cpp
          </Text>
        </KeyboardAvoidingView>

        {settingsOpen ? (
          <SettingsPanel
            draft={draft}
            onChange={setDraft}
            onApply={applySettings}
            onReset={resetSettings}
            onClose={() => setSettingsOpen(false)}
          />
        ) : null}
      </View>
    </View>
  );
}

function ChatList({
  chats,
  activeId,
  onSelect,
  onDelete,
  onNew,
  wide,
}: {
  chats: RawChat[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onNew: () => void;
  wide: boolean;
}) {
  return (
    <View style={[styles.list, wide ? styles.listWide : styles.listOverlay]} testID="raw-chat-list">
      <View style={styles.listHead}>
        <Text style={styles.listTitle} accessibilityRole="header">
          Chats
        </Text>
        <Pressable
          style={styles.newChatButton}
          onPress={onNew}
          accessibilityRole="button"
          accessibilityLabel="New raw chat from list"
        >
          <Text style={styles.newChatText}>+ New</Text>
        </Pressable>
      </View>
      <ScrollView style={styles.listScroll} keyboardShouldPersistTaps="handled">
        {chats.length === 0 ? <Text style={styles.listEmpty}>No raw chats yet.</Text> : null}
        {chats.map((chat) => (
          <View key={chat.id} style={[styles.chatRow, chat.id === activeId && styles.chatRowOn]}>
            <Pressable
              style={styles.chatRowMain}
              onPress={() => onSelect(chat.id)}
              accessibilityRole="button"
              accessibilityLabel={"Open " + chat.title}
            >
              <Text style={styles.chatRowTitle} numberOfLines={1}>
                {chat.title}
              </Text>
              <Text style={styles.chatRowDate}>
                {new Date(chat.updatedAt).toLocaleDateString()}
              </Text>
            </Pressable>
            <Pressable
              style={styles.chatRowDelete}
              onPress={() => onDelete(chat.id)}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel={"Delete " + chat.title}
            >
              <Text style={styles.chatRowDeleteText}>×</Text>
            </Pressable>
          </View>
        ))}
      </ScrollView>
      <Text style={styles.listNote}>Saved on this device only.</Text>
    </View>
  );
}

function MessageBubble({
  message,
  thinkingOpen,
  live,
  onToggleThinking,
}: {
  message: RawMessage;
  thinkingOpen: boolean;
  live: boolean;
  onToggleThinking: () => void;
}) {
  const user = message.role === "user";
  const stats = formatRawStats(message.stats);
  return (
    <View
      style={[styles.messageRow, user ? styles.messageRowUser : styles.messageRowAssistant]}
      testID={"raw-message-" + message.id}
    >
      {!user ? (
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>Q</Text>
        </View>
      ) : null}
      <View style={[styles.bubble, user ? styles.userBubble : styles.assistantBubble]}>
        {!user && message.reasoning ? (
          <View style={styles.thinking}>
            <Pressable
              style={styles.thinkingHead}
              onPress={onToggleThinking}
              accessibilityRole="button"
              accessibilityLabel={thinkingOpen ? "Hide thinking" : "Show thinking"}
              testID={"raw-thinking-toggle-" + message.id}
            >
              <Text style={styles.thinkingTitle}>{live ? "Thinking…" : "Thinking"}</Text>
              <Text style={styles.thinkingToggle}>{thinkingOpen ? "Hide" : "Show"}</Text>
            </Pressable>
            {thinkingOpen ? (
              <ScrollView style={styles.thinkingBody} nestedScrollEnabled>
                <Text style={styles.thinkingText} selectable>
                  {message.reasoning}
                </Text>
              </ScrollView>
            ) : null}
          </View>
        ) : null}
        <Text
          style={[styles.messageText, user ? styles.userText : styles.assistantText]}
          selectable
        >
          {message.content || (user ? "" : "…")}
        </Text>
        {!user && stats ? (
          <Text style={styles.stats}>
            {stats}
            {message.stopped ? " · stopped" : ""}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function SettingsPanel({
  draft,
  onChange,
  onApply,
  onReset,
  onClose,
}: {
  draft: SettingsDraft;
  onChange: (next: SettingsDraft) => void;
  onApply: () => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const patch = (field: keyof SettingsDraft, value: string) => onChange({ ...draft, [field]: value });
  return (
    <View style={styles.modalScrim} testID="raw-chat-settings-panel">
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Close raw chat settings"
      />
      <View style={styles.settingsCard}>
        <ScrollView keyboardShouldPersistTaps="handled">
          <Text style={styles.settingsTitle}>Raw chat settings</Text>
          <Text style={styles.fieldLabel}>Temperature</Text>
          <TextInput
            style={styles.fieldInput}
            value={draft.temperature}
            onChangeText={(value) => patch("temperature", value)}
            keyboardType="decimal-pad"
            accessibilityLabel="Temperature"
          />
          <Text style={styles.fieldHelp}>0 is focused, 2 is wild. llama default is 0.7.</Text>

          <Text style={styles.fieldLabel}>Top P</Text>
          <TextInput
            style={styles.fieldInput}
            value={draft.topP}
            onChangeText={(value) => patch("topP", value)}
            keyboardType="decimal-pad"
            accessibilityLabel="Top P"
          />
          <Text style={styles.fieldHelp}>Keep the smallest set of tokens with this total probability.</Text>

          <Text style={styles.fieldLabel}>Max tokens</Text>
          <TextInput
            style={styles.fieldInput}
            value={draft.maxTokens}
            onChangeText={(value) => patch("maxTokens", value)}
            keyboardType="number-pad"
            accessibilityLabel="Max tokens"
          />
          <Text style={styles.fieldHelp}>The reply stops at this many tokens.</Text>

          <Text style={styles.fieldLabel}>System prompt</Text>
          <TextInput
            style={[styles.fieldInput, styles.fieldArea]}
            value={draft.systemPrompt}
            onChangeText={(value) => patch("systemPrompt", value)}
            multiline
            placeholder="Optional instructions sent before the chat…"
            placeholderTextColor={theme.faint}
            accessibilityLabel="System prompt"
          />
          <Text style={styles.fieldHelp}>Sent first on every request. Raw chats stay out of Preyas Memory.</Text>

          <View style={styles.panelActions}>
            <Pressable style={styles.panelButton} onPress={onReset} accessibilityRole="button">
              <Text style={styles.panelButtonText}>Reset</Text>
            </Pressable>
            <Pressable style={styles.panelButton} onPress={onClose} accessibilityRole="button">
              <Text style={styles.panelButtonText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={[styles.panelButton, styles.panelButtonPrimary]}
              onPress={onApply}
              accessibilityRole="button"
              accessibilityLabel="Apply raw chat settings"
            >
              <Text style={[styles.panelButtonText, styles.panelButtonPrimaryText]}>Apply</Text>
            </Pressable>
          </View>
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg, minHeight: 0 },
  loading: { color: theme.onSky, padding: 24 },
  header: {
    minHeight: 56,
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.space.sm,
    backgroundColor: theme.card,
    borderBottomWidth: 1,
    borderBottomColor: theme.accentLine,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.space.sm,
    flexWrap: "wrap",
  },
  headerCopy: { gap: 2, minWidth: 140 },
  title: { color: theme.text, fontSize: theme.type.title, fontWeight: "800" },
  subtitle: { color: theme.dim, fontSize: theme.type.caption },
  headerActions: { flexDirection: "row", gap: theme.space.xs, alignItems: "center" },
  headButton: {
    paddingHorizontal: theme.space.sm,
    paddingVertical: theme.space.xs + 2,
    minHeight: 36,
    justifyContent: "center",
    backgroundColor: theme.accentSoft,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    borderColor: theme.accentLine,
  },
  headButtonText: { color: theme.accentText, fontSize: theme.type.caption, fontWeight: "700" },
  body: { flex: 1, flexDirection: "row", minHeight: 0 },
  list: { backgroundColor: theme.card, minHeight: 0 },
  listWide: { width: 260, borderRightWidth: 1, borderRightColor: theme.accentLine },
  listOverlay: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    width: 286,
    zIndex: 30,
    borderRightWidth: 1,
    borderRightColor: theme.accentLine,
    shadowColor: theme.shadow,
    shadowOpacity: 1,
    shadowRadius: 12,
    shadowOffset: { width: 6, height: 0 },
    elevation: 6,
  },
  listScrim: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: theme.scrim, zIndex: 20 },
  listHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: theme.space.md,
    paddingTop: theme.space.md,
    paddingBottom: theme.space.sm,
    gap: theme.space.sm,
  },
  listTitle: { color: theme.text, fontSize: theme.type.body, fontWeight: "800" },
  newChatButton: {
    paddingHorizontal: theme.space.sm,
    paddingVertical: theme.space.xs,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.accentSoft,
  },
  newChatText: { color: theme.accentText, fontSize: theme.type.caption, fontWeight: "700" },
  listScroll: { flex: 1, paddingHorizontal: theme.space.sm },
  listEmpty: { color: theme.dim, fontSize: theme.type.caption, padding: theme.space.md },
  chatRow: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: theme.radius.sm,
    marginBottom: 2,
  },
  chatRowOn: { backgroundColor: theme.accentSoft },
  chatRowMain: { flex: 1, minWidth: 0, paddingHorizontal: theme.space.sm, paddingVertical: theme.space.sm },
  chatRowTitle: { color: theme.text, fontSize: theme.type.caption, fontWeight: "600" },
  chatRowDate: { color: theme.faint, fontSize: theme.type.label, marginTop: 2 },
  chatRowDelete: { paddingHorizontal: theme.space.sm, paddingVertical: theme.space.xs },
  chatRowDeleteText: { color: theme.dim, fontSize: theme.type.title },
  listNote: {
    color: theme.faint,
    fontSize: theme.type.label,
    padding: theme.space.md,
    borderTopWidth: 1,
    borderTopColor: theme.accentLine,
  },
  thread: { flex: 1, minWidth: 0, backgroundColor: theme.bg },
  threadContent: { padding: theme.space.md, gap: theme.space.md, paddingBottom: theme.space.lg },
  threadEmpty: { flexGrow: 1, justifyContent: "center" },
  empty: { alignItems: "center", gap: theme.space.sm, padding: theme.space.lg },
  emptyTitle: { color: theme.onSky, fontSize: theme.type.hero, fontWeight: "800" },
  emptyCopy: { color: theme.onSky, fontSize: theme.type.body },
  emptyHint: { color: theme.onSkyMuted, fontSize: theme.type.caption, textAlign: "center", maxWidth: 420, lineHeight: 18 },
  messageRow: { flexDirection: "row", alignItems: "flex-end", gap: theme.space.sm, maxWidth: "100%" },
  messageRowUser: { justifyContent: "flex-end" },
  messageRowAssistant: { justifyContent: "flex-start" },
  avatar: {
    width: theme.size.dot,
    height: theme.size.dot,
    borderRadius: theme.size.dot / 2,
    backgroundColor: theme.accent,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 2,
  },
  avatarText: { color: theme.onAccent, fontSize: theme.type.label, fontWeight: "800" },
  bubble: {
    maxWidth: "86%",
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.space.sm + 2,
    borderWidth: 1,
  },
  userBubble: { backgroundColor: theme.accent, borderColor: theme.accent, borderBottomRightRadius: theme.space.xs },
  assistantBubble: { backgroundColor: theme.card, borderColor: theme.accentLine, borderBottomLeftRadius: theme.space.xs },
  messageText: { fontSize: theme.type.body, lineHeight: theme.lead },
  userText: { color: theme.onAccent },
  assistantText: { color: theme.text },
  stats: { color: theme.faint, fontSize: theme.type.label, marginTop: theme.space.xs, fontFamily: "monospace" },
  thinking: {
    borderWidth: 1,
    borderColor: theme.accentLine,
    backgroundColor: theme.cardSoft,
    borderRadius: theme.radius.sm,
    marginBottom: theme.space.sm,
    overflow: "hidden",
  },
  thinkingHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: theme.space.sm,
    paddingVertical: theme.space.xs + 2,
    gap: theme.space.sm,
  },
  thinkingTitle: { color: theme.accentText, fontSize: theme.type.caption, fontWeight: "700" },
  thinkingToggle: { color: theme.dim, fontSize: theme.type.label },
  thinkingBody: { maxHeight: 180, paddingHorizontal: theme.space.sm, paddingBottom: theme.space.sm },
  thinkingText: { color: theme.dim, fontSize: theme.type.caption, lineHeight: 18, fontFamily: "monospace" },
  error: {
    color: theme.danger,
    backgroundColor: theme.card,
    fontSize: theme.type.caption,
    marginHorizontal: theme.space.md,
    marginBottom: theme.space.xs,
    padding: theme.space.sm,
    borderRadius: theme.radius.sm,
  },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: theme.space.sm,
    marginHorizontal: theme.space.md,
    marginBottom: theme.space.xs,
    padding: theme.space.sm,
    backgroundColor: theme.card,
    borderWidth: 1,
    borderColor: theme.accentLine,
    borderRadius: theme.radius.lg,
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 140,
    color: theme.text,
    fontSize: theme.type.input,
    paddingHorizontal: theme.space.sm,
    paddingVertical: theme.space.sm,
  },
  sendButton: {
    minHeight: 40,
    paddingHorizontal: theme.space.md,
    borderRadius: theme.radius.md,
    backgroundColor: theme.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  sendButtonOff: { opacity: 0.45 },
  sendText: { color: theme.onAccent, fontSize: theme.type.caption, fontWeight: "800" },
  stopButton: {
    minHeight: 40,
    paddingHorizontal: theme.space.md,
    borderRadius: theme.radius.md,
    backgroundColor: theme.cardSoft,
    borderWidth: 1,
    borderColor: theme.accentLine,
    alignItems: "center",
    justifyContent: "center",
  },
  stopText: { color: theme.text, fontSize: theme.type.caption, fontWeight: "800" },
  localNote: {
    color: theme.onSkyMuted,
    fontSize: theme.type.label,
    textAlign: "center",
    paddingBottom: theme.space.sm,
    paddingHorizontal: theme.space.md,
  },
  modalScrim: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: theme.scrim,
    zIndex: 40,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.space.md,
  },
  settingsCard: {
    width: "100%",
    maxWidth: 440,
    maxHeight: "88%",
    backgroundColor: theme.card,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.accentLine,
    padding: theme.space.lg,
    shadowColor: theme.shadow,
    shadowOpacity: 1,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  settingsTitle: { color: theme.text, fontSize: theme.type.title, fontWeight: "800", marginBottom: theme.space.md },
  fieldLabel: { color: theme.text, fontSize: theme.type.caption, fontWeight: "700", marginTop: theme.space.sm, marginBottom: theme.space.xs },
  fieldInput: {
    borderWidth: 1,
    borderColor: theme.accentLine,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.cardSoft,
    color: theme.text,
    paddingHorizontal: theme.space.sm,
    paddingVertical: theme.space.sm,
    fontSize: theme.type.input,
  },
  fieldArea: { minHeight: 96, textAlignVertical: "top" },
  fieldHelp: { color: theme.faint, fontSize: theme.type.label, marginTop: theme.space.xs, lineHeight: 15 },
  panelActions: { flexDirection: "row", justifyContent: "flex-end", gap: theme.space.sm, marginTop: theme.space.lg },
  panelButton: {
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.space.sm,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    borderColor: theme.accentLine,
    backgroundColor: theme.cardSoft,
  },
  panelButtonPrimary: { backgroundColor: theme.accent, borderColor: theme.accent },
  panelButtonText: { color: theme.text, fontSize: theme.type.caption, fontWeight: "700" },
  panelButtonPrimaryText: { color: theme.onAccent },
});
