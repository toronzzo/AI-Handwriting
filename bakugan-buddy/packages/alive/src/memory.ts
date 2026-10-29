import type { MemoryEvent, MemoryFacts } from "./types.ts";

const CAP = 48;

/** Ring of event objects allocated once. Pushes only rewrite fields. */
export class EventLog {
  readonly slots: MemoryEvent[];
  private start = 0;
  private count = 0;

  constructor(cap = CAP) {
    this.slots = new Array(cap);
    for (let i = 0; i < cap; i++) this.slots[i] = { t: 0, name: "", detail: "" };
  }

  get length(): number {
    return this.count;
  }

  push(t: number, name: string, detail: string): void {
    let index: number;
    if (this.count < this.slots.length) {
      index = (this.start + this.count) % this.slots.length;
      this.count += 1;
    } else {
      index = this.start;
      this.start = (this.start + 1) % this.slots.length;
    }
    const slot = this.slots[index]!;
    slot.t = t;
    slot.name = name;
    slot.detail = detail;
  }

  at(indexFromOldest: number): MemoryEvent {
    return this.slots[(this.start + indexFromOldest) % this.slots.length]!;
  }

  visit(fn: (event: MemoryEvent) => void): void {
    for (let i = 0; i < this.count; i++) fn(this.at(i));
  }

  /** Newest first, up to `max`, written into `into` (cleared first). */
  writeNewest(max: number, into: string[]): void {
    const take = max < this.count ? max : this.count;
    into.length = take;
    for (let i = 0; i < take; i++) {
      const event = this.at(this.count - 1 - i);
      into[i] = `${event.name} · ${event.detail}`;
    }
  }

  clear(): void {
    this.start = 0;
    this.count = 0;
  }
}

export function emptyFacts(): MemoryFacts {
  return {
    playerX: 0,
    playerZ: 0,
    playerAt: 0,
    partnerName: "partner",
    lastPlace: "",
    lastPlaceAt: 0,
  };
}

export type MemoryFile = {
  version: 1;
  events: MemoryEvent[];
  facts: MemoryFacts;
};

export function exportMemory(log: EventLog, facts: MemoryFacts): MemoryFile {
  const events: MemoryEvent[] = [];
  log.visit((event) => {
    events.push({ t: event.t, name: event.name, detail: event.detail });
  });
  return {
    version: 1,
    events,
    facts: { ...facts },
  };
}

export function exportMemoryJson(log: EventLog, facts: MemoryFacts): string {
  return JSON.stringify(exportMemory(log, facts));
}

export function loadMemoryJson(json: string, log: EventLog, facts: MemoryFacts): boolean {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return false;
  }
  if (!data || typeof data !== "object") return false;
  const file = data as Partial<MemoryFile>;
  if (file.version !== 1 || !Array.isArray(file.events)) return false;
  log.clear();
  for (let i = 0; i < file.events.length; i++) {
    const event = file.events[i];
    if (!event || typeof event.t !== "number" || typeof event.name !== "string") continue;
    log.push(event.t, event.name, typeof event.detail === "string" ? event.detail : "");
  }
  const next = file.facts;
  if (next && typeof next === "object") {
    if (typeof next.playerX === "number") facts.playerX = next.playerX;
    if (typeof next.playerZ === "number") facts.playerZ = next.playerZ;
    if (typeof next.playerAt === "number") facts.playerAt = next.playerAt;
    if (typeof next.partnerName === "string" && next.partnerName) facts.partnerName = next.partnerName;
    if (typeof next.lastPlace === "string") facts.lastPlace = next.lastPlace;
    if (typeof next.lastPlaceAt === "number") facts.lastPlaceAt = next.lastPlaceAt;
  }
  return true;
}
