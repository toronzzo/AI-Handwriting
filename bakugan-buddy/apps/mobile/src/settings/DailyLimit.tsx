/**
 * Settings > Daily limit. One paper row with the numbers, a thin bar, three
 * quick amounts that only fill the box, a custom amount and a Save button.
 * Nothing is saved until Save is tapped; the brain stores the value in
 * `<data root>/settings/spend.json` and uses it at once.
 *
 * Tokens only, no red anywhere: an invalid amount or a refusal is dim text.
 */
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { currentBrainUrl } from "../room/brain/brainLink";
import { brainFetch } from "../room/brain/token";
import { SETTINGS_PROBE_MS } from "../layout";
import { Panel } from "../ui/Panel";
import { theme } from "../theme";
import {
  CAP_DEFAULT_USD,
  CAP_MAX_USD,
  CAP_MIN_USD,
  dailyLimitRequestError,
  formatUsd,
  parseUsd,
  spendRatio,
  todayLine,
  validateUsd,
} from "./dailyLimit";

type SpendNumbers = { capUsd: number; spentTodayUsd: number };

const QUICK_AMOUNTS = [0.5, 1, 2];

export function DailyLimit() {
  const base = currentBrainUrl();
  const [numbers, setNumbers] = useState<SpendNumbers | null>(null);
  const [text, setText] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await brainFetch(`${base}/v1/settings/spend`, {
          signal: AbortSignal.timeout(SETTINGS_PROBE_MS),
        });
        if (!response.ok) throw new Error("no numbers");
        const body = (await response.json()) as Partial<SpendNumbers>;
        if (cancelled) return;
        const next = {
          capUsd: Number(body.capUsd) || CAP_DEFAULT_USD,
          spentTodayUsd: Number(body.spentTodayUsd) || 0,
        };
        setNumbers(next);
        setText(next.capUsd.toFixed(2));
        setError("");
      } catch (error) {
        if (!cancelled) setError(dailyLimitRequestError(error));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [base]);

  const parsed = parseUsd(text);
  const check = parsed === null ? { ok: false as const, error: "Use numbers only, like 1.00." } : validateUsd(parsed);
  const savedCap = numbers?.capUsd ?? CAP_DEFAULT_USD;
  const changed = check.ok && Math.abs(check.value - savedCap) > 0.0001;
  const belowToday = check.ok && numbers !== null && check.value < numbers.spentTodayUsd;
  const canSave = check.ok && changed && !saving;

  const save = async () => {
    if (!check.ok || !changed || saving) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await brainFetch(`${base}/v1/settings/spend`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dailyCapUsd: check.value, confirm: "save" }),
        signal: AbortSignal.timeout(SETTINGS_PROBE_MS),
      });
      const body = (await response.json().catch(() => ({}))) as Partial<SpendNumbers> & { error?: string };
      if (!response.ok) {
        setError(String(body.error ?? "Could not save the limit."));
        return;
      }
      const capUsd = Number(body.capUsd) || check.value;
      setNumbers({ capUsd, spentTodayUsd: Number(body.spentTodayUsd) || 0 });
      setText(capUsd.toFixed(2));
      setMessage(`Saved. Limit is now ${formatUsd(capUsd)}.`);
    } catch (error) {
      setError(dailyLimitRequestError(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Panel padding={16}>
      <Text style={styles.heading} accessibilityRole="header">
        DAILY LIMIT
      </Text>
      <Text style={styles.numbers}>
        {numbers ? todayLine(numbers.spentTodayUsd, numbers.capUsd) : "Checking…"}
      </Text>
      <View style={styles.track}>
        <View
          style={[
            styles.fill,
            { width: `${Math.round(spendRatio(numbers?.spentTodayUsd ?? 0, numbers?.capUsd ?? CAP_DEFAULT_USD) * 100)}%` },
          ]}
        />
      </View>
      <View style={styles.quickRow}>
        {QUICK_AMOUNTS.map((amount) => (
          <Pressable
            key={amount}
            style={styles.quick}
            onPress={() => {
              setText(amount.toFixed(2));
              setMessage("");
              setError("");
            }}
            accessibilityRole="button"
            accessibilityLabel={`Fill in ${formatUsd(amount)}`}
          >
            <Text style={styles.quickText}>{formatUsd(amount)}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.label}>Daily limit in USD</Text>
      <TextInput
        value={text}
        onChangeText={(value) => {
          setText(value);
          setMessage("");
          setError("");
        }}
        keyboardType="decimal-pad"
        style={styles.input}
        placeholder="1.00"
        placeholderTextColor={theme.faint}
        accessibilityLabel="Daily limit in USD"
        maxLength={8}
      />
      <Text style={styles.hint}>
        From {formatUsd(CAP_MIN_USD)} to ${CAP_MAX_USD}
      </Text>
      {!check.ok ? <Text style={styles.dim}>{check.error}</Text> : null}
      {belowToday ? (
        <Text style={styles.dim}>
          Below today's spend, so Harness and paid runs stay blocked until tomorrow.
        </Text>
      ) : null}
      <Pressable
        style={[styles.save, canSave ? styles.saveOn : styles.saveOff]}
        disabled={!canSave}
        onPress={() => void save()}
        accessibilityRole="button"
        accessibilityState={{ disabled: !canSave }}
        accessibilityLabel="Save the daily limit"
      >
        <Text style={[styles.saveText, !canSave && styles.saveTextOff]}>Save</Text>
      </Pressable>
      <Text style={styles.dim} accessibilityLiveRegion="polite">
        {message}
      </Text>
      {error ? <Text style={styles.dim}>{error}</Text> : null}
    </Panel>
  );
}

const styles = StyleSheet.create({
  heading: {
    fontFamily: theme.font.display,
    color: theme.text,
    fontWeight: "700",
    fontSize: theme.type.display.timer,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 4,
  },
  numbers: { color: theme.text, fontSize: theme.type.body, fontWeight: "600" },
  track: { height: 8, borderRadius: 4, backgroundColor: theme.track, overflow: "hidden", marginTop: 10, marginBottom: 12 },
  fill: { height: "100%", borderRadius: 4, backgroundColor: theme.accent },
  quickRow: { flexDirection: "row", gap: theme.space.sm, marginBottom: 10 },
  quick: {
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    borderColor: theme.lineStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  quickText: { color: theme.text, fontSize: theme.type.body, fontWeight: "600" },
  label: { color: theme.dim, fontSize: theme.type.caption, marginBottom: 4 },
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: theme.accentLine,
    borderRadius: theme.radius.sm,
    paddingHorizontal: 12,
    color: theme.text,
    backgroundColor: theme.cardSoft,
    fontSize: theme.type.input,
  },
  hint: { color: theme.dim, fontSize: theme.type.caption, marginTop: 4 },
  dim: { color: theme.dim, fontSize: theme.type.caption, marginTop: 6 },
  save: {
    minHeight: 44,
    marginTop: 12,
    borderRadius: theme.radius.sm,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
  },
  /** Enabled only when the typed amount differs from the saved cap. */
  saveOn: { backgroundColor: theme.accent, opacity: 1 },
  saveOff: { backgroundColor: theme.cardSoft, borderWidth: 1, borderColor: theme.lineStrong, opacity: 1 },
  saveText: { color: theme.onAccent, fontSize: theme.type.body, fontWeight: "700" },
  saveTextOff: { color: theme.dim },
});
