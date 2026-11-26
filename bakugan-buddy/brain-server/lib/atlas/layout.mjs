/**
 * Where the nodes sit.
 *
 * The layout is computed here, on the server, once, and is deterministic: the
 * same nodes and edges always draw the same constellation. Doing it in the app
 * would mean physics on every render and a map that breathes and jitters when
 * nothing changed; doing it here means it can be tested, and a plate printed
 * yesterday still lines up with the plate printed today.
 *
 * The simulation is deliberately small: a golden-angle spiral start, pairwise
 * repulsion, springs along edges, a weak pull to centre so islands do not drift
 * into a corner, then a de-overlap pass that guarantees no two discs sit on top
 * of each other. No Math.random anywhere - the PRNG is seeded and local.
 */
import { edgeDashed } from "./schema.mjs";

export const LAYOUT = {
  iterations: 260,
  seed: 42,
  pad: 0.04,
  spring: 0.012,
  repel: 0.0022,
  centre: 0.002,
  minGap: 0.05,
  passes: 60,
};

export function mulberry32(seed) {
  let state = seed >>> 0;
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}

function deOverlap(pos, order, cfg) {
  for (let pass = 0; pass < cfg.passes; pass++) {
    let moved = false;
    for (let i = 0; i < order.length; i++) {
      for (let j = i + 1; j < order.length; j++) {
        const a = pos.get(order[i]);
        const b = pos.get(order[j]);
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let distance = Math.hypot(dx, dy);
        if (distance >= cfg.minGap) continue;
        if (distance === 0) {
          dx = 0.001;
          dy = 0.001;
          distance = Math.hypot(dx, dy);
        }
        const push = (cfg.minGap - distance) / 2 + 1e-4;
        a.x = clamp(a.x - (dx / distance) * push, 0, 1);
        a.y = clamp(a.y - (dy / distance) * push, 0, 1);
        b.x = clamp(b.x + (dx / distance) * push, 0, 1);
        b.y = clamp(b.y + (dy / distance) * push, 0, 1);
        moved = true;
      }
    }
    if (!moved) break;
  }
}

/** Node id to {x, y} in 0..1. Same input, same output, always. */
export function seededLayout(nodes = [], edges = [], options = {}) {
  const cfg = { ...LAYOUT, ...options };
  const count = nodes.length;
  const pos = new Map();
  if (!count) return pos;

  const random = mulberry32(cfg.seed);
  const order = nodes.map((entry) => entry.id);
  const golden = Math.PI * (3 - Math.sqrt(5));

  order.forEach((id, index) => {
    const radius = Math.sqrt((index + 1) / count) * 0.42;
    const angle = index * golden;
    pos.set(id, { x: 0.5 + Math.cos(angle) * radius, y: 0.5 + Math.sin(angle) * radius });
  });

  const links = edges.filter((edge) => pos.has(edge.from) && pos.has(edge.to));

  for (let step = 0; step < cfg.iterations; step++) {
    const force = new Map(order.map((id) => [id, { x: 0, y: 0 }]));

    for (let i = 0; i < count; i++) {
      const a = pos.get(order[i]);
      for (let j = i + 1; j < count; j++) {
        const b = pos.get(order[j]);
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let squared = dx * dx + dy * dy;
        if (squared === 0) {
          dx = (random() - 0.5) * 0.001;
          dy = (random() - 0.5) * 0.001;
          squared = dx * dx + dy * dy;
        }
        const strength = cfg.repel / squared;
        const inv = 1 / Math.sqrt(squared);
        force.get(order[i]).x += dx * inv * strength;
        force.get(order[i]).y += dy * inv * strength;
        force.get(order[j]).x -= dx * inv * strength;
        force.get(order[j]).y -= dy * inv * strength;
      }
    }

    for (const edge of links) {
      const a = pos.get(edge.from);
      const b = pos.get(edge.to);
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const strength = cfg.spring * (Number(edge.confidence) || 0.5);
      force.get(edge.from).x += dx * strength;
      force.get(edge.from).y += dy * strength;
      force.get(edge.to).x -= dx * strength;
      force.get(edge.to).y -= dy * strength;
    }

    for (const id of order) {
      const point = pos.get(id);
      const push = force.get(id);
      push.x += (0.5 - point.x) * cfg.centre;
      push.y += (0.5 - point.y) * cfg.centre;
      point.x = clamp(point.x + push.x, cfg.pad, 1 - cfg.pad);
      point.y = clamp(point.y + push.y, cfg.pad, 1 - cfg.pad);
    }
  }

  deOverlap(pos, order, cfg);
  return pos;
}

/** Disc size by degree, on a square root so a hub does not lie about its size. */
export function radiusFor(degree, { min = 34, max = 56, maxDegree = 1 } = {}) {
  const value = Math.max(0, Number(degree) || 0);
  const top = Math.max(1, Number(maxDegree) || 1);
  const scale = Math.sqrt(Math.min(value, top) / top);
  return Math.round(min + (max - min) * scale);
}

/** Where a label sits: just under its disc. */
export function labelOffset(radius) {
  return Number(radius) + 12;
}

/** Only labels that carry their weight are printed. */
export function shouldLabel(degree) {
  return (Number(degree) || 0) >= 3;
}

/**
 * The payload the app draws: positioned nodes with their size and label flag,
 * and edges already marked dashed or solid. Confidence is carried through so a
 * plate can explain itself.
 */
export function buildMap({ nodes = [], edges = [] } = {}, options = {}) {
  const degree = new Map(nodes.map((entry) => [entry.id, 0]));
  for (const edge of edges) {
    if (degree.has(edge.from)) degree.set(edge.from, degree.get(edge.from) + 1);
    if (degree.has(edge.to)) degree.set(edge.to, degree.get(edge.to) + 1);
  }
  const maxDegree = [...degree.values()].reduce((top, value) => Math.max(top, value), 1);
  const pos = seededLayout(nodes, edges, options);

  return {
    nodes: nodes.map((entry) => {
      const point = pos.get(entry.id) || { x: 0.5, y: 0.5 };
      const value = degree.get(entry.id) || 0;
      const radius = radiusFor(value, { maxDegree, ...(options.radius || {}) });
      return {
        id: entry.id,
        kind: entry.kind,
        type: entry.type,
        label: entry.label,
        x: point.x,
        y: point.y,
        radius,
        degree: value,
        labelled: shouldLabel(value),
      };
    }),
    edges: edges.map((edge) => ({
      from: edge.from,
      to: edge.to,
      relation: edge.relation,
      confidence: edge.confidence,
      dashed: edgeDashed(edge.confidence),
    })),
  };
}
