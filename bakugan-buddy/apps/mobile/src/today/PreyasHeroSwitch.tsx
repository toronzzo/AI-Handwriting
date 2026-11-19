/**
 * The hero spot (Today's level card and the Profile panel): either the
 * original 3D ball or the 8-bit Preyas, depending on the "8-bit look" switch.
 *
 * The 3D module is imported lazily from screens/Preyas3D.tsx and is only ever
 * rendered when the switch is OFF, so with 8-bit ON react-three-fiber is never
 * fetched and its canvas never mounts.
 *
 * The mood comes from the same local store the room uses (previewDecayedMood
 * over the saved emotion). It is read once when the sprite appears - a small
 * SQLite read that must never block the first paint - and falls back to
 * "neutral" when the store cannot be read (for example on the web build).
 */
import { useEffect, useState } from "react";
import { PixelSprite } from "../bits/PixelSprite";
import { PREYAS_SPRITE, moodFrames } from "../bits/preyasSprite";
import { useBitMode } from "../bits/useBitMode";
import { Preyas3D } from "../screens/Preyas3D";
import { loadCompanionState, previewDecayedMood } from "../state/emotionStore";

/** Preyas starts neutral and stays there until the store answers. */
export const FALLBACK_MOOD = "neutral";

/** The current mood for the pixel Preyas: the decayed mood, or neutral. */
export function usePreyasMood(enabled: boolean): string {
  const [mood, setMood] = useState(FALLBACK_MOOD);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void loadCompanionState()
      .then((state) => {
        if (!cancelled) setMood(previewDecayedMood(state).mood);
      })
      .catch(() => {
        if (!cancelled) setMood(FALLBACK_MOOD);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  return mood;
}

type Props = {
  talking: boolean;
  short: boolean;
  fill?: boolean;
  /** Size of one art pixel, in device pixels. */
  scale?: number;
  accessibilityLabel?: string;
};

/** Preyas: the 3D ball when the switch is OFF, the pixel sprite when it is ON. */
export function PreyasHeroSwitch({ talking, short, fill, scale = 5, accessibilityLabel }: Props) {
  const [bit] = useBitMode();
  const mood = usePreyasMood(bit);
  if (!bit) return <Preyas3D talking={talking} short={short} fill={fill} />;
  const frames = moodFrames(mood);
  return (
    <PixelSprite
      sprite={PREYAS_SPRITE}
      frames={frames}
      scale={scale}
      accessibilityLabel={accessibilityLabel ?? `Preyas, ${mood}`}
    />
  );
}
