/**
 * Gold examples on the client: fetch the newest examples from the brain on
 * load, every 10 minutes, and after a save; rank the top 2 into the system
 * prompt through the B1 seam. No React; errors keep the old list.
 */
import { brainFetch } from "../room/brain/token";
import { currentBrainUrl } from "../room/brain/brainLink";
import { registerChatExtras } from "../../../../packages/alive/src/chatTurn.ts";
import { formatExamples, pickExamples, type Example } from "../../../../packages/alive/src/examples.ts";

let list: Example[] = [];
let timer: ReturnType<typeof setInterval> | null = null;

async function refresh() {
  try {
    const res = await brainFetch(`${currentBrainUrl()}/v1/examples?limit=300`);
    if (!res.ok) return;
    const body = (await res.json()) as { examples?: Example[] };
    if (Array.isArray(body.examples)) list = body.examples;
  } catch {
    /* keep the old list */
  }
  // With no list the extras are simply empty.
  registerChatExtras((text) => formatExamples(pickExamples(list, text)));
}

function pageVisible(): boolean {
  return typeof document === "undefined" || !document.hidden;
}

export function startExamplesSync() {
  void refresh();
  if (timer === null) {
    timer = setInterval(() => {
      if (pageVisible()) void refresh();
    }, 10 * 60 * 1000);
  }
}

/** Called right after a save so the new example joins the next prompt. */
export function refreshExamples() {
  void refresh();
}

startExamplesSync();
