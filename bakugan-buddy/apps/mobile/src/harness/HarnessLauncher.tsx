/**
 * The Generate button beside the composer (slice 13).
 *
 * Press it, say what Harness should build, and Preyas drafts the prompt with the
 * local model. The card shows the prompt, a rough cost and today's spend, then
 * Да starts the one run and Нет cancels. Nothing starts without Да, and the
 * brain refuses everything that is over the daily cap or missing a price.
 *
 * While a run is going the card shows the Live Activity steps (slice 12) and a
 * Stop button that stays visible. When the run ends the card closes and the
 * summary arrives in the chat as a normal message. Mac layout only for now.
 */
import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { ActivityPanel } from "../activity/ActivityPanel";
import { useActivity } from "../activity/useActivity";
import { CopyButton } from "../chat/CopyButton.tsx";
import { currentBrainUrl } from "../room/brain/brainLink";
import { formatEstimate, todayLine } from "../settings/dailyLimit";
import { Panel } from "../ui/Panel";
import { theme } from "../theme";
import { useHarness } from "./useHarness";

const GOAL_MAX = 400;
const PROMPT_PREVIEW_LINES = 6;

export function HarnessLauncher({
  chatId,
  onOpenSettings,
}: {
  chatId: string | null;
  onOpenSettings?: () => void;
}) {
  const { status, result, error, busy, draft, answer, stop, reset } = useHarness(chatId);
  const [open, setOpen] = useState(false);
  const [goal, setGoal] = useState("");
  const [showAll, setShowAll] = useState(false);
  const running = status?.state === "running";
  const notConfigured = status?.adapter === "not-configured";
  const runId = running && status ? status.runId : "";
  const activity = useActivity({ runId, active: Boolean(running), brainUrl: currentBrainUrl() });
  const wasRunning = useRef(false);

  // A finished run closes the card: the summary is already a chat message.
  useEffect(() => {
    if (running) {
      wasRunning.current = true;
      return;
    }
    if (!wasRunning.current) return;
    wasRunning.current = false;
    setOpen(false);
    setShowAll(false);
  }, [running]);

  const promptLines = result ? result.draft.prompt.split("\n") : [];
  const shownPrompt = showAll
    ? promptLines.join("\n")
    : promptLines.slice(0, PROMPT_PREVIEW_LINES).join("\n");
  const canRun = Boolean(result && result.canStart.ok && !result.draft.used);
  const reason = result && !canRun ? result.canStart.reason || "This draft cannot start." : "";
  const cardOpen = open || running;

  return (
    <View style={styles.wrap}>
      <Pressable
        style={[styles.ghost, running && styles.off]}
        disabled={running}
        onPress={() => {
          setOpen((value) => !value);
          setShowAll(false);
        }}
        accessibilityRole="button"
        accessibilityLabel={
          notConfigured ? "Generate: draft a prompt, the run is off without an adapter" : "Generate"
        }
        accessibilityState={{ disabled: running }}
      >
        <Text style={styles.ghostText}>Generate</Text>
      </Pressable>
      {notConfigured ? (
        <Text style={styles.adapterNote} numberOfLines={3}>
          Drafts are free. The run needs an adapter.
        </Text>
      ) : null}

      {cardOpen ? (
        <View style={styles.popWrap} pointerEvents="box-none">
          <Panel padding={14} style={styles.pop}>
            <Text style={styles.kicker}>HARNESS</Text>

            {running && status ? (
              <>
                <Text style={styles.stateText}>Harness is working…</Text>
                <ActivityPanel state={activity.state} runId={status.runId} style={styles.activity} />
                <Pressable
                  style={styles.stop}
                  onPress={() => void stop()}
                  accessibilityRole="button"
                  accessibilityLabel="Stop Harness"
                >
                  <Text style={styles.stopText}>Stop</Text>
                </Pressable>
              </>
            ) : (
              <>
                {result ? (
                  <View style={styles.card}>
                    <View style={styles.labelRow}>
                      <Text style={styles.label}>THE PROMPT</Text>
                      <CopyButton text={result.draft.prompt} />
                    </View>
                    <View style={styles.promptBox}>
                      <Text style={styles.promptText}>{shownPrompt}</Text>
                    </View>
                    {promptLines.length > PROMPT_PREVIEW_LINES ? (
                      <Pressable
                        style={styles.linkRow}
                        onPress={() => setShowAll((value) => !value)}
                        accessibilityRole="button"
                        accessibilityLabel={showAll ? "Show fewer lines" : "Show all lines"}
                      >
                        <Text style={styles.link}>{showAll ? "Show less" : "Show all"}</Text>
                      </Pressable>
                    ) : null}
                    <Text style={styles.estimate}>{formatEstimate(result.draft.estimate)}</Text>
                    <View style={styles.moneyRow}>
                      <Text style={styles.money}>
                        {todayLine(result.spentTodayUsd, result.capUsd)}
                      </Text>
                      {onOpenSettings ? (
                        <Pressable
                          onPress={onOpenSettings}
                          hitSlop={6}
                          accessibilityRole="link"
                          accessibilityLabel="Change the daily limit in Settings"
                        >
                          <Text style={styles.link}>Change limit</Text>
                        </Pressable>
                      ) : null}
                    </View>
                    {reason ? <Text style={styles.reason}>{reason}</Text> : null}
                    <View style={styles.answerRow}>
                      <Pressable
                        style={[styles.yes, !canRun && styles.off]}
                        disabled={!canRun || busy}
                        onPress={() => void answer("yes")}
                        accessibilityRole="button"
                        accessibilityLabel="Yes, run Harness"
                      >
                        <Text style={styles.yesText}>Да</Text>
                      </Pressable>
                      <Pressable
                        style={styles.no}
                        disabled={busy}
                        onPress={() => void answer("no")}
                        accessibilityRole="button"
                        accessibilityLabel="No, cancel"
                      >
                        <Text style={styles.noText}>Нет</Text>
                      </Pressable>
                    </View>
                    <Pressable
                      style={styles.linkRow}
                      onPress={() => {
                        reset();
                        setShowAll(false);
                      }}
                      accessibilityRole="button"
                      accessibilityLabel="Draft again"
                    >
                      <Text style={styles.link}>Draft again</Text>
                    </Pressable>
                  </View>
                ) : (
                  <View style={styles.card}>
                    <Text style={styles.label}>What should Harness build?</Text>
                    <TextInput
                      value={goal}
                      onChangeText={setGoal}
                      placeholder="A small feature, the files, and how to check it"
                      placeholderTextColor={theme.faint}
                      style={styles.input}
                      multiline
                      maxLength={GOAL_MAX}
                      accessibilityLabel="What should Harness build?"
                    />
                    <Text style={styles.hint}>
                      {goal.length} / {GOAL_MAX}
                    </Text>
                    <Pressable
                      style={[styles.draftBtn, (!goal.trim() || busy) && styles.off]}
                      disabled={!goal.trim() || busy}
                      onPress={() => void draft(goal.trim())}
                      accessibilityRole="button"
                      accessibilityLabel="Draft prompt"
                    >
                      <Text style={styles.draftText}>{busy ? "Drafting…" : "Draft prompt"}</Text>
                    </Pressable>
                  </View>
                )}
                {error ? <Text style={styles.reason}>{error}</Text> : null}
              </>
            )}
          </Panel>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", justifyContent: "center" },
  ghost: {
    height: 36,
    minHeight: 36,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.lineStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  ghostText: { color: theme.text, fontSize: 12, fontWeight: "600" },
  off: { opacity: 0.45 },
  adapterNote: { color: theme.dim, fontSize: 10, maxWidth: 110, textAlign: "center", marginTop: 2 },
  popWrap: { position: "absolute", bottom: "100%", right: 0, width: 380, zIndex: 30 },
  pop: { maxHeight: 520 },
  kicker: { color: theme.dim, fontSize: 11, fontWeight: "700", letterSpacing: 1.2, marginBottom: 6 },
  card: { gap: 4 },
  stateText: { color: theme.text, fontSize: theme.type.body, fontWeight: "600", marginBottom: 4 },
  activity: { marginTop: 4 },
  label: { color: theme.dim, fontSize: theme.type.caption, marginBottom: 4 },
  labelRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.space.sm,
    marginBottom: 4,
  },
  input: {
    minHeight: 64,
    maxHeight: 96,
    borderWidth: 1,
    borderColor: theme.accentLine,
    borderRadius: theme.radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: theme.text,
    backgroundColor: theme.cardSoft,
    fontSize: theme.type.body,
    textAlignVertical: "top",
  },
  hint: { color: theme.dim, fontSize: 10, marginTop: 2 },
  draftBtn: {
    minHeight: 44,
    marginTop: 8,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  draftText: { color: theme.onAccent, fontSize: theme.type.body, fontWeight: "700" },
  promptBox: {
    borderWidth: 1,
    borderColor: theme.accentLine,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.cardSoft,
    padding: 8,
  },
  promptText: { color: theme.dim, fontSize: 11, lineHeight: 15 },
  linkRow: { minHeight: 32, justifyContent: "center", alignSelf: "flex-start" },
  link: { color: theme.accentText, fontSize: theme.type.caption, textDecorationLine: "underline" },
  estimate: { color: theme.text, fontSize: theme.type.body, fontWeight: "600", marginTop: 6 },
  moneyRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.space.sm,
    marginTop: 2,
  },
  money: { color: theme.dim, fontSize: theme.type.caption },
  reason: { color: theme.dim, fontSize: theme.type.caption, marginTop: 4 },
  answerRow: { flexDirection: "row", gap: theme.space.sm, marginTop: 10 },
  yes: {
    minHeight: 44,
    flex: 1,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  yesText: { color: theme.onAccent, fontSize: theme.type.body, fontWeight: "700" },
  no: {
    minHeight: 44,
    flex: 1,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    borderColor: theme.lineStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  noText: { color: theme.text, fontSize: theme.type.body, fontWeight: "600" },
  stop: {
    minHeight: 44,
    marginTop: 10,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    borderColor: theme.lineStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  stopText: { color: theme.text, fontSize: theme.type.body, fontWeight: "600" },
});
