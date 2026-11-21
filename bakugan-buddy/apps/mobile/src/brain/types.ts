/**
 * Brain view data layer types.
 *
 * Pure logic, no UI: this folder must run under `node --experimental-strip-types`
 * with no enums and no react-native imports, so the screen, the demo rows and
 * the live health source share one vocabulary.
 *
 * The screen reads only `BrainMap`, never the demo rows or the health response
 * directly, so the demo source and the live source plug in behind the same
 * shape without rewriting the screen.
 */

/** How one brain node is behaving right now. */
export type BrainStatus = "online" | "fallback" | "planned" | "unavailable" | "offline" | "checking";

/**
 * Where the map's statuses came from, and how fresh they are.
 * - demo: the static configuration, shown until a live check answers;
 * - loading: the first live check is still running;
 * - live: a real read from this Mac;
 * - offline: the live check failed, so only the static configuration is left;
 * - stale: a live read was kept after a later check failed.
 */
export type BrainDataMode = "demo" | "loading" | "live" | "offline" | "stale";

/** One named brain in Preyas's map. */
export type BrainNode = {
  id: string;
  name: string;
  /** One short line for the map label under the node dot. */
  hint: string;
  /** One plain sentence for the detail panel: what this node does. */
  description: string;
  status: BrainStatus;
  /** True when `status` came from a live probe, not from the static config. */
  live?: boolean;
  /** One plain sentence about the current status, for live/offline nodes. */
  statusNote?: string;
};

/** Everything the screen needs to draw the brain map, in one object. */
export type BrainMap = {
  /** True while the statuses are static/configuration data, not a live read. */
  isDemo: boolean;
  /** Where the statuses came from and how fresh they are. */
  mode: BrainDataMode;
  /** ISO time of the last successful live read; null/absent when there is none. */
  checkedAt?: string | null;
  /** One plain sentence about the data, shown above the map. */
  note: string;
  /** The central node the others connect to. */
  core: BrainNode;
  /** The connected nodes, in display order around the core. */
  nodes: BrainNode[];
};

/**
 * The one interface the screen knows. The demo source returns the static map;
 * the live source returns the same shape after a bounded health read, so the
 * screen never has to know which one it is drawing.
 */
export interface BrainSource {
  get(): BrainMap;
}

/**
 * A `BrainSource` that can also read the Mac once. Offline, timeout and
 * malformed answers resolve to an honest fallback map; only cancellation
 * rejects, because a cancelled check must not paint an error.
 */
export interface LiveBrainSource extends BrainSource {
  refresh(options?: { signal?: AbortSignal; timeoutMs?: number }): Promise<BrainMap>;
}
