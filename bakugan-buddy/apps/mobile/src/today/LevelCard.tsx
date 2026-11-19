import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, StyleSheet, Text, View } from "react-native";
import { useArt } from "../art/slots.ts";
import { PreyasHero } from "../screens/PreyasHero";
import { theme } from "../theme";
import { ArtSlot } from "../ui/ArtSlot";
import { Stripe } from "../ui/Stripe";
import { Panel } from "../ui/Panel";
import type { AreaId } from "../rpg/types.ts";
import { AREAS } from "../rpg/types.ts";
import { useRpg } from "./useRpg";

/** True when the platform prefers reduced motion; a local check (slice 11
 *  brings the shared hook). */
function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let cancel = false;
    if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
      const media = window.matchMedia("(prefers-reduced-motion: reduce)");
      const update = () => setReduce(media.matches);
      update();
      media.addEventListener("change", update);
      return () => media.removeEventListener("change", update);
    }
    // iPhone: AccessibilityInfo.isReduceMotionEnabled.
    AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (!cancel) setReduce(enabled);
    });
    return () => {
      cancel = true;
    };
  }, []);
  return reduce;
}

/** One floating "+N Area" chip that rises and fades over 1.8 s. */
function XpChip({ area, xp, reduce }: { area: AreaId; xp: number; reduce: boolean }) {
  const rise = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduce) {
      rise.setValue(0);
      return;
    }
    rise.setValue(0);
    // JS driver: the web app has no native animated module, and these are tiny.
    Animated.timing(rise, { toValue: 1, duration: 1800, useNativeDriver: false }).start();
  }, [reduce, rise]);
  const translateY = rise.interpolate({ inputRange: [0, 1], outputRange: [0, -46] });
  const opacity = rise.interpolate({ inputRange: [0, 0.15, 1], outputRange: [1, 1, 0] });
  const name = AREAS.find((areaRow) => areaRow.id === area)?.name ?? area;
  return (
    <Animated.View style={[styles.xpChip, { opacity, transform: [{ translateY }] }]}>
      <Text style={styles.xpChipText}>
        +{xp} {name}
      </Text>
    </Animated.View>
  );
}

/**
 * The level card: Preyas on his sky stage, the level badge, the XP bar and
 * the rank line. A level-up pops the LEVEL UP pill for 2 s; XP gains float
 * as "+N Area" chips for 1.8 s. Both animations are skipped when the user
 * prefers reduced motion.
 *
 * When the user has a `hero` picture in his own art folder it fills the stage
 * and the ball moves to the bottom-right at half the width, with a soft drop
 * shadow so it stays readable over the picture. Without the picture nothing
 * changes.
 */
export function LevelCard() {
  const { snapshot, message } = useRpg();
  const reduce = useReduceMotion();
  const hero = useArt("hero");
  const hasHero = hero.status === "ready" && Boolean(hero.url);

  const prevLevel = useRef(snapshot.level);
  const prevAreaXp = useRef<Record<AreaId, number>>({ ...snapshot.areaXp });
  const chipId = useRef(0);
  const [levelUp, setLevelUp] = useState(false);
  const [chips, setChips] = useState<{ id: number; area: AreaId; xp: number }[]>([]);
  const pillScale = useRef(new Animated.Value(0.6)).current;

  useEffect(() => {
    const before = prevLevel.current;
    prevLevel.current = snapshot.level;
    if (snapshot.level <= before) return;
    setLevelUp(true);
    const timer = setTimeout(() => setLevelUp(false), 2000);
    return () => clearTimeout(timer);
  }, [snapshot.level]);

  useEffect(() => {
    const gains: { area: AreaId; xp: number }[] = [];
    for (const area of Object.keys(snapshot.areaXp) as AreaId[]) {
      const diff = snapshot.areaXp[area] - (prevAreaXp.current[area] ?? snapshot.areaXp[area]);
      if (diff > 0) gains.push({ area, xp: diff });
    }
    prevAreaXp.current = { ...snapshot.areaXp };
    if (!gains.length) return;
    const added = gains.map((gain) => ({ id: chipId.current++, ...gain }));
    setChips((list) => [...list, ...added]);
    const timer = setTimeout(() => {
      setChips((list) => list.filter((chip) => !added.some((row) => row.id === chip.id)));
    }, 1800);
    return () => clearTimeout(timer);
  }, [snapshot.areaXp]);

  useEffect(() => {
    if (!levelUp) return;
    if (reduce) {
      pillScale.setValue(1);
      return;
    }
    pillScale.setValue(0.6);
    // JS driver: the web app has no native animated module, and these are tiny.
    Animated.timing(pillScale, { toValue: 1, duration: 240, useNativeDriver: false }).start();
  }, [levelUp, reduce, pillScale]);

  const fill = Math.min(100, Math.round((snapshot.levelInto / snapshot.levelNeed) * 100));
  const fillWidth = `${fill}%` as const;

  return (
    <Panel style={styles.card} padding={0}>
      <View style={styles.stage}>
        {hasHero ? (
          <View style={styles.heroImage}>
            <ArtSlot slot="hero" radius={0} style={styles.heroSlot} editable />
          </View>
        ) : (
          <View style={[StyleSheet.absoluteFill, { zIndex: 1 }]} pointerEvents="box-none">
            <ArtSlot slot="hero" radius={0} style={styles.heroSlot} editable />
          </View>
        )}
        <View style={hasHero ? styles.heroCorner : styles.hero}>
          <PreyasHero talking={false} short={false} fill />
        </View>
        {levelUp ? (
          <Animated.View style={[styles.levelUpPill, { transform: [{ scale: pillScale }] }]}>
            <Text style={styles.levelUpText}>LEVEL UP</Text>
          </Animated.View>
        ) : null}
        <View style={styles.chips} pointerEvents="none">
          {chips.map((chip) => (
            <XpChip key={chip.id} area={chip.area} xp={chip.xp} reduce={reduce} />
          ))}
        </View>
      </View>

      <View style={styles.info}>
        <View style={styles.badgeRow}>
          <View style={styles.badge}>
            <Text style={styles.badgeLabel}>LV</Text>
            <Text style={styles.badgeLevel}>{snapshot.level}</Text>
          </View>
          <View style={styles.nameBlock}>
            <Text style={styles.name}>Preyas</Text>
            <Text style={styles.rank}>
              Rank {snapshot.rank.letter} · {snapshot.rank.name}
            </Text>
          </View>
        </View>

        <View style={styles.bar}>
          <View style={[styles.fill, { width: fillWidth }]} />
        </View>
        <View style={styles.fillStripe}>
          <Stripe height={2} width={fillWidth} />
        </View>
        <View style={styles.xpRow}>
          <Text style={styles.xpNumbers}>
            {snapshot.levelInto} / {snapshot.levelNeed} XP
          </Text>
          <Text style={styles.xpNumbers}>{snapshot.levelNeed - snapshot.levelInto} to next level</Text>
        </View>

        {message ? (
          <View style={styles.bubble}>
            <Text style={styles.bubbleText}>{message}</Text>
          </View>
        ) : snapshot.isDemo ? (
          <View style={styles.bubble}>
            <Text style={styles.bubbleText}>This is demo data. Real progress comes from your log.</Text>
          </View>
        ) : null}
      </View>
    </Panel>
  );
}

const styles = StyleSheet.create({
  card: { overflow: "hidden" },
  stage: {
    aspectRatio: 300 / 214,
    width: "100%",
    overflow: "hidden",
  },
  band: { width: "100%" },
  heroImage: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, width: "100%", height: "100%" },
  /** The hero picture fills the stage; its "Change photo" button sits in the
   *  bottom-left corner. It is a later sibling of the level-up pill and XP
   *  chips, so the button is never covered by them. */
  heroSlot: { flex: 1, height: "100%", borderWidth: 0 },
  hero: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  /** With a hero picture the ball keeps the bottom-right half of the stage. */
  heroCorner: {
    position: "absolute",
    right: 0,
    bottom: 0,
    width: "50%",
    height: "100%",
    shadowColor: theme.shadow,
    shadowOpacity: 1,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
  },
  levelUpPill: {
    position: "absolute",
    top: 14,
    alignSelf: "center",
    backgroundColor: theme.accent,
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 22,
  },
  levelUpText: {
    fontFamily: theme.font.display,
    fontWeight: "700",
    fontSize: 28,
    textTransform: "uppercase",
    color: theme.onAccent,
  },
  chips: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 14,
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 6,
  },
  xpChip: {
    backgroundColor: theme.card,
    borderWidth: 1,
    borderColor: theme.accent,
    borderRadius: 13,
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  xpChipText: {
    color: theme.accentText,
    fontSize: 13,
    fontWeight: "700",
  },
  info: { paddingVertical: 18, paddingHorizontal: 20 },
  badgeRow: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 14 },
  badge: {
    width: 56,
    height: 56,
    borderRadius: 12,
    backgroundColor: theme.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeLabel: {
    color: theme.onAccent,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.4,
    lineHeight: 12,
  },
  badgeLevel: {
    color: theme.onAccent,
    fontFamily: theme.font.display,
    fontWeight: "700",
    fontSize: 32,
    lineHeight: 34,
  },
  nameBlock: { flex: 1 },
  name: { color: theme.text, fontSize: 24, fontWeight: "800" },
  rank: { color: theme.dim, fontSize: 13 },
  bar: {
    height: 8,
    borderRadius: 99,
    backgroundColor: theme.track,
    borderWidth: 1,
    borderColor: theme.accentLine,
    overflow: "hidden",
  },
  fill: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: theme.accent,
    borderRadius: 99,
  },
  fillStripe: { marginTop: 5 },
  xpRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 6,
    marginBottom: 10,
  },
  xpNumbers: { color: theme.dim, fontSize: 12.5 },
  bubble: {
    backgroundColor: theme.cardSoft,
    borderRadius: 12,
    paddingVertical: 9,
    paddingHorizontal: 12,
  },
  bubbleText: { color: theme.text, fontSize: 13.5 },
});
