import { useEffect, useState } from "react";
import { Image, Pressable, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { formatUsd } from "../../../../packages/alive/src/confirm.ts";
import { theme } from "../theme";
import { currentBrainUrl } from "../room/brain/brainLink";
import { brainFetch } from "../room/brain/token";
import { plainWords, useComputer, type ComputerState } from "./useComputer";

const isWeb = typeof document !== "undefined";

/** The screenshot as a blob URL on web (the fetch carries the pairing token). */
function useShotBlob(shotUrl: string | null) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!shotUrl || !isWeb) {
      setBlobUrl(null);
      return;
    }
    let url: string | null = null;
    let alive = true;
    (async () => {
      try {
        const res = await brainFetch(`${currentBrainUrl()}${shotUrl}`);
        const blob = await res.blob();
        if (alive) {
          url = URL.createObjectURL(blob);
          setBlobUrl(url);
        }
      } catch {
        /* no screenshot: the card still shows the action in words */
      }
    })();
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [shotUrl]);
  return blobUrl;
}

function hasSession(state: ComputerState | null): boolean {
  return Boolean(state?.sessionId && state.phase !== "stopped" && state.phase !== "ended");
}

/**
 * The computer-use section of the coach popover (the only mount point this
 * slice is allowed, because ChatScreen is a UI FILE). Ask-first: Preyas
 * proposes ONE action, the user presses Да or Нет, and Stop is always
 * visible while a session runs. Theme tokens only; the Stop button is an
 * outlined ghost button, never red.
 */
export function ComputerPanel() {
  const computer = useComputer();
  const state = computer.state;
  const [goal, setGoal] = useState("");
  const [confirmOn, setConfirmOn] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const proposal = state?.proposal ?? null;
  const blobUrl = useShotBlob(proposal?.shotUrl ?? null);

  const showStepResult = async (result: Record<string, unknown> | null) => {
    if (!result) return;
    const error = String(result.error || "");
    if (error === "denied" || error === "blocked") {
      setNotice(`Preyas is not allowed to do that: ${String(result.why || error)}.`);
      return;
    }
    if (error === "cap_reached") {
      setNotice("This session reached its action limit. Start a new goal to continue.");
      return;
    }
    if (error) {
      setNotice(error);
      return;
    }
    const stepProposal = result.proposal as { action: string; why?: string } | undefined;
    if (stepProposal && !result.proposalId) {
      setNotice(plainWords(stepProposal));
    }
  };

  const onNext = async () => {
    setNotice(null);
    if (!hasSession(state)) {
      const started = await computer.start(goal.trim());
      if (!started || started.ok !== true) {
        setNotice(String(started?.error || "could not start"));
        return;
      }
    }
    await showStepResult(await computer.step());
  };

  const onDecide = (yes: boolean) => {
    if (!proposal) return;
    setNotice(null);
    void computer.decide(proposal.proposalId, yes);
  };

  const onEscalateYes = async () => {
    const result = await computer.confirmEscalate(true);
    const error = result ? String(result.error || "") : "";
    if (error) setNotice(error);
    await showStepResult(result);
  };

  return (
    <View style={styles.section}>
      <Text style={styles.title}>COMPUTER</Text>
      <Text style={styles.body}>
        Preyas proposes one click or key press at a time. You approve EVERY action with Да or Нет.
      </Text>
      <View style={styles.row}>
        <Text style={styles.switchLabel}>Let Preyas propose clicks and keys</Text>
        <Switch
          value={Boolean(state?.enabled)}
          onValueChange={(on) => {
            setNotice(null);
            if (on) setConfirmOn(true);
            else void computer.enable(false);
          }}
          accessibilityLabel="Let Preyas propose clicks and keys"
        />
      </View>

      {confirmOn ? (
        <View style={styles.card}>
          <Text style={styles.body}>He will ask you before EVERY action. You can press Stop at any moment.</Text>
          <View style={styles.row}>
            <Pressable
              style={styles.yesButton}
              accessibilityLabel="Yes, let Preyas propose clicks and keys"
              onPress={() => {
                setConfirmOn(false);
                void computer.enable(true).then((data) => {
                  if (data && data.error) setNotice(String(data.error));
                });
              }}
            >
              <Text style={styles.yesText}>Да</Text>
            </Pressable>
            <Pressable style={styles.ghostButton} accessibilityLabel="No" onPress={() => setConfirmOn(false)}>
              <Text style={styles.ghostText}>Нет</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {state?.enabled ? (
        <>
          <TextInput
            style={styles.input}
            value={goal}
            onChangeText={setGoal}
            placeholder="Goal, e.g. type hello in TextEdit"
            placeholderTextColor={theme.faint}
            accessibilityLabel="Computer goal"
          />
          <Pressable
            style={styles.button}
            onPress={() => void onNext()}
            accessibilityLabel="Next step"
            disabled={computer.busy}
          >
            <Text style={styles.buttonText}>Next step</Text>
          </Pressable>
        </>
      ) : null}

      {proposal ? (
        <View style={styles.card}>
          {isWeb && blobUrl ? (
            <Image source={{ uri: blobUrl }} style={styles.shot} accessibilityLabel="Screenshot of the screen" />
          ) : (
            <Text style={styles.body}>The screenshot is on the Mac.</Text>
          )}
          <Text style={styles.body}>{plainWords(proposal)}</Text>
          {proposal.why ? <Text style={styles.dim}>{proposal.why}</Text> : null}
          {proposal.warn ? <Text style={styles.dim}>{proposal.warn}</Text> : null}
          <Text style={styles.dim}>
            step {proposal.step} of {proposal.maxActions} · today&apos;s spend {formatUsd(state?.spentTodayUsd ?? 0)}
          </Text>
          <View style={styles.row}>
            <Pressable style={styles.yesButton} accessibilityLabel="Yes, run this action" onPress={() => onDecide(true)}>
              <Text style={styles.yesText}>Да</Text>
            </Pressable>
            <Pressable style={styles.ghostButton} accessibilityLabel="No, skip this action" onPress={() => onDecide(false)}>
              <Text style={styles.ghostText}>Нет</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {notice ? <Text style={styles.body}>{notice}</Text> : null}
      {computer.error ? <Text style={styles.dim}>{computer.error}</Text> : null}

      {hasSession(state) ? (
        <Pressable style={styles.stopButton} accessibilityLabel="Stop" onPress={() => void computer.stop()}>
          <Text style={styles.stopText}>Stop</Text>
        </Pressable>
      ) : null}

      {hasSession(state) ? (
        computer.escalation ? (
          <View style={styles.card}>
            <Text style={styles.body}>
              Ask DeepSeek for help? About {formatUsd(computer.escalation.estimateUsd)}. This exact text would leave
              the machine:
            </Text>
            <Text style={styles.preview}>{computer.escalation.preview}</Text>
            <Text style={styles.dim}>
              {computer.escalation.allowed
                ? `today's spend ${formatUsd(computer.escalation.spentTodayUsd)} of ${formatUsd(computer.escalation.capUsd)}`
                : `not allowed: ${computer.escalation.reason}`}
            </Text>
            {computer.escalation.allowed ? (
              <View style={styles.row}>
                <Pressable
                  style={styles.yesButton}
                  accessibilityLabel="Yes, ask DeepSeek"
                  onPress={() => void onEscalateYes()}
                >
                  <Text style={styles.yesText}>Да</Text>
                </Pressable>
                <Pressable
                  style={styles.ghostButton}
                  accessibilityLabel="No, do not ask DeepSeek"
                  onPress={() => void computer.confirmEscalate(false)}
                >
                  <Text style={styles.ghostText}>Нет</Text>
                </Pressable>
              </View>
            ) : (
              <Pressable style={styles.ghostButton} accessibilityLabel="Close" onPress={computer.closeEscalate}>
                <Text style={styles.ghostText}>Close</Text>
              </Pressable>
            )}
          </View>
        ) : (
          <Pressable
            style={styles.ghostButton}
            accessibilityLabel="Ask DeepSeek for help"
            onPress={() => void computer.askEscalate()}
          >
            <Text style={styles.ghostText}>Ask DeepSeek for help</Text>
          </Pressable>
        )
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    borderTopWidth: 1,
    borderTopColor: theme.accentLine,
    marginTop: theme.space.md,
    paddingTop: theme.space.md,
  },
  title: {
    color: theme.text,
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginBottom: 8,
  },
  body: {
    color: theme.text,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 8,
  },
  dim: {
    color: theme.dim,
    fontSize: 12,
    lineHeight: 17,
    marginBottom: 4,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    marginBottom: 4,
  },
  switchLabel: {
    color: theme.text,
    fontSize: 14,
    flex: 1,
  },
  input: {
    minHeight: 36,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.accentLine,
    backgroundColor: theme.cardSoft,
    color: theme.text,
    paddingHorizontal: 12,
    marginTop: 6,
  },
  card: {
    backgroundColor: theme.cardSoft,
    borderColor: theme.accentLine,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginTop: 8,
  },
  shot: {
    width: "100%",
    aspectRatio: 16 / 10,
    borderRadius: 8,
    marginBottom: 8,
  },
  preview: {
    color: theme.text,
    fontSize: 12,
    lineHeight: 17,
    backgroundColor: theme.bg,
    borderColor: theme.accentLine,
    borderWidth: 1,
    borderRadius: 8,
    padding: 8,
    marginBottom: 6,
  },
  button: {
    minHeight: 44,
    borderRadius: 10,
    backgroundColor: theme.accent,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    marginTop: 6,
  },
  buttonText: {
    color: theme.onAccent,
    fontSize: 13,
    fontWeight: "700",
  },
  yesButton: {
    minHeight: 44,
    minWidth: 88,
    borderRadius: 10,
    backgroundColor: theme.accent,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    marginTop: 6,
  },
  yesText: {
    color: theme.onAccent,
    fontSize: 13,
    fontWeight: "700",
  },
  ghostButton: {
    minHeight: 44,
    minWidth: 88,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.accentLine,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    marginTop: 6,
  },
  ghostText: {
    color: theme.text,
    fontSize: 13,
  },
  stopButton: {
    minHeight: 48,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: theme.accentLine,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    marginTop: 10,
  },
  stopText: {
    color: theme.text,
    fontSize: 15,
    fontWeight: "700",
  },
});
