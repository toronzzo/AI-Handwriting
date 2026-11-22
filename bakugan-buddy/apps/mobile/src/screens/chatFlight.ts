/**
 * A chat reply that outlives the screen.
 *
 * Leaving the Chat tab used to unmount the screen while the model was still
 * writing. The finished text was then applied to a component that was gone,
 * so coming back showed nothing and no error. The reply is recorded here,
 * and whichever screen is showing that chat can pick it up.
 */

export type FlightMessage = {
  t: number;
  content: string;
  role?: string;
};

export type FlightOutcome = {
  chatId: string | null;
  reply: FlightMessage | null;
  error: string;
};

type Listener = (outcome: FlightOutcome) => void;

const listeners = new Set<Listener>();
const latest = new Map<string, FlightOutcome>();

export function publishFlight(outcome: FlightOutcome): void {
  const chatId = outcome.chatId;
  if (!chatId) return;
  const saved: FlightOutcome = { ...outcome, chatId };
  latest.set(chatId, saved);
  for (const listener of [...listeners]) listener(saved);
}

export function subscribeFlight(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function peekFlight(chatId: string): FlightOutcome | null {
  return latest.get(chatId) ?? null;
}

export function clearFlight(chatId: string): void {
  latest.delete(chatId);
}

/** Append a settled reply unless this thread already shows that exact line. */
export function mergeFlightReply<T extends FlightMessage>(messages: readonly T[], reply: T | null): T[] {
  if (!reply || !reply.content) return [...messages];
  const exists = messages.some((row) => row.t === reply.t && row.content === reply.content && row.role === reply.role);
  if (exists) return [...messages];
  return [...messages, reply];
}
