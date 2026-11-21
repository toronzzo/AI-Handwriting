/**
 * Pure Brain-map geometry (first foundation).
 *
 * Where each node sits inside the SVG viewBox and how a status maps to a
 * theme token. No React and no react-native imports, so it runs under
 * `node --experimental-strip-types`.
 */
import type { BrainStatus } from "./types.ts";

export type Point = { x: number; y: number };

/** The square SVG viewBox the map is drawn into. */
export const BRAIN_VIEW = 400;
/** Centre of the viewBox; the core node sits here. */
export const BRAIN_CX = BRAIN_VIEW / 2;
export const BRAIN_CY = BRAIN_VIEW / 2;
/** Distance from the centre to each connected node. */
export const BRAIN_RADIUS = 130;

/**
 * A status's theme token, chosen so no status ever reads as red (health,
 * mood and status stay informative, not alarming). The screen turns these
 * keys into real colours from the theme.
 */
export type StatusToken = "good" | "accent" | "off" | "note";

export const STATUS_TOKEN: Record<BrainStatus, StatusToken> = {
  online: "good",
  fallback: "accent",
  planned: "off",
  unavailable: "note",
  offline: "off",
  checking: "note",
};

/** A short, plain word for the detail panel's status line. */
export const STATUS_LABEL: Record<BrainStatus, string> = {
  online: "Online",
  fallback: "Fallback",
  planned: "Planned",
  unavailable: "Unavailable",
  offline: "Offline",
  checking: "Checking",
};

/**
 * Place `count` nodes evenly around the core, starting at the top and going
 * clockwise. Returns points in the same order the nodes arrive.
 */
export function brainRingPoints(count: number, cx: number = BRAIN_CX, cy: number = BRAIN_CY, radius: number = BRAIN_RADIUS): Point[] {
  if (count <= 0) return [];
  return Array.from({ length: count }, (_, i) => {
    const angle = -Math.PI / 2 + i * ((Math.PI * 2) / count);
    return { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius };
  });
}
