/**
 * The animation clips baked into the 3D ball (assets/models/preyas_ball.glb).
 *
 * They live in their own file so the face panel can ask for a clip without
 * importing the 3D screen: only Preyas3D.tsx may point at PreyasHero (slice 8A),
 * and that module has to stay behind the lazy import.
 */
export const PREYAS_CLIPS = ["idle", "open", "close", "closed", "happy"] as const;

export type PreyasClip = (typeof PREYAS_CLIPS)[number];

export function isPreyasClip(name: string): name is PreyasClip {
  return (PREYAS_CLIPS as readonly string[]).includes(name);
}
