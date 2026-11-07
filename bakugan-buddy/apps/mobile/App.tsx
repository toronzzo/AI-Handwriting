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
import { isWide } from "./src/layout";

/** Advanced/demo surfaces that live behind Settings, not the main tabs. */
type Advanced = "room" | "body" | "bench";

export default function App() {
  const [section, setSection] = useState<Section>("chat");
  const [advanced, setAdvanced] = useState<Advanced | null>(null);
  const [metrics, setMetrics] = useState<BodyMetrics | null>(null);
  const wide = isWide(useWindowDimensions().width);

  const openAdvanced = (tab: Advanced) => setAdvanced(tab);

  // Mac: a slim icon rail with Settings pinned at the bottom.
  const rails = (
    <>
      <View style={styles.rail}>
        {MAIN_TABS.map((tab) => {
          const on = section === tab.id && !advanced;
          return (
            <Pressable
              key={tab.id}
              style={[styles.railItem, on && styles.railItemOn]}
              onPress={() => {
                setAdvanced(null);
                setSection(tab.id);
              }}
              accessibilityRole="button"
              accessibilityLabel={tab.label}
            >
              <Text style={styles.railIcon}>{tab.icon}</Text>
              <Text style={[styles.railLabel, on && styles.railLabelOn]}>{tab.label}</Text>
            </Pressable>
          );
        })}
      </View>
      <View style={styles.railFoot}>
        <Pressable
          style={[styles.railItem, section === "settings" && !advanced && styles.railItemOn]}
          onPress={() => {
            setAdvanced(null);
            setSection("settings");
          }}
          accessibilityRole="button"
          accessibilityLabel={SETTINGS_ENTRY.label}
        >
          <Text style={styles.railIcon}>{SETTINGS_ENTRY.icon}</Text>
          <Text style={[styles.railLabel, section === "settings" && !advanced && styles.railLabelOn]}>
            {SETTINGS_ENTRY.label}
          </Text>
        </Pressable>
      </View>
    </>
  );

  // iPhone: the same entries in a bottom bar.
  const bar = (
    <>
      <View style={styles.barTabs}>
        {MAIN_TABS.map((tab) => {
          const on = section === tab.id && !advanced;
          return (
            <Pressable
              key={tab.id}
              style={styles.barTab}
              onPress={() => {
                setAdvanced(null);
                setSection(tab.id);
              }}
              accessibilityRole="button"
              accessibilityLabel={tab.label}
            >
              <Text style={[styles.tabIcon, on && styles.tabIconOn]}>{tab.icon}</Text>
              <Text style={[styles.barLabel, on && styles.barLabelOn]}>{tab.label}</Text>
            </Pressable>
          );
        })}
      </View>
      <Pressable
        style={styles.barGear}
        onPress={() => {
          setAdvanced(null);
          setSection("settings");
        }}
        accessibilityRole="button"
        accessibilityLabel={SETTINGS_ENTRY.label}
      >
        <Text style={[styles.tabIcon, section === "settings" && !advanced && styles.tabIconOn]}>{SETTINGS_ENTRY.icon}</Text>
      </Pressable>
    </>
  );

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="light" />
      <View style={styles.shell}>
        {wide ? <View style={styles.sidebar}>{rails}</View> : null}

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

      {!wide ? <View style={styles.tabbar}>{bar}</View> : null}
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

  // Mac: a slim icon rail, Settings at the bottom.
  sidebar: {
    width: theme.size.nav,
    backgroundColor: theme.cardSoft,
    borderRightWidth: 1,
    borderRightColor: theme.accentLine,
    paddingVertical: theme.space.md,
    paddingHorizontal: theme.space.xs,
    alignItems: "center",
    justifyContent: "space-between",
  },
  rail: { alignItems: "center", gap: theme.space.sm, width: "100%" },
  railFoot: { alignItems: "center", width: "100%" },
  railItem: {
    width: theme.size.nav - theme.space.sm,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.space.xs,
    paddingVertical: theme.space.sm,
    borderRadius: theme.radius.sm,
  },
  railItemOn: { backgroundColor: theme.accentSoft },
  railIcon: { fontSize: theme.type.title },
  railLabel: { color: theme.faint, fontSize: theme.type.label, fontWeight: "600" },
  railLabelOn: { color: theme.accent },

  // iPhone: bottom bar.
  tabbar: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: theme.accentLine,
    backgroundColor: theme.cardSoft,
    paddingTop: theme.space.xs,
    paddingBottom: theme.space.sm,
    paddingHorizontal: theme.space.sm,
  },
  barTabs: { flex: 1, flexDirection: "row" },
  barTab: { flex: 1, alignItems: "center", gap: theme.space.xs / 2, paddingVertical: theme.space.xs / 2 },
  barGear: { alignItems: "center", justifyContent: "center", paddingHorizontal: theme.space.md, paddingVertical: theme.space.xs / 2 },
  tabIcon: { fontSize: theme.type.title, opacity: 0.55 },
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
