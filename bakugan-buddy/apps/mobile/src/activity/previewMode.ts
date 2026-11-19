/**
 * How big the corner preview is on this screen. Pure, so it is tested without
 * a browser: a Mac gets the full card, a narrow window a small chip that opens
 * the card on tap, and a phone gets nothing (the thread needs the room).
 */
export type PreviewMode = "card" | "chip" | "none";

export const PREVIEW_CARD = { width: 240, height: 150 };
export const PREVIEW_CHIP = { width: 96, height: 60 };

export function previewMode(width: number): PreviewMode {
  if (!Number.isFinite(width) || width < 900) return "none";
  if (width >= 1400) return "card";
  return "chip";
}
