/**
 * Demo / configuration data for the Brain view (first foundation).
 *
 * These are the six brains the task asked to show, labelled clearly as
 * static configuration. A future live router/model-status source will read
 * the same `BrainMap` shape from the brain-server and swap in here, so this
 * file is the only thing that changes.
 */
import type { BrainMap, BrainSource } from "./types.ts";

export const DEMO_BRAIN_MAP: BrainMap = {
  isDemo: true,
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

/** The static source the screen uses today. */
export const demoBrainSource: BrainSource = {
  get(): BrainMap {
    return DEMO_BRAIN_MAP;
  },
};
