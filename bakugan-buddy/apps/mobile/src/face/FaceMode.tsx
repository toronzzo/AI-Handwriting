/**
 * Header face, and the fullscreen face.
 * The header button opens the large view. A preview row can hold one
 * expression still; Live lets the chat drive it again.
 */
import { useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { theme } from "../theme";
import { useReducedMotion } from "../ui/useReducedMotion";
import { EMOJI_STICKERS } from "./emojiCatalog.ts";
import { StickerGlyph } from "./StickerGlyph";
import {
  EXPRESSION_LABEL,
  FACE_EXPRESSIONS,
  liveExpression,
  type FaceExpression,
  type FacePlayback,
  type FaceSignals,
} from "./expression.ts";
import { PreyasHeroSwitch } from "../today/PreyasHeroSwitch";
import { clipForExpression } from "./clip.ts";
import { bodyStateFor } from "./bodyState.ts";

/**
 * The header avatar: the same 3D ball as the panel, at 46–56 px. The flat face
 * was the last place the drawing survived; the ball carries the motion now.
 */
export function FaceButton({
  signals,
  size,
  open,
  onToggle,
  onLongPress,
}: {
  signals: FaceSignals;
  /** Kept for the call site: the 3D ball reads the same signals itself. */
  playback?: () => FacePlayback;
  size: number;
  open: boolean;
  paused?: boolean;
  onToggle: () => void;
  onLongPress: () => void;
}) {
  const live = liveExpression(signals, signals.speaking);
  return (
    <Pressable
      onPress={onToggle}
      onLongPress={onLongPress}
      delayLongPress={450}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={open ? "Close Preyas face" : "Open Preyas face"}
      accessibilityHint="Shows the large Preyas. Long press opens the profile."
    >
      <PreyasHeroSwitch state={bodyStateFor(live)} clip={clipForExpression(live)} size={size} />
    </Pressable>
  );
}

export function FaceMode({
  signals,
  playback,
  onClose,
}: {
  signals: FaceSignals;
  playback: () => FacePlayback;
  onClose: () => void;
}) {
  const { height } = useWindowDimensions();
  const reduce = useReducedMotion();
  const [pin, setPin] = useState<FaceExpression | null>(null);
  /** The live expression the chat is driving, unless a chip pinned one. */
  const live = liveExpression(signals, signals.speaking);
  const expression = pin ?? live;
  /** Small on purpose: the ball reads as a figurine, not as a poster. */
  const ball = Math.max(170, Math.min(230, height * 0.24));

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <Modal visible transparent animationType={reduce ? "none" : "fade"} onRequestClose={onClose}>
      <View style={styles.scrim}>
        <ScrollView
          style={styles.cardScroll}
          contentContainerStyle={styles.card}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.head}>
            <Text style={styles.kicker}>PREYAS</Text>
            <Pressable
              onPress={onClose}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Close face"
              style={styles.close}
            >
              <Text style={styles.closeText}>Close</Text>
            </Pressable>
          </View>
          <PreyasHeroSwitch
            state={bodyStateFor(expression)}
            clip={clipForExpression(expression)}
            size={ball}
          />
          <Text style={styles.caption}>{pin ? EXPRESSION_LABEL[pin] : "Live"}</Text>
          <Text style={styles.dim}>
            {pin
              ? "A preview. Live follows the chat again."
              : "Live: he leans in while the mic is open, tilts while he thinks, and the shell opens when he speaks."}
          </Text>
          <View style={styles.chips}>
            <Chip label="Live" on={pin === null} onPress={() => setPin(null)} />
            {FACE_EXPRESSIONS.map((expression) => (
              <Chip
                key={expression}
                label={EXPRESSION_LABEL[expression]}
                on={pin === expression}
                onPress={() => setPin(expression)}
              />
            ))}
          </View>
          <Text style={styles.kicker}>STICKERS</Text>
          <View style={styles.stickers}>
            {EMOJI_STICKERS.map((sticker) => (
              <View key={sticker.code} style={styles.sticker}>
                {reduce ? (
                  <Text style={styles.glyph}>{sticker.emoji}</Text>
                ) : (
                  <StickerGlyph code={sticker.code} emoji={sticker.emoji} size={36} />
                )}
              </View>
            ))}
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      style={[styles.chip, on && styles.chipOn]}
    >
      <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: theme.scrim,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.space.md,
  },
  cardScroll: { width: "100%", maxWidth: 560, maxHeight: "100%" },
  card: {
    width: "100%",
    backgroundColor: theme.card,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.accentLine,
    padding: theme.space.md,
    alignItems: "center",
    gap: theme.space.sm,
  },
  head: {
    alignSelf: "stretch",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  kicker: {
    color: theme.accentText,
    fontSize: theme.type.label,
    fontWeight: "700",
    letterSpacing: 1.2,
  },
  close: {
    minWidth: 44,
    minHeight: 36,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: theme.space.sm,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.lineStrong,
  },
  closeText: { color: theme.text, fontSize: theme.type.caption, fontWeight: "700" },
  caption: {
    color: theme.text,
    fontFamily: theme.font.display,
    fontSize: theme.type.title,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  dim: { color: theme.dim, fontSize: theme.type.caption, textAlign: "center" },
  chips: {
    alignSelf: "stretch",
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: theme.space.xs,
    paddingVertical: theme.space.xs,
  },
  chip: {
    borderWidth: 1,
    borderColor: theme.lineStrong,
    borderRadius: 10,
    minHeight: 36,
    paddingHorizontal: theme.space.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  chipOn: { backgroundColor: theme.accent, borderColor: theme.accent },
  chipText: { color: theme.text, fontSize: theme.type.caption, fontWeight: "600" },
  chipTextOn: { color: theme.onAccent },
  stickers: {
    alignSelf: "stretch",
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: theme.space.sm,
    paddingVertical: theme.space.xs,
  },
  sticker: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.cardSoft,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    borderColor: theme.accentLine,
  },
  glyph: { fontSize: 26 },
});
