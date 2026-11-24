/**
 * Slash commands: the abilities the chat can actually do.
 *
 * A local 8B model cannot be trusted to call a tool on every turn, so these are
 * explicit. Each one maps to a route the brain already has and is tested there:
 *   /remember <fact>   POST /v1/notes
 *   /remind <text> [in 20m | at 18:00 | tomorrow 9:30]   POST /v1/reminders
 *   /find <words>      GET  /v1/notes?q=
 */

export type ChatCommandName = "remember" | "remind" | "find";

export type ChatCommand = { name: ChatCommandName; args: string };

export type CommandDef = {
  name: ChatCommandName;
  label: string;
  hint: string;
  example: string;
};

export const CHAT_COMMANDS: CommandDef[] = [
  {
    name: "remember",
    label: "Remember",
    hint: "Save a fact to memory",
    example: "/remember the dentist is on Friday",
  },
  {
    name: "remind",
    label: "Remind",
    hint: "Set a reminder — in 20m, at 18:00, tomorrow 9:30",
    example: "/remind call mom at 18:00",
  },
  {
    name: "find",
    label: "Find",
    hint: "Search what is already saved",
    example: "/find dentist",
  },
];

/** "/remind call mom at 18:00" -> { name: "remind", args: "call mom at 18:00" }. */
export function parseChatCommand(input: string): ChatCommand | null {
  const text = String(input ?? "").trim();
  if (!text.startsWith("/")) return null;
  const match = text.match(/^\/([a-z]+)[ \t]*([\s\S]*)$/i);
  if (!match) return null;
  const name = match[1].toLowerCase();
  if (!CHAT_COMMANDS.some((command) => command.name === name)) return null;
  return { name: name as ChatCommandName, args: match[2].trim() };
}

/** What the palette should offer while the user is still typing "/". */
export function matchingCommands(input: string): CommandDef[] {
  const text = String(input ?? "").trim();
  if (!text.startsWith("/")) return [];
  const word = text.slice(1).split(/\s/)[0].toLowerCase();
  if (!word) return CHAT_COMMANDS;
  return CHAT_COMMANDS.filter((command) => command.name.startsWith(word));
}

const MINUTE = 60_000;

function strip(text: string, phrase: string): string {
  return text
    .replace(phrase, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s,;.-]+|[\s,;.-]+$/g, "")
    .trim();
}

function atTime(day: Date, hour: number, minute: number): Date {
  const next = new Date(day.getTime());
  next.setHours(hour, minute, 0, 0);
  return next;
}

function hourOf(hour: number, meridiem?: string): number {
  if (!meridiem) return hour;
  const pm = meridiem.toLowerCase() === "pm";
  if (hour === 12) return pm ? 12 : 0;
  return pm ? hour + 12 : hour;
}

/**
 * The time in the text, removed from it. "in 20m" is relative; "at 18:00" is
 * today, and tomorrow when that clock time has already passed; "tomorrow 9:30"
 * is tomorrow. With no time at all, an hour from now.
 */
export function parseWhen(input: string, now: Date = new Date()): { text: string; due: Date; phrase: string } {
  const text = String(input ?? "").trim();
  const relative = text.match(/\bin\s+(\d{1,3})\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours)\b/i);
  if (relative) {
    const amount = Number(relative[1]);
    const hours = relative[2].toLowerCase().startsWith("h");
    return {
      text: strip(text, relative[0]),
      due: new Date(now.getTime() + amount * (hours ? 60 : 1) * MINUTE),
      phrase: relative[0],
    };
  }
  const tomorrow = text.match(/\btomorrow\s*(?:at\s*)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i);
  if (tomorrow) {
    const day = new Date(now.getTime() + 24 * 60 * MINUTE);
    const hour = hourOf(Number(tomorrow[1]), tomorrow[3]);
    const minute = Number(tomorrow[2] || 0);
    return { text: strip(text, tomorrow[0]), due: atTime(day, hour, minute), phrase: tomorrow[0] };
  }
  const clock = text.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i);
  if (clock) {
    const hour = hourOf(Number(clock[1]), clock[3]);
    const minute = Number(clock[2] || 0);
    let due = atTime(now, hour, minute);
    if (due.getTime() <= now.getTime()) due = atTime(new Date(now.getTime() + 24 * 60 * MINUTE), hour, minute);
    return { text: strip(text, clock[0]), due, phrase: clock[0] };
  }
  return { text, due: new Date(now.getTime() + 60 * MINUTE), phrase: "" };
}
