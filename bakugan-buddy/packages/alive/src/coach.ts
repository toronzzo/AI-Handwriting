/**
 * Coach chat commands, pure text parsing. The brain-server and the app share
 * this so the client only opens the coach flow when it really is a coach
 * message ("coaching notes" must NOT trigger).
 */

export type CoachIntent =
  | { kind: "start"; topic?: string }
  | { kind: "stop" }
  | { kind: "status" }
  | { kind: "learned" }
  | { kind: "saveLesson"; text?: string }
  | { kind: "done" }
  | { kind: "back" }
  | { kind: "skip" }
  | { kind: "why" };

const COACH_START = /^(?:coach|коуч)(?=$|[\s:,.!?…-])(?:\s*[:,-]?\s*([\s\S]+))?$/iu;
const COACH_STOP = /^(?:stop|exit)\s+coach$/iu;
const COACH_STOP_RU = /^стоп\s+коуч$/iu;
const COACH_STATUS = /^coach\s+status$/iu;
const COACH_WHERE = /^где\s+я\??$/iu;
const COACH_LEARNED = /^(?:what\s+have\s+i\s+learned|skills\s+learned)\??$/iu;
const COACH_LEARNED_RU = /^чему\s+я\s+научился\??$/iu;
const COACH_SAVE_LESSON = /^save\s+lesson(?:\s+([\s\S]+))?$/iu;
const COACH_SAVE_LESSON_RU = /^запомни\s+урок(?:\s+([\s\S]+))?$/iu;
const SESSION_DONE = /^(?:done|готово|ok|дальше|next)$/iu;
const SESSION_BACK = /^(?:back|назад)$/iu;
const SESSION_SKIP = /^(?:skip|пропустить|пропусти)$/iu;
const SESSION_WHY = /^(?:why|почему|зачем)\??$/iu;

/** In-session words only make sense while a coach session is running. */
export function isSessionWord(kind: CoachIntent["kind"]): boolean {
  return kind === "done" || kind === "back" || kind === "skip" || kind === "why";
}

/** "coach …" / "коуч …" / in-session words / "save lesson" … — or null. */
export function parseCoachIntent(raw: string): CoachIntent | null {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  if (COACH_STOP.test(text) || COACH_STOP_RU.test(text)) return { kind: "stop" };
  if (COACH_STATUS.test(text) || COACH_WHERE.test(text)) return { kind: "status" };
  if (COACH_LEARNED.test(text) || COACH_LEARNED_RU.test(text)) return { kind: "learned" };
  const save = text.match(COACH_SAVE_LESSON) ?? text.match(COACH_SAVE_LESSON_RU);
  if (save) {
    const body = save[1]?.trim();
    return body ? { kind: "saveLesson", text: body } : { kind: "saveLesson" };
  }
  const start = text.match(COACH_START);
  if (start) {
    const topic = start[1]?.trim();
    return topic ? { kind: "start", topic } : { kind: "start" };
  }
  if (SESSION_DONE.test(text)) return { kind: "done" };
  if (SESSION_BACK.test(text)) return { kind: "back" };
  if (SESSION_SKIP.test(text)) return { kind: "skip" };
  if (SESSION_WHY.test(text)) return { kind: "why" };
  return null;
}
