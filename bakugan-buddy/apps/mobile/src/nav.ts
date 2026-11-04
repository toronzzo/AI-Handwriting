/**
 * The whole app's shape: three main tabs and one settings entry.
 * The shell (App.tsx) renders this list; the test keeps the shape honest.
 */
export type MainTab = "chat" | "learn" | "memory";
export type Section = MainTab | "settings";

export type TabDef = {
  id: MainTab;
  label: string;
  icon: string;
  /** One friendly sentence for the empty state, plus one example to try. */
  empty: string;
  example: string;
};

export const MAIN_TABS: TabDef[] = [
  {
    id: "chat",
    label: "Chat",
    icon: "💬",
    empty: "This is home — talk with Preyas about anything.",
    example: "Try: “What's on my plate today?”",
  },
  {
    id: "learn",
    label: "Learn",
    icon: "🎓",
    empty: "Preyas turns your documents into flashcards and quizzes you a little every day.",
    example: "Try in chat: “make flashcards from psychology.pdf”",
  },
  {
    id: "memory",
    label: "Memory",
    icon: "📒",
    empty: "Everything Preyas remembers lives here — notes, ideas, decisions, reminders and documents.",
    example: "Try in chat: “remember my bike lock code is 4521”",
  },
];

export const SETTINGS_ENTRY = { id: "settings" as Section, label: "Settings", icon: "⚙️" };
