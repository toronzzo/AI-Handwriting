import { useEffect, useRef, useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Path, Rect } from "react-native-svg";
import { runOf, type ActivityState } from "../../../../packages/alive/src/activity.ts";
import { brainFrameSource, type FrameSource } from "./frameSource";
import {
  latestFrameId,
  previewExpired,
  previewRunning,
  previewTitle,
  wantsPreview,
} from "./previewState";
import { PREVIEW_CARD, PREVIEW_CHIP, type PreviewMode } from "./previewMode";
import { theme } from "../theme";

/** A small monitor line icon for the empty state and the chip. */
function MonitorIcon({ size = 20, tone = theme.dim }: { size?: number; tone?: string }) {
  const stroke = { stroke: tone, strokeWidth: 1.6, fill: "none" as const, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Rect x={2.5} y={4} width={19} height={13} rx={2} {...stroke} />
      <Path d="M8.5 20.5h7M12 17v3.5" {...stroke} />
    </Svg>
  );
}

function CloseButton({ onPress, tone = theme.text }: { onPress: () => void; tone?: string }) {
  const stroke = { stroke: tone, strokeWidth: 1.8, fill: "none" as const, strokeLinecap: "round" as const };
  return (
    <Pressable
      style={styles.close}
      onPress={onPress}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel="Close preview"
    >
      <Svg width={16} height={16} viewBox="0 0 16 16">
        <Path d="M4 4l8 8M12 4l-8 8" {...stroke} />
      </Svg>
    </Pressable>
  );
}

/**
 * The corner preview. A 240x150 paper card on a wide Mac, a 96x60 chip on a
 * narrower one (tap it for the card), nothing on a phone. It shows the newest
 * frame from a `FrameSource`; until a screen skill writes frames it shows the
 * honest placeholder "No screen feed yet". It hides 8 s after the run ends and
 * has its own close button.
 */
export function PreviewCard({
  state,
  runId,
  mode,
  brainUrl,
  source,
}: {
  state: ActivityState;
  runId: string;
  mode: PreviewMode;
  brainUrl?: string;
  /** Test hook: a stand-in FrameSource. */
  source?: FrameSource;
}) {
  const run = runOf(state, runId);
  const frameId = latestFrameId(run);
  const usable = wantsPreview(run);
  const [closed, setClosed] = useState(false);
  const [expandedChip, setExpandedChip] = useState(false);
  const [frame, setFrame] = useState<{ url: string; capturedAt: number } | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // The heart beat for the 8 s linger after a run ends.
  useEffect(() => {
    if (!usable || !run?.open) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [usable, run?.open]);

  const given = source ?? null;
  const frameSource = given ?? (frameId && brainUrl ? brainFrameSource(brainUrl, frameId) : null);
  useEffect(() => {
    setFrame(null);
    if (!frameSource) return;
    let cancelled = false;
    void frameSource.latest().then((next) => {
      if (!cancelled) setFrame(next);
    });
    return () => {
      cancelled = true;
      frameSource.dispose?.();
    };
    // A new frame id is a new picture.
  }, [frameId, given, brainUrl]);

  const visible =
    mode !== "none" && usable && !previewExpired(run, now) && !closed;
  if (!visible) return null;
  const running = previewRunning(run);
  const asCard = mode === "card" || expandedChip;
  const size = asCard ? PREVIEW_CARD : PREVIEW_CHIP;
  const showFrame = frame !== null;

  if (!asCard) {
    return (
      <View style={styles.chipWrap} pointerEvents="box-none">
        <Pressable
          style={styles.chip}
          onPress={() => setExpandedChip(true)}
          accessibilityRole="button"
          accessibilityLabel="Open preview"
        >
          {showFrame ? <Image source={{ uri: frame!.url }} style={styles.chipImage} resizeMode="cover" /> : <MonitorIcon size={20} />}
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.card, { width: size.width }]} accessibilityLabel={previewTitle(run)}>
      <View style={styles.titleRow}>
        <Text style={styles.title}>{previewTitle(run)}</Text>
        <CloseButton
          onPress={() => {
            if (mode === "chip") setExpandedChip(false);
            else setClosed(true);
          }}
        />
      </View>
      <View style={styles.area}>
        {showFrame ? (
          <Image source={{ uri: frame!.url }} style={styles.frame} resizeMode="cover" />
        ) : (
          <View style={styles.placeholder}>
            <MonitorIcon size={24} />
            <Text style={styles.placeholderText}>No screen feed yet</Text>
          </View>
        )}
        {running ? <View style={styles.liveDot} /> : null}
      </View>
    </View>
  );
}

const shadow = {
  shadowColor: theme.shadow,
  shadowOpacity: 1,
  shadowRadius: 8,
  shadowOffset: { width: 0, height: 8 },
  elevation: 3,
} as const;

const styles = StyleSheet.create({
  chipWrap: { position: "absolute", right: theme.space.md, zIndex: 12 },
  chip: {
    width: PREVIEW_CHIP.width,
    height: PREVIEW_CHIP.height,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.lineStrong,
    backgroundColor: theme.cardSoft,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    ...shadow,
  },
  chipImage: { width: "100%", height: "100%" },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.lineStrong,
    backgroundColor: theme.card,
    padding: theme.space.sm,
    gap: theme.space.xs,
    ...shadow,
  },
  titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { color: theme.text, fontSize: 12, fontWeight: "700", letterSpacing: 0.4 },
  close: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  area: {
    width: "100%",
    aspectRatio: 16 / 10,
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: theme.cardSoft,
  },
  frame: { width: "100%", height: "100%" },
  placeholder: { flex: 1, alignItems: "center", justifyContent: "center", gap: theme.space.xs },
  placeholderText: { color: theme.dim, fontSize: 12 },
  liveDot: { position: "absolute", top: 6, right: 6, width: 8, height: 8, borderRadius: 4, backgroundColor: theme.accent },
});
