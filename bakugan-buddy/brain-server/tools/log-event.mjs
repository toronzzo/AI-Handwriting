#!/usr/bin/env node
/**
 * Log one life event from the terminal, against $BAKUGAN_DATA_DIR.
 * Usage: node bakugan-buddy/brain-server/tools/log-event.mjs "coffee 1500₸"
 * Prints the confirm line (or the ask question / crisis line) and exits.
 */
import { asMs, crisisLine, dayKey, readEvents, readSettings } from "../lib/os/events.mjs";
import { confirmLine, logParsedEvents } from "../lib/os/eventsConfirm.mjs";
import { parseEvents } from "../lib/os/eventsParse.mjs";

const text = process.argv.slice(2).join(" ").trim();
if (!text) {
  console.error('Usage: node bakugan-buddy/brain-server/tools/log-event.mjs "text"');
  process.exit(2);
}
const dataDir = process.env.BAKUGAN_DATA_DIR || "";
if (!dataDir) {
  console.error("Set BAKUGAN_DATA_DIR first (for example /Volumes/Agent/BakuganBuddy).");
  process.exit(2);
}

const settings = readSettings(dataDir);
const nowMs = asMs(Date.now());
const from = dayKey(nowMs - 4 * 3600 * 1000, settings.tz);
const to = dayKey(nowMs, settings.tz);
const recent = readEvents(dataDir, { from, to, types: ["food"] }).filter((event) => Number(event.ts) >= nowMs - 4 * 3600 * 1000);

const parsed = parseEvents(text, { now: nowMs, tz: settings.tz, currency: settings.currency, recent });
if (parsed.crisis) {
  console.log(crisisLine(dataDir));
  process.exit(0);
}
if (parsed.ask) {
  console.log(`Question: ${parsed.ask}`);
  process.exit(0);
}
if (!parsed.events.length) {
  console.log("Nothing to log (not a clear fact, or a question/wish/plan).");
  process.exit(0);
}
const events = logParsedEvents(dataDir, parsed, { src: "tool", rawText: text, ts: parsed.ts });
console.log(confirmLine(events, text));
console.log(events.map((event) => event.id).join(" "));
