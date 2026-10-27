import { normalizeMood, type Mood } from "../../mood/src/index.ts";

export type EmotionSnapshot = {
  mood: Mood;
  /** 0..1 how strongly the mood is held */
  intensity: number;
  /** epoch ms when mood was last set by a turn / user */
  updatedAt: number;
};

/** Half-lives (ms) toward soft neutral — big feels fade faster. */
export const MOOD_HALF_LIFE_MS: Record<Mood, number> = {
  neutral: Number.POSITIVE_INFINITY,
  listening: 2 * 60_000,
  thinking: 3 * 60_000,
  happy: 12 * 60_000,
  excited: 6 * 60_000,
  surprised: 4 * 60_000,
  angry: 8 * 60_000,
  battle: 7 * 60_000,
  sad: 25 * 60_000,
};

const FLOOR = 0.12;

export function defaultEmotion(now = Date.now()): EmotionSnapshot {
  return { mood: "neutral", intensity: 0.35, updatedAt: now };
}

/**
 * Soft decay toward neutral. Pure — safe on the UI thread if you only
 * apply the result; never block the 60 fps body path on I/O.
 */
export function decayEmotion(
  snap: EmotionSnapshot,
  now = Date.now(),
): EmotionSnapshot {
  const mood = normalizeMood(snap.mood);
  if (mood === "neutral") {
    return {
      mood: "neutral",
      intensity: Math.min(1, Math.max(0.2, snap.intensity)),
      updatedAt: snap.updatedAt,
    };
  }
  const half = MOOD_HALF_LIFE_MS[mood] ?? 10 * 60_000;
  const elapsed = Math.max(0, now - snap.updatedAt);
  if (!Number.isFinite(half) || half <= 0) {
    return { mood, intensity: snap.intensity, updatedAt: snap.updatedAt };
  }
  const intensity = snap.intensity * Math.pow(0.5, elapsed / half);
  if (intensity < FLOOR) {
    return { mood: "neutral", intensity: 0.3, updatedAt: now };
  }
  return { mood, intensity, updatedAt: snap.updatedAt };
}

export function setEmotionSnap(
  mood: string,
  intensity = 1,
  now = Date.now(),
): EmotionSnapshot {
  return {
    mood: normalizeMood(mood),
    intensity: Math.max(0, Math.min(1, intensity)),
    updatedAt: now,
  };
}
