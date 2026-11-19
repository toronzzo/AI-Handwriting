/**
 * Draws one frame of a pixel Sprite as a single SVG of coloured squares
 * (slice 8A). One rect per run of same-coloured pixels, so a 24x24 Preyas is
 * about 120 rectangles instead of 576; the squares sit on whole-pixel
 * coordinates and the SVG has no smoothing, so edges stay crisp at any integer
 * scale. Transparent pixels are simply not drawn.
 *
 * Colours come only from bitPalette.ts (the noLooseColours test reads this
 * file and would fail on any literal here).
 *
 * Motion: frames swap about every 500 ms while the page is visible, and never
 * when the user asked for reduced motion (frame 0 only).
 */
import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Rect } from "react-native-svg";
import { bitColour } from "./bitPalette.ts";
import type { Sprite } from "./sprite.ts";
import { usePageVisible } from "../ui/usePageVisible";
import { useReducedMotion } from "../ui/useReducedMotion";

/** How long each frame stays on screen (the "idle bob"). */
export const FRAME_MS = 500;

type Props = {
  /** The sprite to draw. */
  sprite: Sprite;
  /** Which frames of the sprite to alternate, oldest first. */
  frames?: number[];
  /** Width, in device pixels, of one art pixel. Whole numbers only. */
  scale?: number;
  /** What a screen reader should say; defaults to "Preyas". */
  accessibilityLabel?: string;
};

type Run = { x: number; y: number; w: number; colour: string };

/** Collapse one frame into horizontal runs of one colour (background skipped). */
export function frameRuns(frame: string[]): Run[] {
  const runs: Run[] = [];
  frame.forEach((row, y) => {
    let at = 0;
    while (at < row.length) {
      const colour = bitColour(Number.parseInt(row[at], 16));
      let next = at + 1;
      while (next < row.length && bitColour(Number.parseInt(row[next], 16)) === colour) next += 1;
      if (colour) runs.push({ x: at, y, w: next - at, colour });
      at = next;
    }
  });
  return runs;
}

/** The frame index to show: frame 0 when still, otherwise steps through `frames`. */
export function frameAt(frames: number[], step: number): number {
  if (frames.length === 0) return 0;
  return frames[step % frames.length];
}

export function PixelSprite({ sprite, frames = [0], scale = 6, accessibilityLabel = "Preyas" }: Props) {
  const visible = usePageVisible();
  const reduce = useReducedMotion();
  const [step, setStep] = useState(0);
  const still = reduce || !visible || frames.length < 2;

  useEffect(() => {
    if (still) {
      setStep(0);
      return;
    }
    const timer = setInterval(() => setStep((value) => value + 1), FRAME_MS);
    return () => clearInterval(timer);
  }, [still]);

  const size = Number.isFinite(scale) && scale > 0 ? Math.round(scale) : 1;
  const index = still ? 0 : step % frames.length;
  const frameNumber = frameAt(frames, index);
  const frame = sprite.frames[frameNumber] ?? sprite.frames[0] ?? [];
  const runs = frameRuns(frame);

  return (
    <View
      style={[styles.frame, { width: sprite.w * size, height: sprite.h * size }]}
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
    >
      <Svg width={sprite.w * size} height={sprite.h * size} viewBox={`0 0 ${sprite.w} ${sprite.h}`}>
        {runs.map((run) => (
          <Rect
            key={`${run.x}-${run.y}-${run.w}`}
            x={run.x}
            y={run.y}
            width={run.w}
            height={1}
            fill={run.colour}
            stroke="none"
          />
        ))}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { alignItems: "center", justifyContent: "center" },
});
