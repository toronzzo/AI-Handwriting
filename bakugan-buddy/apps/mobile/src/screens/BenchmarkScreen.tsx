import { useCallback, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { BodyWebViewAPI, type BodyMetrics } from "../body/BodyWebView";

const LOG_KEY = "bakugan-buddy/metrics-v1";

const MOODS = ["happy", "excited", "angry", "sad", "listening", "neutral", "thinking", "battle"] as const;

type Props = {
  latest: BodyMetrics | null;
};

export function BenchmarkScreen({ latest }: Props) {
  const [log, setLog] = useState<string>("");
  const [running, setRunning] = useState(false);

  const append = useCallback(async (row: Record<string, unknown>) => {
    const line = JSON.stringify({ ...row, at: new Date().toISOString() });
    const prev = (await AsyncStorage.getItem(LOG_KEY)) || "";
    const next = prev + line + "\n";
    await AsyncStorage.setItem(LOG_KEY, next);
    setLog(next.trim().split("\n").slice(-12).join("\n"));
  }, []);

  const runSuite = useCallback(async () => {
    setRunning(true);
    const samples: number[] = [];
    for (const mood of MOODS) {
      const t0 = performance.now();
      BodyWebViewAPI.setEmotion(mood);
      const dt = performance.now() - t0;
      samples.push(dt);
      await wait(450);
    }
    BodyWebViewAPI.react("[excited] Benchmark pop!");
    await wait(800);
    BodyWebViewAPI.setTalking(0.7);
    await wait(600);
    BodyWebViewAPI.setTalking(false);

    await append({
      kind: "m1_body_suite",
      setEmotionMs: samples,
      setEmotionAvgMs: samples.reduce((a, b) => a + b, 0) / samples.length,
      fps: latest?.fps ?? null,
      droppedApprox: latest?.droppedApprox ?? null,
      target: { fps: 60, setEmotionMs: 1, bodyReactionMs: 300 },
    });
    setRunning(false);
  }, [append, latest]);

  const loadLog = useCallback(async () => {
    setLog((await AsyncStorage.getItem(LOG_KEY)) || "(empty)");
  }, []);

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={styles.pad}>
      <Text style={styles.h}>Benchmark · M1 body</Text>
      <Text style={styles.p}>
        Targets: 60 fps · setEmotion ≪ 1 ms (body path) · body reaction &lt; 300 ms after
        speech end (measured in M2 with VAD).
      </Text>
      <Text style={styles.mono}>
        live fps {latest?.fps?.toFixed(1) ?? "—"} · emotion {latest?.emotion ?? "—"} ·
        react {latest?.reactionMs != null ? `${latest.reactionMs.toFixed(2)}ms` : "—"}
      </Text>
      <Pressable
        style={[styles.btn, running && styles.btnOff]}
        disabled={running}
        onPress={runSuite}
      >
        <Text style={styles.btnT}>{running ? "Running…" : "Run body suite"}</Text>
      </Pressable>
      <Pressable style={styles.btnGhost} onPress={loadLog}>
        <Text style={styles.btnGhostT}>Reload log</Text>
      </Pressable>
      <Text style={styles.log}>{log || "Log empty — run suite."}</Text>
    </ScrollView>
  );
}

function wait(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: "#050505" },
  pad: { padding: 16, paddingBottom: 40 },
  h: { color: "#f2f2f2", fontSize: 20, fontWeight: "800", marginBottom: 8 },
  p: { color: "#b0b0b0", marginBottom: 12, lineHeight: 20 },
  mono: {
    color: "#e8e8e8",
    fontFamily: "monospace",
    marginBottom: 16,
    fontSize: 12,
  },
  btn: {
    backgroundColor: "#c8c8c8",
    padding: 14,
    alignItems: "center",
    marginBottom: 8,
  },
  btnOff: { opacity: 0.5 },
  btnGhost: {
    borderWidth: 1,
    borderColor: "rgba(200,200,200,0.35)",
    padding: 12,
    alignItems: "center",
    marginBottom: 16,
  },
  btnT: { color: "#0a0a0a", fontWeight: "700" },
  btnGhostT: { color: "#e8e8e8", fontWeight: "700" },
  log: {
    color: "#c8c8c8",
    fontFamily: "monospace",
    fontSize: 11,
    lineHeight: 16,
  },
});
