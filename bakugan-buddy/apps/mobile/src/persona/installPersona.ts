/**
 * Loads the live persona from the brain once on start and every 10 minutes
 * (skipped while the page is hidden), and swaps it into the chat system
 * prompt when its sha changed. No React; every error is ignored and the
 * current persona stays.
 */
import { currentBrainUrl } from "../room/brain/brainLink";
import { brainFetch } from "../room/brain/token";
import { setChatSystem } from "../../../../packages/alive/src/chatTurn.ts";

let lastSha = "";
let timer: ReturnType<typeof setInterval> | null = null;

async function refreshPersona() {
  try {
    const res = await brainFetch(`${currentBrainUrl()}/v1/persona`);
    if (!res.ok) return;
    const persona = (await res.json()) as { text?: string; sha256?: string };
    if (typeof persona.text !== "string" || typeof persona.sha256 !== "string" || !persona.sha256) return;
    if (persona.sha256 === lastSha) return;
    if (setChatSystem(persona.text)) lastSha = persona.sha256;
  } catch {
    /* keep the current persona */
  }
}

function pageVisible(): boolean {
  return typeof document === "undefined" || !document.hidden;
}

export function startPersonaSync() {
  void refreshPersona();
  if (timer === null) {
    timer = setInterval(() => {
      if (pageVisible()) void refreshPersona();
    }, 10 * 60 * 1000);
  }
}

startPersonaSync();
