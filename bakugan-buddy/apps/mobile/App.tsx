import { useEffect, useState } from "react";
import {
  Image,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type ImageStyle,
  type ViewStyle,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { BodyWebView, BodyWebViewAPI, type BodyMetrics } from "./src/body/BodyWebView";
import { BenchmarkScreen } from "./src/screens/BenchmarkScreen";
import { RoomScreen } from "./src/room/RoomScreen";
import { RawChatScreen } from "./src/raw/RawChatScreen";
import { ChatScreen } from "./src/screens/ChatScreen";
import { TodayScreen } from "./src/today/TodayScreen";
import { BrainScreen } from "./src/brain/BrainScreen";
import { MAIN_TABS, SETTINGS_ENTRY, type Section } from "./src/nav";
import { chatPaneVisible, chatSectionFor, chatStaysMounted } from "./src/stage";
import { theme } from "./src/theme";
import { isWide, ROOT_ATTR, SHELL_ATTR, STAGE_ATTR, WEB_SHELL_CSS } from "./src/layout";
import { Stripe } from "./src/ui/Stripe";
import { useArt } from "./src/art/slots.ts";
import { SHADE_BANDS, mixColour } from "./src/skyCss.ts";
import { usePalette } from "./src/usePalette";
import { PreyasHeroSwitch } from "./src/today/PreyasHeroSwitch";
import { peekActivity, subscribeActivity } from "./src/state/activityStore";
import type { PreyasBodyState } from "./src/face/bodyState.ts";
import { usePresenceCues } from "./src/media/sounds/usePresenceCues.ts";

/** Web lets the sky show through; the iPhone paints the page colour. */
const isWeb = typeof document !== "undefined";

/** Advanced/demo surfaces that live behind Settings, not the main tabs. */
type Advanced = "room" | "body" | "bench" | "raw";

/**
 * Marks a view for the browser shell rules (WEB_SHELL_CSS) without adding a
 * prop on the iPhone, where native views have no DOM attributes.
 */
const webMark = (...attrs: string[]): Record<string, string> =>
  isWeb ? Object.fromEntries(attrs.map((attr) => [attr, ""])) : {};

export default function App() {
  // Browser only: the page must never be taller than the window, or the rail's
  // pinned Settings slides below the fold. Runs before the first paint.
  useState(installWebShellCss);
  usePresenceCues();
  const [section, setSection] = useState<Section>("today");
  const [advanced, setAdvanced] = useState<Advanced | null>(null);
  const [metrics, setMetrics] = useState<BodyMetrics | null>(null);
  const [bodyState, setBodyState] = useState<PreyasBodyState>(() => peekActivity());
  useEffect(() => subscribeActivity(setBodyState), []);
  const wide = isWide(useWindowDimensions().width);
  const palette = usePalette();
  const bgArt = useArt("bg");
  const hasBg = bgArt.status === "ready" && Boolean(bgArt.url);

  const openAdvanced = (tab: Advanced) => setAdvanced(tab);

  // Mac: a slim icon rail with Settings pinned at the bottom.
  const rails = (
    <>
      <View style={styles.rail}>
        <View style={styles.brand}>
          <View style={styles.brandBall} />
          <Stripe height={4} width={40} />
        </View>
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
              <Text style={[styles.railIcon, on && styles.railIconOn]}>{tab.icon}</Text>
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
          <Text style={[styles.railIcon, section === "settings" && !advanced && styles.railIconOn]}>{SETTINGS_ENTRY.icon}</Text>
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
              style={[styles.barTab, on && styles.barTabOn]}
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
        style={[styles.barGear, section === "settings" && !advanced && styles.barGearOn]}
        onPress={() => {
          setAdvanced(null);
          setSection("settings");
        }}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Settings"
      >
        <Text style={[styles.gearIcon, section === "settings" && !advanced && styles.tabIconOn]}>{SETTINGS_ENTRY.icon}</Text>
      </Pressable>
    </>
  );

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="light" />
      <View style={shellStyles.shell} {...webMark(SHELL_ATTR, ROOT_ATTR)}>
        {hasBg ? (
          // The user's own `bg` picture, behind everything, with a shade on
          // top so paper panels and text keep their contrast. It goes FIRST so
          // the shell below paints over it; no picture means no shade and the
          // sky shows through.
          <View style={backdropStyles.wrap} pointerEvents="none" accessibilityElementsHidden>
            <Image source={{ uri: bgArt.url }} style={backdropStyles.image} resizeMode="cover" alt="" />
            <View style={backdropStyles.shade}>
              {SHADE_BANDS.map((t) => (
                <View
                  key={t}
                  style={{ flex: 1, backgroundColor: mixColour(palette.bgShadeTop, palette.bgShadeBottom, t) }}
                />
              ))}
            </View>
          </View>
        ) : null}
        {wide ? <View style={styles.sidebar}>{rails}</View> : null}

        <View style={styles.stage} {...webMark(STAGE_ATTR)}>
          {advanced === "room" ? (
            <AdvancedWrap title="Preyas' room" onBack={() => setAdvanced(null)}>
              <RoomScreen />
            </AdvancedWrap>
          ) : advanced === "raw" ? (
            <AdvancedWrap title="Raw Qwen" onBack={() => setAdvanced(null)}>
              <RawChatScreen />
            </AdvancedWrap>
          ) : advanced === "body" || advanced === "bench" ? (
            <AdvancedWrap title={advanced === "body" ? "Body" : "Benchmark"} onBack={() => setAdvanced(null)}>
              {advanced === "body" ? (
                <View style={styles.fill}>
                  <PreyasHeroSwitch state={bodyState} fill bare accessibilityLabel="Preyas is alive" />
                  <View style={styles.bodyStateLine}>
                    <Text style={styles.bodyStateLabel}>Preyas is {bodyState}</Text>
                  </View>
                </View>
              ) : null}
              {advanced === "bench" ? (
                <View style={styles.fill}>
                  <BodyWebView onMetrics={setMetrics} />
                  <BenchmarkScreen latest={metrics} />
                </View>
              ) : null}
            </AdvancedWrap>
          ) : (
            <>
              {section === "today" ? (
                <View style={styles.fill}>
                  <TodayScreen />
                </View>
              ) : null}
              {section === "brain" ? (
                <View style={styles.fill}>
                  <BrainScreen />
                </View>
              ) : null}
            </>
          )}
          {chatStaysMounted(section, advanced !== null) ? (
            <View
              style={chatPaneVisible(section, advanced !== null) ? styles.fill : styles.parked}
              pointerEvents={chatPaneVisible(section, advanced !== null) ? "auto" : "none"}
              accessibilityElementsHidden={!chatPaneVisible(section, advanced !== null)}
              importantForAccessibility={chatPaneVisible(section, advanced !== null) ? "auto" : "no-hide-descendants"}
            >
              <ChatScreen section={chatSectionFor(section)} onSection={setSection} onNavigate={openAdvanced} />
            </View>
          ) : null}
        </View>
      </View>

      {!wide ? <View style={[styles.tabbar, mobileBarStyles.bar]}>{bar}</View> : null}
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
  root: { flex: 1, backgroundColor: isWeb ? "transparent" : theme.bg },
  // Same reasoning as the shell row: the stage must shrink to its slot so the
  // Memory list scrolls inside it rather than growing the page.
  stage: { flex: 1, minHeight: 0, overflow: "hidden", backgroundColor: isWeb ? "transparent" : theme.bg },
  fill: { flex: 1 },
  hidden: { height: 0, overflow: "hidden", flex: 0 },
  /** Chat stays mounted here so a reply can finish while another tab is open. */
  parked: { display: "none" },

  // Mac: a slim icon rail, Settings at the bottom.
  sidebar: {
    width: theme.size.nav,
    backgroundColor: theme.card,
    borderRightWidth: 1,
    borderRightColor: theme.accentLine,
    paddingVertical: theme.space.md,
    paddingHorizontal: theme.space.xs,
    alignItems: "center",
    justifyContent: "space-between",
    shadowColor: theme.shadow,
    shadowOpacity: 1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  rail: { alignItems: "center", gap: theme.space.sm, width: "100%" },
  railFoot: { alignItems: "center", width: "100%" },
  brand: { alignItems: "center", gap: theme.space.xs + 2, marginBottom: theme.space.sm },
  brandBall: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: theme.accent,
    borderWidth: 1,
    borderColor: theme.lineStrong,
  },
  railItem: {
    width: theme.size.nav - theme.space.sm,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.space.xs,
    paddingVertical: theme.space.sm,
    borderRadius: theme.radius.sm,
  },
  railItemOn: { backgroundColor: theme.accent },
  railIcon: { fontSize: theme.type.title, color: theme.dim },
  railIconOn: { color: theme.onAccent },
  railLabel: { color: theme.dim, fontSize: theme.type.label, fontWeight: "600" },
  railLabelOn: { color: theme.onAccent },

  // iPhone: bottom bar.
  tabbar: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: theme.accentLine,
    backgroundColor: theme.card,
    paddingTop: theme.space.xs,
    paddingBottom: theme.space.sm,
    paddingHorizontal: theme.space.sm,
  },
  barTabs: { flex: 1, flexDirection: "row", minWidth: 0 },
  barTab: { flex: 1, alignItems: "center", justifyContent: "center", gap: theme.space.xs / 2, minHeight: 44, paddingVertical: theme.space.xs / 2, borderRadius: theme.radius.sm },
  barTabOn: { backgroundColor: theme.accent },
  barGear: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
    minWidth: 48,
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.space.xs / 2,
    borderRadius: theme.radius.sm,
    opacity: 1,
  },
  barGearOn: { backgroundColor: theme.accent },
  tabIcon: { fontSize: theme.type.title, color: theme.dim },
  /** Settings gear stays full-opacity so it never looks disabled. */
  gearIcon: { fontSize: theme.type.title, color: theme.text, opacity: 1 },
  tabIconOn: { color: theme.onAccent },
  barLabel: { color: theme.dim, fontSize: theme.type.label, fontWeight: "600" },
  barLabelOn: { color: theme.onAccent },

  // Advanced screens keep a plain paper header with a way back.
  advHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space.md,
    paddingHorizontal: theme.space.md,
    paddingVertical: 10,
    backgroundColor: theme.card,
    borderBottomWidth: 1,
    borderBottomColor: theme.accentLine,
    shadowColor: theme.shadow,
    shadowOpacity: 1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  advBack: { color: theme.accent, fontSize: theme.type.body, fontWeight: "700" },
  advTitle: { color: theme.text, fontSize: theme.type.body, fontWeight: "800" },

  bodyStateLine: {
    paddingVertical: 8,
    alignItems: "center",
    backgroundColor: theme.cardSoft,
    borderTopWidth: 1,
    borderTopColor: theme.accentLine,
  },
  bodyStateLabel: { color: theme.dim, fontSize: theme.type.caption, fontWeight: "600" },
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

/**
 * The fixed bg picture and its shade.
 *
 * The picture is the first child of the shell and sits at the same stack level
 * as the shell's other children, so it paints first and the rail (and the
 * iPhone bottom bar) paint over it. The sky itself is only `html`'s own
 * background, so the picture covers it, and the shade on top keeps paper
 * panels and text readable.
 */
const backdropStyles: { wrap: ViewStyle; image: ImageStyle; shade: ViewStyle } = {
  wrap: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, pointerEvents: "none", zIndex: 0 },
  image: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, width: "100%", height: "100%" },
  shade: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
};

/**
 * The shell row. `relative` makes it the containing block for the fixed
 * picture, so the picture fills the window rather than one tab, on both
 * platforms.
 */
const shellStyles: { shell: ViewStyle } = {
  // minHeight 0 (plus the web rules) keeps the row exactly as tall as the
  // window, so a long Memory list scrolls inside the stage instead of
  // stretching the rail and hiding Settings.
  shell: { flex: 1, minHeight: 0, flexDirection: "row", position: "relative" },
};

/** Browser-only: pins the page to the window, once the document exists. */
function installWebShellCss(): void {
  if (!isWeb || typeof document === "undefined") return;
  const id = "preyas-shell-size";
  if (document.getElementById(id)) return;
  const style = document.createElement("style");
  style.id = id;
  style.textContent = WEB_SHELL_CSS;
  document.head.appendChild(style);
}

/** On the iPhone the bottom bar must paint over the bg picture, not under it. */
const mobileBarStyles: { bar: ViewStyle } = {
  bar: { zIndex: 1 },
};
