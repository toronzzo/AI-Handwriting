/**
 * Settings > Power: the five service dots, one button to restart the brain,
 * one to restart the model, and the honest "turn off everything" hand-off.
 *
 * The app cannot turn itself back on: that is the Desktop launcher's job, and
 * the copy says so. Every call goes through brainFetch (paired token attached).
 */
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { theme } from "../theme";
import { brainFetch, isUnauthorized } from "../room/brain/token";
import { readProbe } from "../room/brain/probeJson";
import { PAIR_HINT, probeThrownError } from "./probe";
import {
  AUTOSTART_NOTE,
  CANNOT_TURN_ON_NOTE,
  POWER_SERVICE_LABELS,
  canRestartBrain,
  canTurnOff,
  normalizePowerStatus,
  powerDot,
  powerSummary,
  runningCount,
  serviceLine,
  type PowerStatus,
} from "./power";

type Props = {
  brainUrl: string;
  onTurnOff: () => void;
  /** Bump this when the Settings "Refresh" button is pressed. */
  refreshSignal?: number;
};

const REQUEST_TIMEOUT_MS = 6000;

function timeoutSignal(ms: number): { signal: AbortSignal; done: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, done: () => clearTimeout(timer) };
}

export function PowerPanel({ brainUrl, onTurnOff, refreshSignal = 0 }: Props) {
  const [status, setStatus] = useState<PowerStatus | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    if (!brainUrl) {
      setError("Connect to the Mac first.");
      setLoading(false);
      return;
    }
    setLoading(true);
    const timer = timeoutSignal(REQUEST_TIMEOUT_MS);
    try {
      const res = await brainFetch(brainUrl.replace(/\/$/, "") + "/v1/power/status", { signal: timer.signal });
      const read = await readProbe<unknown>("Power", res);
      if (!read.ok) {
        setError(read.error);
        return;
      }
      const next = normalizePowerStatus(read.body);
      setStatus(next);
      setError(next.error || "");
    } catch (caught) {
      setError(probeThrownError("Power", caught));
    } finally {
      timer.done();
      setLoading(false);
    }
  }, [brainUrl]);

  useEffect(() => {
    void load();
  }, [load, refreshSignal]);

  async function restartBrain() {
    await restart("brain");
  }

  async function restartModel() {
    await restart("model");
  }

  async function restart(service: "brain" | "model") {
    if (!brainUrl || busy) return;
    setBusy(service);
    setNote(service === "brain" ? "Restarting the brain…" : "Restarting the model…");
    const timer = timeoutSignal(REQUEST_TIMEOUT_MS);
    try {
      const path = service === "model" ? "/v1/model/restart" : "/v1/power/restart";
      const body = service === "model" ? {} : { service };
      const res = await brainFetch(brainUrl.replace(/\/$/, "") + path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: timer.signal,
      });
      if (isUnauthorized(res.status)) {
        setNote(PAIR_HINT);
        return;
      }
      if (!res.ok) {
        setNote(service === "brain" ? "The brain is already restarting." : "The model is already switching.");
        return;
      }
      setNote(service === "brain" ? "Brain restarting. This can take a minute." : "Model restarting. This can take a minute.");
      setTimeout(() => void load(), service === "brain" ? 5000 : 4000);
    } catch (caught) {
      setNote(probeThrownError("Power", caught));
    } finally {
      timer.done();
      setBusy("");
    }
  }

  async function toggleAutostart(on: boolean) {
    if (!brainUrl) return;
    setBusy("autostart");
    const timer = timeoutSignal(REQUEST_TIMEOUT_MS);
    try {
      const res = await brainFetch(brainUrl.replace(/\/$/, "") + "/v1/power/autostart", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ on }),
        signal: timer.signal,
      });
      const read = await readProbe<{ installed?: boolean; supported?: boolean; path?: string }>("Login setting", res);
      if (!read.ok) {
        setNote(read.error);
        return;
      }
      const body = read.body;
      setStatus((current) =>
        current
          ? { ...current, autostart: { installed: body.installed === true, supported: body.supported === true, path: body.path } }
          : current,
      );
      setNote(body.installed ? "I will start when you log in." : "I will not start on login.");
    } catch (caught) {
      setNote(probeThrownError("Power", caught));
    } finally {
      timer.done();
      setBusy("");
    }
  }

  const services = status?.services ?? [];
  const autostart = status?.autostart ?? { installed: false, supported: false };
  const showOff = canTurnOff(status);

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Text style={styles.kicker}>POWER</Text>
        <Pressable onPress={() => void load()} accessibilityRole="button" accessibilityLabel="Refresh power status" hitSlop={8}>
          <Text style={styles.refresh}>{loading ? "Checking…" : "Refresh"}</Text>
        </Pressable>
      </View>
      <Text style={styles.summary}>{powerSummary(status)}</Text>

      {loading && !status ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator size="small" color={theme.accent} />
          <Text style={styles.dim}>Asking the Mac…</Text>
        </View>
      ) : null}

      {error ? <Text style={styles.warn}>{error}</Text> : null}

      {services.map((service) => {
        const dot = powerDot(service);
        return (
          <View key={service.name} style={styles.row}>
            <View style={[styles.dot, dot === "on" ? styles.dotOn : dot === "warn" ? styles.dotWarn : styles.dotOff]} />
            <Text style={styles.label}>{POWER_SERVICE_LABELS[service.name] || service.label}</Text>
            <Text style={styles.detail}>{serviceLine(service)}</Text>
          </View>
        );
      })}

      {services.length === 0 && !loading ? <Text style={styles.dim}>{error || "No services were reported."}</Text> : null}

      <View style={styles.buttons}>
        <Pressable
          style={[styles.button, (busy || !canRestartBrain(status)) && styles.buttonDim]}
          disabled={Boolean(busy) || !canRestartBrain(status)}
          onPress={() => void restartBrain()}
          accessibilityRole="button"
          accessibilityLabel="Restart brain"
        >
          <Text style={styles.buttonText}>{busy === "brain" ? "Restarting…" : "Restart brain"}</Text>
        </Pressable>
        <Pressable
          style={[styles.button, busy && styles.buttonDim]}
          disabled={Boolean(busy)}
          onPress={() => void restartModel()}
          accessibilityRole="button"
          accessibilityLabel="Restart model"
        >
          <Text style={styles.buttonText}>{busy === "model" ? "Restarting…" : "Restart model"}</Text>
        </Pressable>
      </View>

      <Pressable
        style={[styles.offButton, !showOff && styles.buttonDim]}
        disabled={!showOff}
        onPress={onTurnOff}
        accessibilityRole="button"
        accessibilityLabel="Turn off everything"
      >
        <Text style={styles.offText}>Turn off everything</Text>
      </Pressable>
      <Text style={styles.dim}>{runningCount(status) > 0 ? CANNOT_TURN_ON_NOTE : "Everything is off. Double-click Preyas ON on the Desktop."}</Text>

      <View style={styles.switchRow}>
        <View style={styles.switchCopy}>
          <Text style={styles.switchLabel}>Start when I log in</Text>
          <Text style={styles.dim}>{AUTOSTART_NOTE}</Text>
        </View>
        <Switch
          value={autostart.installed}
          onValueChange={(on) => void toggleAutostart(on)}
          disabled={!autostart.supported || busy === "autostart"}
          accessibilityLabel="Start Preyas when I log in"
        />
      </View>
      {!autostart.supported ? <Text style={styles.dim}>Login start is available on the Mac only.</Text> : null}

      {note ? <Text style={styles.note}>{note}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.card,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.accentLine,
    padding: theme.space.md,
    gap: theme.space.sm,
  },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  kicker: { color: theme.accent, fontSize: theme.type.label, letterSpacing: 1.2, fontWeight: "700" },
  refresh: { color: theme.accent, fontSize: theme.type.caption },
  summary: { color: theme.text, fontSize: theme.type.body, fontWeight: "600" },
  loadingRow: { flexDirection: "row", alignItems: "center", gap: theme.space.sm },
  row: { flexDirection: "row", alignItems: "center", gap: theme.space.sm, minHeight: 22 },
  dot: { width: theme.space.sm, height: theme.space.sm, borderRadius: theme.space.xs },
  dotOn: { backgroundColor: theme.good },
  dotWarn: { backgroundColor: theme.accent },
  dotOff: { backgroundColor: theme.off },
  label: { color: theme.text, fontSize: theme.type.body, width: 108 },
  detail: { color: theme.dim, fontSize: theme.type.caption, flex: 1 },
  dim: { color: theme.dim, fontSize: theme.type.caption, lineHeight: 18 },
  warn: { color: theme.danger, fontSize: theme.type.caption },
  note: { color: theme.text, fontSize: theme.type.caption },
  buttons: { flexDirection: "row", flexWrap: "wrap", gap: theme.space.sm, marginTop: theme.space.xs },
  button: {
    borderWidth: 1,
    borderColor: theme.accent,
    borderRadius: theme.radius.sm,
    paddingVertical: theme.space.sm,
    paddingHorizontal: theme.space.md,
  },
  buttonDim: { opacity: 0.45 },
  buttonText: { color: theme.accent, fontSize: theme.type.caption, fontWeight: "600" },
  offButton: {
    borderWidth: 1,
    borderColor: theme.danger,
    borderRadius: theme.radius.sm,
    paddingVertical: theme.space.sm,
    alignItems: "center",
    marginTop: theme.space.xs,
  },
  offText: { color: theme.danger, fontSize: theme.type.caption, fontWeight: "600" },
  switchRow: { flexDirection: "row", alignItems: "center", gap: theme.space.md, marginTop: theme.space.xs },
  switchCopy: { flex: 1, gap: 2 },
  switchLabel: { color: theme.text, fontSize: theme.type.body },
});
