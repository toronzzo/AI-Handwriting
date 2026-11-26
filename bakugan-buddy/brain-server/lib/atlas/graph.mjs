/**
 * Reading the graph.
 *
 * A small in-memory index over validated nodes and edges: neighbourhoods,
 * a shortest path, the evidence behind a node, the loose notes that have no
 * thread yet, and the counts the map header prints. Every function is pure and
 * takes the data it needs, so the store (a later PR) only has to supply rows.
 *
 * Two rules are enforced here rather than trusted to callers: an edge pointing
 * at a node that does not exist is dropped instead of inventing an end, and a
 * walk never returns the same node twice.
 */

export const DAY_MS = 86_400_000;

export function createGraph({ nodes = [], edges = [] } = {}) {
  const byId = new Map();
  for (const node of nodes) byId.set(node.id, node);

  const adjacency = new Map();
  const live = [];

  const link = (id, entry) => {
    if (!adjacency.has(id)) adjacency.set(id, []);
    adjacency.get(id).push(entry);
  };

  for (const edge of edges) {
    if (!byId.has(edge.from) || !byId.has(edge.to)) continue;
    live.push(edge);
    link(edge.from, {
      id: edge.to,
      relation: edge.relation,
      confidence: edge.confidence,
      edge,
      direction: "out",
    });
    link(edge.to, {
      id: edge.from,
      relation: edge.relation,
      confidence: edge.confidence,
      edge,
      direction: "in",
    });
  }

  function node(id) {
    return byId.get(id) || null;
  }

  function all() {
    return [...byId.values()];
  }

  function degree(id) {
    return (adjacency.get(id) || []).length;
  }

  /** Everything within `depth` hops, each with how far away it was found. */
  function neighbors(id, { depth = 1, relations = null } = {}) {
    if (!byId.has(id)) return [];
    const maxDepth = Math.min(Math.max(1, Number(depth) || 1), 4);
    const seen = new Set([id]);
    const found = [];
    let frontier = [id];
    for (let hop = 1; hop <= maxDepth; hop++) {
      const next = [];
      for (const current of frontier) {
        for (const entry of adjacency.get(current) || []) {
          if (relations && !relations.includes(entry.relation)) continue;
          if (seen.has(entry.id)) continue;
          seen.add(entry.id);
          found.push({
            node: byId.get(entry.id),
            depth: hop,
            relation: entry.relation,
            confidence: entry.confidence,
            via: entry,
          });
          next.push(entry.id);
        }
      }
      frontier = next;
      if (!frontier.length) break;
    }
    return found;
  }

  /** Shortest chain of ids between two nodes, inclusive, or [] if unlinked. */
  function path(from, to, { maxDepth = 4 } = {}) {
    if (!byId.has(from) || !byId.has(to)) return [];
    if (from === to) return [from];
    const limit = Math.min(Math.max(1, Number(maxDepth) || 1), 6);
    const parents = new Map([[from, null]]);
    let frontier = [from];
    for (let hop = 0; hop < limit && frontier.length; hop++) {
      const next = [];
      for (const current of frontier) {
        for (const entry of adjacency.get(current) || []) {
          if (parents.has(entry.id)) continue;
          parents.set(entry.id, current);
          if (entry.id === to) {
            const chain = [to];
            let step = current;
            while (step !== null) {
              chain.push(step);
              step = parents.get(step);
            }
            return chain.reverse();
          }
          next.push(entry.id);
        }
      }
      frontier = next;
    }
    return [];
  }

  /** The evidence behind one node, oldest first. */
  function timeline(id) {
    const rows = (adjacency.get(id) || []).map((entry) => ({
      at: Number(entry.edge.at) || 0,
      why: entry.edge.why,
      relation: entry.relation,
      confidence: entry.confidence,
      direction: entry.direction,
      other: byId.get(entry.id),
    }));
    rows.sort((a, b) => a.at - b.at || String(a.other?.id ?? "").localeCompare(String(b.other?.id ?? "")));
    return rows;
  }

  function lastTouched(id) {
    const own = Number(byId.get(id)?.at) || 0;
    let latest = own;
    for (const entry of adjacency.get(id) || []) {
      latest = Math.max(latest, Number(entry.edge.at) || 0);
    }
    return latest;
  }

  /**
   * How alive a node is right now: 3 touched today, 2 this week, 1 this month,
   * 0 older. `now` is a parameter so the reading is repeatable in a test.
   */
  function heat(id, now = Date.now()) {
    const age = Number(now) - lastTouched(id);
    if (age < 0) return 3;
    if (age < DAY_MS) return 3;
    if (age < 7 * DAY_MS) return 2;
    if (age < 30 * DAY_MS) return 1;
    return 0;
  }

  /** Nodes that have not moved since `ts`. */
  function staleSince(ts) {
    const cutoff = Number(ts) || 0;
    return all().filter((entry) => lastTouched(entry.id) < cutoff);
  }

  /** Loose notes: on the map, connected to nothing yet. */
  function orphans() {
    return all().filter((entry) => degree(entry.id) === 0);
  }

  function stats() {
    const byType = {};
    const byRelation = {};
    const byKind = {};
    let dashed = 0;
    for (const entry of all()) {
      byType[entry.type] = (byType[entry.type] || 0) + 1;
      byKind[entry.kind] = (byKind[entry.kind] || 0) + 1;
    }
    for (const edge of live) {
      byRelation[edge.relation] = (byRelation[edge.relation] || 0) + 1;
      if (Number(edge.confidence) < 0.6) dashed += 1;
    }
    const loose = orphans().length;
    const total = all().length;
    return {
      nodes: total,
      edges: live.length,
      byType,
      byKind,
      byRelation,
      dashed,
      orphans: loose,
      orphanShare: total ? Number((loose / total).toFixed(3)) : 0,
      avgDegree: total ? Number(((live.length * 2) / total).toFixed(2)) : 0,
    };
  }

  /** One node plus its neighbourhood, as nodes and the edges between them. */
  function subgraph(id, { depth = 1 } = {}) {
    if (!byId.has(id)) return { nodes: [], edges: [] };
    const seed = byId.get(id);
    const near = neighbors(id, { depth });
    const ids = new Set([seed.id, ...near.map((entry) => entry.node.id)]);
    return {
      nodes: [seed, ...near.map((entry) => entry.node)],
      edges: live.filter((edge) => ids.has(edge.from) && ids.has(edge.to)),
    };
  }

  return {
    node,
    all,
    degree,
    neighbors,
    path,
    timeline,
    lastTouched,
    heat,
    staleSince,
    orphans,
    stats,
    subgraph,
    edges: () => [...live],
  };
}
