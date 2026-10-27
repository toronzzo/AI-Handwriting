import { MemorySqlDb } from "./memory-db.ts";
import { EMOTION_SCHEMA } from "./schema.ts";
import { loadPersisted, savePersisted, touchMood } from "./store.ts";
import { defaultEmotion } from "./decay.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const db = new MemorySqlDb();
db.run(EMOTION_SCHEMA);

const t0 = 1_700_000_000_000;
let state = {
  emotion: defaultEmotion(t0),
  partnerName: null as string | null,
  activeId: "preyas",
  bonds: { preyas: 10, pyrax: 8, vexar: 8 },
  facts: ["likes tides"],
  forms: { preyas: "sphere", pyrax: "sphere", vexar: "sphere" },
};

state = touchMood(state, "excited", 1, t0);
await savePersisted(db, state);

const loadedFresh = await loadPersisted(db, t0 + 1000);
assert(loadedFresh.emotion.mood === "excited", "persist mood");
assert(loadedFresh.facts[0] === "likes tides", "persist facts");

const loadedDecayed = await loadPersisted(db, t0 + 2 * 60 * 60_000);
assert(loadedDecayed.emotion.mood === "neutral", "decay on load");

console.log("emotion store tests OK");
