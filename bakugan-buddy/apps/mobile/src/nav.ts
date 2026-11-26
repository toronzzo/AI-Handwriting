/**
 * The whole app's shape: five main tabs and one settings entry.
 * The shell (App.tsx) renders this list; the test keeps the shape honest.
 */
export type MainTab = "today" | "chat" | "learn" | "memory" | "brain";
export type Section = MainTab | "settings";

/** The drawn NavMark glyph that replaces the emoji in the shell. */
export type NavGlyphId = "house" | "speech" | "book" | "ledger" | "brain";

export type TabDef = {
  id: MainTab;
  label: string;
  icon: string;
  /** The NavMark glyph the rail and the phone bar draw instead of the emoji. */
  glyph: NavGlyphId;
  /** One friendly sentence for the empty state, plus one example to try. */
  empty: string;
  example: string;
};

export const MAIN_TABS: TabDef[] = [
  {
    id: "today",
    label: "Today",
    icon: "🏠",
    glyph: "house",
    empty: "Your day at a glance: level, quests and focus.",
    example: "Try in chat: \"lunch plov 1500\" (logging comes soon)",
  },
  {
    id: "chat",
    label: "Chat",
    icon: "💬",
    glyph: "speech",
    empty: "This is home — talk with Preyas about anything.",
    example: "Try: “What's on my plate today?”",
  },
  {
    id: "learn",
    label: "Learn",
    icon: "🎓",
    glyph: "book",
    empty: "Preyas turns your documents into flashcards and quizzes you a little every day.",
    example: "Try in chat: “make flashcards from psychology.pdf”",
  },
  {
    id: "memory",
    label: "Memory",
    icon: "📒",
    glyph: "ledger",
    empty: "Everything Preyas remembers lives here — notes, ideas, decisions, reminders and documents.",
    example: "Try in chat: “remember my bike lock code is 4521”",
  },
  {
    id: "brain",
    label: "Brain",
    icon: "🧠",
    glyph: "brain",
    empty: "A map of Preyas's brains — the local model, the fallback and what is planned next.",
    example: "Try in chat: “which model is running?”",
  },
];

/** The tab by id; ids come from this list so the find never misses. */
export function tabById(id: MainTab): TabDef {
  return MAIN_TABS.find((tab) => tab.id === id)!;
}

export const SETTINGS_ENTRY = {
  id: "settings" as Section,
  label: "Settings",
  icon: "⚙️",
  glyph: "gear" as const,
};
