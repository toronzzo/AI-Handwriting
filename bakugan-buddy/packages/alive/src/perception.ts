export type NoticeSlot = {
  id: string;
  name: string;
  seenMs: number;
  noticed: boolean;
  lastX: number;
  lastZ: number;
  lastAt: number;
};

export function makeSlot(id: string, name: string): NoticeSlot {
  return { id, name, seenMs: 0, noticed: false, lastX: 0, lastZ: 0, lastAt: 0 };
}

export type NoticeResult = "none" | "noticed" | "tracking";

/**
 * Seeing something fills a timer. He does not react until it completes.
 * Looking away early clears the timer. Leaving view after a notice
 * forgets the "I see you" flag so the next look has to fill the timer
 * again. Last-known position stays put until that new notice lands.
 */
export function tickNotice(
  slot: NoticeSlot,
  visible: boolean,
  x: number,
  z: number,
  dtMs: number,
  nowMs: number,
  noticeMs: number,
): NoticeResult {
  if (!visible) {
    slot.seenMs = 0;
    slot.noticed = false;
    return "none";
  }
  if (!slot.noticed) {
    slot.seenMs += dtMs > 0 ? dtMs : 0;
    if (slot.seenMs < noticeMs) return "none";
    slot.noticed = true;
    slot.seenMs = noticeMs;
    slot.lastX = x;
    slot.lastZ = z;
    slot.lastAt = nowMs;
    return "noticed";
  }
  slot.lastX = x;
  slot.lastZ = z;
  slot.lastAt = nowMs;
  return "tracking";
}

export function resetSlot(slot: NoticeSlot, id: string, name: string): void {
  slot.id = id;
  slot.name = name;
  slot.seenMs = 0;
  slot.noticed = false;
  slot.lastX = 0;
  slot.lastZ = 0;
  slot.lastAt = 0;
}
