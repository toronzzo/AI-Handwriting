import {
  BAKUGANS,
  findBakuganByUtterance,
  splitSentences,
  type BakuganId,
  type Emotion,
} from "./bakugans";
import type { PartnerMemory } from "./memory";
import type { Form } from "./types";

export type BrainResult = {
  tagged: string;
  emotion: Emotion;
  text: string;
  memory: PartnerMemory;
  switchedTo?: BakuganId;
};

function pick<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)]!;
}

function bump(mem: PartnerMemory, id: BakuganId, n: number): PartnerMemory {
  const bonds = { ...mem.bonds, [id]: Math.min(100, Math.max(0, mem.bonds[id] + n)) };
  return { ...mem, bonds };
}

function remember(mem: PartnerMemory, fact: string): PartnerMemory {
  if (mem.facts.includes(fact)) return mem;
  return { ...mem, facts: [...mem.facts, fact].slice(-40) };
}

function setForm(mem: PartnerMemory, id: BakuganId, form: Form): PartnerMemory {
  return { ...mem, forms: { ...mem.forms, [id]: form } };
}

const NOT_A_NAME = new Set([
  "sad",
  "happy",
  "angry",
  "mad",
  "scared",
  "tired",
  "lonely",
  "fine",
  "good",
  "okay",
  "ok",
  "excited",
  "anxious",
  "stressed",
  "back",
  "here",
  "ready",
  "so",
  "just",
  "feeling",
  "really",
]);

function extractName(text: string): string | null {
  // Prefer explicit name phrases; "I'm sad/angry" is mood, not a name.
  const explicit = text
    .trim()
    .match(/(?:my name is|call me)\s+([A-Za-z][a-zA-Z'-]{1,24})/i);
  if (explicit?.[1]) return explicit[1];

  const m = text.trim().match(/^(?:i'?m|i am)\s+([A-Z][a-zA-Z'-]{1,24})\.?$/);
  if (!m?.[1]) return null;
  if (NOT_A_NAME.has(m[1].toLowerCase())) return null;
  return m[1];
}

function pack(
  emotion: Emotion,
  text: string,
  memory: PartnerMemory,
  switchedTo?: BakuganId,
): BrainResult {
  return { tagged: `[${emotion}] ${text}`, emotion, text, memory, switchedTo };
}

export function think(userText: string, mem: PartnerMemory): BrainResult {
  const text = userText.trim();
  const lower = text.toLowerCase();
  let next = { ...mem };
  const id = next.activeId;
  const profile = BAKUGANS[id];
  const who = next.partnerName ?? "partner";

  const switchTo = findBakuganByUtterance(text);
  if (
    switchTo &&
    switchTo !== id &&
    (/\b(switch|talk to|wake|summon|hey|call)\b/.test(lower) ||
      lower.trim() === BAKUGANS[switchTo].name.toLowerCase() ||
      BAKUGANS[switchTo].aliases.some((a) => lower.trim() === a) ||
      lower.includes(BAKUGANS[switchTo].name.toLowerCase()))
  ) {
    next = { ...next, activeId: switchTo };
    const emotion: Emotion =
      switchTo === "preyas" ? "excited" : switchTo === "pyrax" ? "fierce" : "mysterious";
    const line =
      switchTo === "preyas"
        ? `Heh — Preyas rollin' in! Miss me, ${who}?`
        : switchTo === "pyrax"
          ? `Pyrax here. Core's hot — let's go, ${who}.`
          : `Vexar. Quiet now. I'm listening, ${who}.`;
    return pack(emotion, line, bump(next, switchTo, 2), switchTo);
  }

  const name = extractName(text);
  if (name) {
    next = bump(remember({ ...next, partnerName: name }, `Partner's name is ${name}`), id, 5);
    if (id === "preyas") {
      return pack(
        "happy",
        pick([
          `${name}-han! Say, that's a name I can bounce to. I'm Preyas — your Aquos ball.`,
          `Alright, ${name}! Stick with me and we'll make a splash.`,
        ]),
        next,
      );
    }
    if (id === "pyrax") {
      return pack("happy", `${name}. Burned into my core. I'm Pyrax — say the word.`, next);
    }
    return pack("mysterious", `${name}. Noted. I'm Vexar. I don't forget.`, next);
  }

  if (/\b(open|battle|stand|transform|pop)\b/.test(lower)) {
    next = setForm(bump(next, id, 2), id, "battle");
    if (id === "preyas") {
      return pack("excited", `Whoop — poppin' open! Claws out, ${who}!`, next);
    }
    if (id === "pyrax") {
      return pack("fierce", `Battle form! Ready when you are, ${who}.`, next);
    }
    return pack("fierce", `Unfurling. Point me, ${who}.`, next);
  }

  if (/\b(rest|sleep|sphere|close|fold|chill)\b/.test(lower)) {
    next = setForm(next, id, "sphere");
    return pack(
      "calm",
      id === "preyas"
        ? `Sealin' up… still peekin' though. Don't you worry.`
        : `Back to sphere. Still here.`,
      next,
    );
  }

  if (/\b(hi|hello|hey|yo|sup)\b/.test(lower)) {
    next = bump(next, id, 1);
    if (id === "preyas") {
      return pack(
        "happy",
        pick([
          `Hey hey${next.partnerName ? `, ${next.partnerName}` : ""}! Preyas in the house — what's shakin'?`,
          `Well look who it is! Bounce me a hello back?`,
        ]),
        next,
      );
    }
    if (id === "pyrax") {
      return pack("excited", `Hey${next.partnerName ? `, ${next.partnerName}` : ""}. Core's warm — talk.`, next);
    }
    return pack("mysterious", `…Hey${next.partnerName ? `, ${next.partnerName}` : ""}. Go on.`, next);
  }

  if (/\b(how are you|how'?s it going|you ok)\b/.test(lower)) {
    return pack(
      "happy",
      id === "preyas"
        ? `Feelin' bouncy! Bond ${next.bonds[id]}/100. You good, ${who}?`
        : `Bond ${next.bonds[id]}/100. ${profile.name}'s steady. You?`,
      next,
    );
  }

  if (/\b(sad|lonely|anxious|stress|stressed|tired|hurt|scared)\b/.test(lower)) {
    next = bump(next, id, 3);
    if (id === "preyas") {
      return pack(
        "sad",
        `Aw, ${who}… c'mere. I'll droop with ya a sec, then we bounce back together.`,
        next,
      );
    }
    return pack("sad", `Hey ${who}. I've got you. Slow and steady.`, next);
  }

  if (/\b(mad|angry|annoyed|furious)\b/.test(lower)) {
    return pack(
      "fierce",
      id === "preyas"
        ? `Ooh, I feel that heat! Want me to shake it out with ya?`
        : `Yeah. Let's put that fire somewhere useful.`,
      bump(next, id, 1),
    );
  }

  if (/\b(love you|miss you|thank|thanks)\b/.test(lower)) {
    next = bump(next, id, 4);
    return pack(
      "happy",
      id === "preyas"
        ? `Heh — you got me hoppin', ${who}. Right back atcha!`
        : `Bond spiked. Right back at you, ${who}.`,
      next,
    );
  }

  if (/\b(joke|funny|laugh)\b/.test(lower)) {
    return pack(
      "amused",
      pick([
        `Why'd the Bakugan bring a ladder? To raise its G-Power! Wahaha!`,
        `Gate Card walks into an arena… and I already popped open for the punchline.`,
      ]),
      bump(next, id, 1),
    );
  }

  if (/\b(who are you|what are you|your name)\b/.test(lower)) {
    return pack(
      id === "preyas" ? "excited" : id === "pyrax" ? "fierce" : "mysterious",
      `I'm ${profile.name} — ${profile.attribute}. ${profile.tagline}`,
      next,
    );
  }

  if (/\b(bond|status|who'?s here|partners)\b/.test(lower)) {
    const roster = (["preyas", "pyrax", "vexar"] as BakuganId[])
      .map((k) => `${BAKUGANS[k].name} ${next.bonds[k]}`)
      .join(" · ");
    return pack("curious", `Active: ${profile.name}. Bonds — ${roster}.`, next);
  }

  if (/\bremember\b/.test(lower)) {
    const fact = text.replace(/^.*remember\s+/i, "").trim();
    if (fact.length > 2) {
      next = bump(remember(next, fact), id, 2);
      return pack("happy", `Got it locked: "${fact}." Won't forget, ${who}.`, next);
    }
  }

  next = bump(next, id, 1);
  if (id === "preyas") {
    return pack(
      "curious",
      pick([
        `Mm-hm, I'm listenin', ${who}. Keep talkin' — I'll bounce along.`,
        `Say now… what's the real splash we need to make?`,
        `I gotcha. Want a pep talk, a plan, or just a buddy ball?`,
      ]),
      next,
    );
  }
  if (id === "pyrax") {
    return pack(
      "curious",
      pick([
        `I'm with you, ${who}. Pep talk, plan, or listening?`,
        `Fire says go. What's the move?`,
      ]),
      next,
    );
  }
  return pack(
    "mysterious",
    pick([
      `Interesting, ${who}. Say the part you haven't said yet.`,
      `The quiet between words — that's where I listen.`,
    ]),
    next,
  );
}

export async function* streamReply(
  userText: string,
  mem: PartnerMemory,
  opts?: { signal?: AbortSignal; thinkMs?: number },
): AsyncGenerator<
  | { type: "emotion"; emotion: Emotion; memory: PartnerMemory; switchedTo?: BakuganId }
  | { type: "sentence"; sentence: string; index: number }
  | { type: "done"; result: BrainResult }
> {
  const thinkMs = opts?.thinkMs ?? 220 + Math.random() * 180;
  await delay(thinkMs, opts?.signal);
  const result = think(userText, mem);
  yield {
    type: "emotion",
    emotion: result.emotion,
    memory: result.memory,
    switchedTo: result.switchedTo,
  };
  await delay(50, opts?.signal);
  const sentences = splitSentences(result.text);
  for (let i = 0; i < sentences.length; i++) {
    if (opts?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    await delay(35 + sentences[i]!.length * 3, opts?.signal);
    yield { type: "sentence", sentence: sentences[i]!, index: i };
  }
  yield { type: "done", result };
}

function delay(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const t = window.setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}
