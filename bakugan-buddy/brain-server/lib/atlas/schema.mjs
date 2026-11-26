/**
 * The Atlas ontology.
 *
 * Two node kinds, and nothing else:
 *
 *  - a **record** is something that was written down: a note, a reminder, a
 *    chat turn, a document;
 *  - an **entity** is something a record can be about: a tool, a project, a
 *    promise, a decision, a moment, a document, a person.
 *
 * Records and entities are both nodes; the interesting edges are `mentions`
 * (a rule saw the entity named in the text, so confidence is 1) and `relates`
 * (a link was inferred, so its confidence is whatever the evidence earned).
 * Records are never linked straight to records: on this machine, linking note
 * to note by word overlap produced 124 edges, an average degree of 1.33, and
 * ten disconnected islands out of 186 notes. The entity layer is what fixes it.
 *
 * Every node and every edge carries its provenance - where it came from, when,
 * why, and how sure we are - because the map draws an uncertain link as a
 * dashed thread instead of pretending it is a fact.
 */

export const NODE_KINDS = ["record", "entity"];

/** What a record can be, by where it came from. */
export const RECORD_TYPES = ["note", "reminder", "chat", "doc"];

/** Active entity types. Each one has rows in the live corpus. */
export const ENTITY_TYPES = [
  "thing",
  "project",
  "promise",
  "decision",
  "moment",
  "document",
  "person",
];

/**
 * Declared but disabled. The schema knows these names so a later ingest can
 * switch them on, but nothing creates them until a source actually yields one.
 * Measured on 186 notes: `money` and `place` have zero rows between them.
 */
export const DISABLED_ENTITY_TYPES = ["money", "place"];

export const ALL_ENTITY_TYPES = [...ENTITY_TYPES, ...DISABLED_ENTITY_TYPES];

/**
 * A note already carries its own kind, and that kind is an ontology type. This
 * is the only mapping the extractor needs, and it covers every note.
 */
export const NOTE_KIND_TYPE = {
  todo: "promise",
  decision: "decision",
  idea: "project",
  fact: "thing",
  deadline: "moment",
};

export const RELATIONS = ["mentions", "relates"];

export const CONFIDENCE = {
  /** A rule saw the name in the text. */
  MENTION: 1,
  /** A rule inferred it from a pattern (a date, an amount, a quote). */
  RULE: 0.9,
  /** The local model proposed it. */
  MODEL: 0.75,
  /** Co-occurrence only: two things kept turning up together. */
  COOCCUR: 0.5,
};

/** Edges under this confidence are drawn dashed: a shaky link looks shaky. */
export const DASH_BELOW = 0.6;

export function typeForNoteKind(kind) {
  return NOTE_KIND_TYPE[String(kind ?? "").trim().toLowerCase()] || "thing";
}

export function isEntityType(type) {
  return ALL_ENTITY_TYPES.includes(String(type ?? ""));
}

export function isActiveEntityType(type) {
  return ENTITY_TYPES.includes(String(type ?? ""));
}

export function clampConfidence(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

function requiredText(value, field, id) {
  const text = String(value ?? "").trim();
  if (!text) throw new TypeError(`${id}: ${field} is required`);
  return text;
}

/**
 * Validate one node on the way into the graph. Returns a normalised copy, so
 * callers never hand the graph a node with a missing alias list or a NaN time.
 */
export function validateNode(raw) {
  const id = requiredText(raw?.id, "id", "node");
  const kind = String(raw?.kind ?? "");
  if (!NODE_KINDS.includes(kind)) {
    throw new TypeError(`${id}: kind must be one of ${NODE_KINDS.join(", ")}`);
  }
  const type = String(raw?.type ?? "");
  const allowed = kind === "record" ? RECORD_TYPES : ALL_ENTITY_TYPES;
  if (!allowed.includes(type)) {
    throw new TypeError(`${id}: ${kind} type "${type}" is not allowed`);
  }
  const source = raw?.source;
  if (!source || !String(source.kind ?? "").trim() || !String(source.id ?? "").trim()) {
    throw new TypeError(`${id}: every node carries its source`);
  }
  return {
    id,
    kind,
    type,
    label: String(raw?.label ?? "").replace(/\s+/g, " ").trim() || id,
    aliases: [...new Set((raw?.aliases ?? []).map((a) => String(a).trim()).filter(Boolean))],
    props: { ...(raw?.props ?? {}) },
    source: { kind: String(source.kind).trim(), id: String(source.id).trim() },
    at: Number.isFinite(Number(raw?.at)) ? Number(raw.at) : 0,
    confidence: clampConfidence(raw?.confidence ?? 1),
  };
}

/**
 * Validate one edge. `why` is not optional: an edge that cannot say why it
 * exists does not belong on the map.
 */
export function validateEdge(raw) {
  const from = requiredText(raw?.from, "from", "edge");
  const to = requiredText(raw?.to, "to", "edge");
  if (from === to) throw new TypeError(`edge ${from}: a node cannot link to itself`);
  const relation = String(raw?.relation ?? "");
  if (!RELATIONS.includes(relation)) {
    throw new TypeError(`edge ${from}->${to}: relation must be one of ${RELATIONS.join(", ")}`);
  }
  const source = raw?.source;
  if (!source || !String(source.kind ?? "").trim() || !String(source.id ?? "").trim()) {
    throw new TypeError(`edge ${from}->${to}: every edge carries its source`);
  }
  return {
    from,
    to,
    relation,
    why: requiredText(raw?.why, "why", `edge ${from}->${to}`),
    source: { kind: String(source.kind).trim(), id: String(source.id).trim() },
    at: Number.isFinite(Number(raw?.at)) ? Number(raw.at) : 0,
    confidence: clampConfidence(raw?.confidence ?? CONFIDENCE.RULE),
  };
}

/** True when the map should draw this edge dashed rather than solid. */
export function edgeDashed(confidence) {
  return clampConfidence(confidence) < DASH_BELOW;
}

/** A record node built from a written thing, already validated. */
export function recordNode({ id, type = "note", label = "", text = "", at = 0, source }) {
  const recordType = RECORD_TYPES.includes(type) ? type : "note";
  return validateNode({
    id,
    kind: "record",
    type: recordType,
    label: label || String(text).replace(/\s+/g, " ").trim().slice(0, 52),
    props: { text: String(text ?? "") },
    source: source || { kind: "unknown", id },
    at,
    confidence: 1,
  });
}

/** An entity node, already validated. */
export function entityNode({ id, type, label, at = 0, source, confidence = CONFIDENCE.RULE, aliases = [] }) {
  if (!isActiveEntityType(type)) {
    throw new TypeError(`entity ${id}: type "${type}" is declared but not active`);
  }
  return validateNode({ id, kind: "entity", type, label, aliases, source, at, confidence });
}
