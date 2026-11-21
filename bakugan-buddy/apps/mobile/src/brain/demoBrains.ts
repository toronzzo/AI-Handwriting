/**
 * Demo / configuration data for the Brain view.
 *
 * These are the six brains the map shows, labelled clearly as static
 * configuration. The live source (see `liveBrain.ts`) reads the Mac's health
 * and copies this map's shape and descriptions, updating only the local model
 * and router statuses. When a live read is not possible the map falls back to
 * this data instead of claiming anything is online.
 */
import type { BrainMap, BrainSource } from "./types.ts";

export const DEMO_BRAIN_MAP: BrainMap = {
  isDemo: true,
  mode: "demo",
  checkedAt: null,
  note: "Demo data — these statuses are examples, not a live reading.",
  core: {
    id: "preyas-core",
    name: "Preyas",
    hint: "The brain hub",
    description:
      "The central node that every other brain talks through. It decides where a request goes and keeps the rest of Preyas alive.",
    status: "online",
  },
  nodes: [
    {
      id: "local-model",
      name: "Local model",
      hint: "On this Mac",
      description:
        "The private Qwen model running on this computer through llama.cpp. Your words stay here and cost nothing.",
      status: "online",
    },
    {
      id: "paid-fallback",
      name: "Paid fallback",
      hint: "Only when asked",
      description:
        "An optional paid cloud route that can take over if the local model stalls. It is never used without asking first.",
      status: "fallback",
    },
    {
      id: "free-provider",
      name: "Free cloud slots",
      hint: "Available spaces",
      description:
        "Reserved spaces where free cloud providers could be added later. They are placeholders for now, not live providers.",
      status: "planned",
    },
    {
      id: "router",
      name: "Router",
      hint: "Decision layer",
      description:
        "The decision layer that picks which brain handles a request, based on what is online and what you asked for.",
      status: "online",
    },
    {
      id: "drawing",
      name: "Drawing brain",
      hint: "Coming later",
      description:
        "A future brain for drawing and sketching. It is a placeholder so the map has a home for it already.",
      status: "planned",
    },
    {
      id: "memory",
      name: "Memory service",
      hint: "Notes and memory",
      description:
        "The service that stores what Preyas remembers, like notes and decisions. It is a placeholder on the map for now.",
      status: "planned",
    },
  ],
};

/** The static source the live hook starts from and falls back to. */
export const demoBrainSource: BrainSource = {
  get(): BrainMap {
    return DEMO_BRAIN_MAP;
  },
};
