/**
 * Brain view data layer types (first foundation).
 *
 * Pure logic, no UI: this folder must run under `node --experimental-strip-types`
 * with no enums and no react-native imports, so the screen and a future live
 * router/model-status source can share one vocabulary.
 *
 * Everything here is deliberately typed but static today. The screen reads
 * only `BrainMap`, never the demo rows directly, so a live source can plug in
 * behind the same shape without rewriting the screen.
 */

/** How one brain node is behaving right now. */
export type BrainStatus = "online" | "fallback" | "planned" | "unavailable";

/** One named brain in Preyas's map. */
export type BrainNode = {
  id: string;
  name: string;
  /** One short line for the map label under the node dot. */
  hint: string;
  /** One plain sentence for the detail panel: what this node does. */
  description: string;
  status: BrainStatus;
};

/** Everything the screen needs to draw the brain map, in one object. */
export type BrainMap = {
  /** True while this is the static/configuration data, not live data. */
  isDemo: boolean;
  /** The central node the others connect to. */
  core: BrainNode;
  /** The connected nodes, in display order around the core. */
  nodes: BrainNode[];
};

/**
 * The one interface the screen knows. A future live router/model-status
 * source returns the same shape, so `getBrainMap()` is the only seam that
 * changes when demo data goes away.
 */
export interface BrainSource {
  get(): BrainMap;
}
