import { useState } from "react";
import {
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { BodyWebView, BodyWebViewAPI, type BodyMetrics } from "./src/body/BodyWebView";
import { BenchmarkScreen } from "./src/screens/BenchmarkScreen";

type Tab = "body" | "bench";

export default function App() {
  const [tab, setTab] = useState<Tab>("body");
  const [metrics, setMetrics] = useState<BodyMetrics | null>(null);

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="light" />
      <View style={styles.top}>
        <Text style={styles.brand}>BAKUGAN BUDDY</Text>
        <Text style={styles.sub}>M1 · body @ 60fps · Aquos joker pack</Text>
        <View style={styles.tabs}>
          <Pressable
            style={[styles.tab, tab === "body" && styles.tabOn]}
            onPress={() => setTab("body")}
          >
            <Text style={styles.tabT}>Body</Text>
          </Pressable>
          <Pressable
            style={[styles.tab, tab === "bench" && styles.tabOn]}
            onPress={() => setTab("bench")}
          >
            <Text style={styles.tabT}>Benchmark</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.stage}>
        {/* Keep WebView mounted so benchmarks can drive the body */}
        <View style={[styles.fill, tab !== "body" && styles.hidden]}>
          <BodyWebView onMetrics={setMetrics} />
        </View>
        {tab === "bench" && <BenchmarkScreen latest={metrics} />}
      </View>

      {tab === "body" && (
        <View style={styles.quick}>
          {(
            [
              ["happy", "happy"],
              ["excited", "excited"],
              ["fierce", "angry"],
              ["sad", "sad"],
            ] as const
          ).map(([mood, label]) => (
            <Pressable
              key={mood}
              style={styles.qbtn}
              onPress={() => BodyWebViewAPI.setEmotion(mood)}
            >
              <Text style={styles.qbtnT}>{label}</Text>
            </Pressable>
          ))}
          <Pressable
            style={styles.qbtn}
            onPress={() => BodyWebViewAPI.react("[excited] Whoop — claws out!")}
          >
            <Text style={styles.qbtnT}>react[]</Text>
          </Pressable>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#030b14" },
  top: { paddingHorizontal: 14, paddingTop: 8, paddingBottom: 6 },
  brand: {
    color: "#5dfff0",
    fontSize: 18,
    fontWeight: "800",
    letterSpacing: 2,
  },
  sub: { color: "#7a9aab", fontSize: 12, marginTop: 2 },
  tabs: { flexDirection: "row", gap: 8, marginTop: 10 },
  tab: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: "rgba(93,255,240,0.25)",
  },
  tabOn: { backgroundColor: "rgba(26,79,214,0.45)", borderColor: "#5dfff0" },
  tabT: { color: "#d8f3ff", fontWeight: "700", fontSize: 13 },
  stage: { flex: 1 },
  fill: { flex: 1 },
  hidden: { height: 0, overflow: "hidden", flex: 0 },
  quick: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    justifyContent: "center",
    padding: 10,
    borderTopWidth: 1,
    borderTopColor: "rgba(93,255,240,0.2)",
  },
  qbtn: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    backgroundColor: "rgba(26,79,214,0.35)",
    borderWidth: 1,
    borderColor: "rgba(93,255,240,0.3)",
  },
  qbtnT: { color: "#d8f3ff", fontSize: 12, fontWeight: "600" },
});
