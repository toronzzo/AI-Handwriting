import { useState } from "react";
import {
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { BodyWebView, BodyWebViewAPI, type BodyMetrics } from "./src/body/BodyWebView";
import { BenchmarkScreen } from "./src/screens/BenchmarkScreen";
import { RoomScreen } from "./src/room/RoomScreen";
import { ChatScreen } from "./src/screens/ChatScreen";
import { MAIN_TABS, SETTINGS_ENTRY, type Section } from "./src/nav";
import { theme } from "./src/theme";

/** Advanced/demo surfaces that live behind Settings, not the main tabs. */
type Advanced = "room" | "body" | "bench";

export default function App() {
  const [section, setSection] = useState<Section>("chat");
  const [advanced, setAdvanced] = useState<Advanced | null>(null);
  const [metrics, setMetrics] = useState<BodyMetrics | null>(null);
  const wide = useWindowDimensions().width >= 900;

  const openAdvanced = (tab: Advanced) => setAdvanced(tab);

  const nav = (
    <>
      <View style={wide ? styles.sideTabs : styles.barTabs}>
        {MAIN_TABS.map((tab) => {
          const on = section === tab.id && !advanced;
          return (
            <Pressable
              key={tab.id}
              style={wide ? [styles.sideTab, on && styles.sideTabOn] : styles.barTab}
              onPress={() => {
                setAdvanced(null);
                setSection(tab.id);
              }}
              accessibilityRole="button"
              accessibilityLabel={tab.label}
            >
              <Text style={[styles.tabIcon, !wide && on && styles.tabIconOn]}>{tab.icon}</Text>
              <Text style={wide ? [styles.sideLabel, on && styles.sideLabelOn] : [styles.barLabel, on && styles.barLabelOn]}>
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Pressable
        style={wide ? [styles.sideTab, section === "settings" && !advanced && styles.sideTabOn] : styles.barGear}
        onPress={() => {
          setAdvanced(null);
          setSection("settings");
        }}
        accessibilityRole="button"
        accessibilityLabel={SETTINGS_ENTRY.label}
      >
        <Text style={[styles.tabIcon, !wide && section === "settings" && !advanced && styles.tabIconOn]}>{SETTINGS_ENTRY.icon}</Text>
        {wide ? (
          <Text style={[styles.sideLabel, section === "settings" && !advanced && styles.sideLabelOn]}>{SETTINGS_ENTRY.label}</Text>
        ) : null}
      </Pressable>
    </>
  );

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="light" />
      <View style={styles.shell}>
        {wide ? (
          <View style={styles.sidebar}>
            <View style={styles.sideBrand}>
              <View style={styles.mark} />
              <Text style={styles.sideName}>PREYAS</Text>
            </View>
            {nav}
          </View>
        ) : null}

        <View style={styles.stage}>
          {advanced === "room" ? (
            <AdvancedWrap title="Preyas' room" onBack={() => setAdvanced(null)}>
              <RoomScreen />
            </AdvancedWrap>
          ) : advanced === "body" || advanced === "bench" ? (
            <AdvancedWrap title={advanced === "body" ? "Body" : "Benchmark"} onBack={() => setAdvanced(null)}>
              {/* Keep WebView mounted while benchmarking so it can drive the body */}
              <View style={[styles.fill, advanced !== "body" && styles.hidden]}>
                <BodyWebView onMetrics={setMetrics} />
              </View>
              {advanced === "bench" ? <BenchmarkScreen latest={metrics} /> : null}
              {advanced === "body" ? (
                <View style={styles.quick}>
                  {(
                    [
                      ["happy", "happy"],
                      ["excited", "excited"],
                      ["angry", "angry"],
                      ["sad", "sad"],
                      ["thinking", "think"],
                      ["battle", "battle"],
                    ] as const
                  ).map(([mood, label]) => (
                    <Pressable key={mood} style={styles.qbtn} onPress={() => BodyWebViewAPI.setEmotion(mood)}>
                      <Text style={styles.qbtnT}>{label}</Text>
                    </Pressable>
                  ))}
                  <Pressable style={styles.qbtn} onPress={() => BodyWebViewAPI.react("[excited] Whoop — claws out!")}>
                    <Text style={styles.qbtnT}>react[]</Text>
                  </Pressable>
                </View>
              ) : null}
            </AdvancedWrap>
          ) : (
            <ChatScreen section={section} onSection={setSection} onNavigate={openAdvanced} />
          )}
        </View>
      </View>

      {!wide ? <View style={styles.tabbar}>{nav}</View> : null}
    </SafeAreaView>
  );
}

function AdvancedWrap({ title, onBack, children }: { title: string; onBack: () => void; children: React.ReactNode }) {
  return (
    <View style={styles.fill}>
      <View style={styles.advHead}>
        <Pressable onPress={onBack} hitSlop={8} accessibilityLabel="Back">
          <Text style={styles.advBack}>‹ Back</Text>
        </Pressable>
        <Text style={styles.advTitle}>{title}</Text>
      </View>
      <View style={styles.fill}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  shell: { flex: 1, flexDirection: "row" },
  stage: { flex: 1 },
  fill: { flex: 1 },
  hidden: { height: 0, overflow: "hidden", flex: 0 },

  // Mac: calm left rail.
  sidebar: {
    width: 184,
    backgroundColor: theme.cardSoft,
    borderRightWidth: 1,
    borderRightColor: theme.accentLine,
    paddingVertical: theme.space.md,
    paddingHorizontal: theme.space.sm,
    gap: theme.space.lg,
  },
  sideBrand: { flexDirection: "row", alignItems: "center", gap: theme.space.sm, paddingHorizontal: theme.space.sm },
  mark: { width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: theme.accent },
  sideName: { color: theme.text, fontSize: theme.type.caption, fontWeight: "800", letterSpacing: 2 },
  sideTabs: { gap: theme.space.xs },
  sideTab: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space.sm,
    paddingVertical: 10,
    paddingHorizontal: theme.space.sm,
    borderRadius: theme.radius.sm,
  },
  sideTabOn: { backgroundColor: theme.accentSoft },
  sideLabel: { color: theme.dim, fontSize: theme.type.body, fontWeight: "600" },
  sideLabelOn: { color: theme.text },

  // iPhone: bottom bar.
  tabbar: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: theme.accentLine,
    backgroundColor: theme.cardSoft,
    paddingTop: 6,
    paddingBottom: 10,
    paddingHorizontal: theme.space.sm,
  },
  barTabs: { flex: 1, flexDirection: "row" },
  barTab: { flex: 1, alignItems: "center", gap: 2, paddingVertical: 2 },
  barGear: { alignItems: "center", justifyContent: "center", paddingHorizontal: theme.space.md, paddingVertical: 2 },
  tabIcon: { fontSize: 20, opacity: 0.55 },
  tabIconOn: { opacity: 1 },
  barLabel: { color: theme.faint, fontSize: theme.type.label, fontWeight: "600" },
  barLabelOn: { color: theme.accent },

  // Advanced screens keep a plain header with a way back.
  advHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space.md,
    paddingHorizontal: theme.space.md,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: theme.accentLine,
  },
  advBack: { color: theme.accent, fontSize: theme.type.body, fontWeight: "700" },
  advTitle: { color: theme.text, fontSize: theme.type.body, fontWeight: "800" },

  quick: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    justifyContent: "center",
    padding: 10,
    borderTopWidth: 1,
    borderTopColor: theme.accentLine,
  },
  qbtn: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    backgroundColor: theme.accentSoft,
    borderWidth: 1,
    borderColor: theme.accentLine,
    borderRadius: theme.radius.sm,
  },
  qbtnT: { color: theme.text, fontSize: theme.type.caption, fontWeight: "600" },
});
