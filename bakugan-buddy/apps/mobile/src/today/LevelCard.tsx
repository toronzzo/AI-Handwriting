import { useEffect, useRef, useState } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";
import { useArt } from "../art/slots.ts";
import { PreyasHeroSwitch } from "./PreyasHeroSwitch";
import { theme } from "../theme";
import { ArtSlot } from "../ui/ArtSlot";
import { Panel } from "../ui/Panel";
import { useReducedMotion } from "../ui/useReducedMotion";
import { HalftoneDisc, PrintedBar } from "./risoPrint";
import type { AreaId } from "../rpg/types.ts";
import { AREAS } from "../rpg/types.ts";
import { usePreyasActivity } from "../state/usePreyasActivity";
import { useRpg } from "./useRpg";

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
 * The riso level card: a 96 px Oswald level number with Preyas overlapping
 * it, a halftone disc behind him, the XP as a printed bar with tick marks
 * and the rank line under it. A level-up pops the LEVEL UP pill for 2 s; XP
 * gains float as "+N Area" chips for 1.8 s. Both animations are skipped when
 * the user prefers reduced motion.
 *
 * When the user has a `hero` picture in his own art folder it fills the stage
 * and the ball moves to the bottom-right at half the width. Without the
 * picture the halftone disc and the level number stay visible behind him.
 */
export function LevelCard() {
  const { snapshot, message } = useRpg();
  const reduce = useReducedMotion();
  const hero = useArt("hero");
  const hasHero = hero.status === "ready" && Boolean(hero.url);
  // The same body state the chat publishes, so Today never claims he is resting
  // while a reply or a search is really running.
  const body = usePreyasActivity();

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
  const nowXp = Math.min(snapshot.levelInto, snapshot.levelNeed);

  return (
    <Panel style={styles.card} padding={0} plate="PL. 01">
      <View style={styles.stage}>
        {hasHero ? (
          <View style={styles.heroImage}>
            <ArtSlot slot="hero" radius={0} style={styles.heroSlot} editable />
          </View>
        ) : (
          /**
           * Without a picture the empty placeholder is the BACKGROUND (drawn
           * first, lowest layer) and Preyas is drawn on top of it.
           *
           * box-none: the placeholder ignores taps, but the "Change photo"
           * button inside it still takes them, and it carries a higher zIndex
           * than Preyas so it also shows on top of him.
           */
          <View style={styles.heroBack}>
            <ArtSlot slot="hero" radius={0} style={styles.heroSlot} editable />
          </View>
        )}
        <HalftoneDisc size={218} style={styles.disc} />
        <View style={styles.levelBlock} pointerEvents="none">
          <Text style={styles.lvLabel}>LV</Text>
          <Text style={styles.levelNumber}>{snapshot.level}</Text>
        </View>
        <View
          style={hasHero ? styles.heroCorner : styles.hero}
          pointerEvents={hasHero ? "auto" : "box-none"}
        >
          <PreyasHeroSwitch state={body} short={false} fill fitBox={!hasHero} />
        </View>
        {levelUp ? (
          <Animated.View
            style={[styles.levelUpPill, { transform: [{ scale: pillScale }] }]}
            accessibilityLiveRegion="polite"
            accessibilityLabel="Level up"
          >
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
        <View style={styles.nameRow}>
          <Text style={styles.name}>Preyas</Text>
          <Text style={styles.rank}>
            Rank {snapshot.rank.letter} · {snapshot.rank.name}
          </Text>
        </View>

        <PrintedBar
          pct={fill}
          min={0}
          max={snapshot.levelNeed}
          now={nowXp}
          label={`${nowXp} of ${snapshot.levelNeed} XP`}
        />
        <View style={styles.xpRow}>
          <Text style={styles.xpNumbers}>
            {snapshot.levelInto} / {snapshot.levelNeed} XP
          </Text>
          <Text style={styles.xpNumbers}>{snapshot.levelNeed - snapshot.levelInto} to next level</Text>
        </View>

        {message ? (
          <View style={styles.bubble} accessibilityLiveRegion="polite">
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
    height: 224,
    width: "100%",
    overflow: "hidden",
  },
  heroImage: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, width: "100%", height: "100%" },
  /** The hero picture fills the stage; its "Change photo" button sits in the
   *  bottom-left corner. It is a later sibling of the level-up pill and XP
   *  chips, so the button is never covered by them. */
  heroSlot: { flex: 1, height: "100%", borderWidth: 0 },
  /**
   * The empty placeholder sits UNDER Preyas. It has no zIndex, so the later
   * sibling (the Preyas layer, zIndex 2) paints over it. Its own "Change
   * photo" button is lifted to zIndex 3 by ArtSlot, so the button still
   * shows and still takes taps on top of him.
   */
  heroBack: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 0,
  },
  /** The halftone disc behind Preyas, cropped by the stage's overflow. */
  disc: { position: "absolute", right: -34, bottom: -38, zIndex: 1 },
  /** The big printed level number, overlapped by Preyas from the right. */
  levelBlock: { position: "absolute", left: 16, bottom: 12, zIndex: 1 },
  lvLabel: {
    fontFamily: theme.font.display,
    fontWeight: "700",
    fontSize: 13,
    letterSpacing: 2,
    textTransform: "uppercase",
    color: theme.vermilion,
    marginBottom: 2,
  },
  levelNumber: {
    fontFamily: theme.font.display,
    fontWeight: "700",
    fontSize: theme.type.display.level,
    lineHeight: 96,
    color: theme.text,
  },
  /** Preyas on top of the placeholder, overlapping the level number. */
  hero: { position: "absolute", left: "34%", right: 0, top: 0, bottom: 0, zIndex: 2 },
  /** With a hero picture the ball keeps the bottom-right half of the stage. */
  heroCorner: {
    position: "absolute",
    right: 0,
    bottom: 0,
    width: "50%",
    height: "100%",
  },
  levelUpPill: {
    position: "absolute",
    top: 12,
    alignSelf: "center",
    backgroundColor: theme.accent,
    borderRadius: theme.radius.square,
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
    bottom: 10,
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 6,
  },
  xpChip: {
    backgroundColor: theme.card,
    borderWidth: 1,
    borderColor: theme.lineStrong,
    borderRadius: theme.radius.square,
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  xpChipText: {
    color: theme.accentText,
    fontSize: 13,
    fontWeight: "700",
  },
  info: { paddingVertical: 16, paddingHorizontal: 18 },
  nameRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 10,
  },
  name: { color: theme.text, fontSize: 22, fontWeight: "700" },
  rank: { color: theme.dim, fontSize: 13 },
  xpRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 6,
    marginBottom: 10,
  },
  xpNumbers: { color: theme.dim, fontSize: 12.5 },
  bubble: {
    backgroundColor: theme.cardSoft,
    borderRadius: theme.radius.square,
    paddingVertical: 9,
    paddingHorizontal: 12,
  },
  bubbleText: { color: theme.text, fontSize: 13.5 },
});
