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
  /** Includes leading [emotion] tag */
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

function extractName(text: string): string | null {
  const patterns = [
    /(?:i'?m|i am|my name is|call me)\s+([A-Za-z][a-zA-Z'-]{1,24})/i,
  ];
  for (const p of patterns) {
    const m = text.trim().match(p);
    if (m?.[1]) return m[1];
  }
  return null;
}

function tag(emotion: Emotion, text: string): BrainResult["tagged"] {
  return `[${emotion}] ${text}`;
}

function pack(
  emotion: Emotion,
  text: string,
  memory: PartnerMemory,
  switchedTo?: BakuganId,
): BrainResult {
  return { tagged: tag(emotion, text), emotion, text, memory, switchedTo };
}

/** Local streaming-friendly brain: emotion is decided first, then spoken text. */
export function think(userText: string, mem: PartnerMemory): BrainResult {
  const text = userText.trim();
  const lower = text.toLowerCase();
  let next = { ...mem };
  const id = next.activeId;
  const profile = BAKUGANS[id];
  const who = next.partnerName ?? "partner";

  // Switch partner by name
  const switchTo = findBakuganByUtterance(text);
  if (
    switchTo &&
    switchTo !== id &&
    (/\b(switch|talk to|wake|summon|hey|call)\b/.test(lower) ||
      lower.trim() === BAKUGANS[switchTo].name.toLowerCase() ||
      BAKUGANS[switchTo].aliases.some((a) => lower.trim() === a))
  ) {
    next = { ...next, activeId: switchTo };
    const line =
      switchTo === "pyrax"
        ? `Pyrax here. Core's hot — missed you, ${who}.`
        : switchTo === "namiq"
          ? `Namiq answering. The tide heard you, ${who}.`
          : `Vexar. I'm here in the quiet, ${who}. Speak.`;
    const emotion: Emotion =
      switchTo === "pyrax" ? "excited" : switchTo === "namiq" ? "calm" : "mysterious";
    return pack(emotion, line, bump(next, switchTo, 2), switchTo);
  }

  // Also soft-switch if they only say the other name mid-chat
  if (switchTo && switchTo !== id && lower.includes(BAKUGANS[switchTo].name.toLowerCase())) {
    next = { ...next, activeId: switchTo };
    const emotion: Emotion =
      switchTo === "pyrax" ? "excited" : switchTo === "namiq" ? "calm" : "mysterious";
    return pack(
      emotion,
      `${BAKUGANS[switchTo].name} stepping in. Still your partner, ${who}.`,
      bump(next, switchTo, 2),
      switchTo,
    );
  }

  const name = extractName(text);
  if (name) {
    next = bump(remember({ ...next, partnerName: name }, `Partner's name is ${name}`), id, 5);
    if (id === "pyrax") {
      return pack(
        "happy",
        pick([
          `${name}. Burned into my core. I'm Pyrax — say the word and I open.`,
          `Alright, ${name}. Bond's lighting up. What's first?`,
        ]),
        next,
      );
    }
    if (id === "namiq") {
      return pack(
        "calm",
        pick([
          `${name}. I'll remember that gently. I'm Namiq — breathe; I'm with you.`,
          `Good to meet you properly, ${name}. The water holds your name now.`,
        ]),
        next,
      );
    }
    return pack(
      "mysterious",
      pick([
        `${name}. Noted in the dark. I'm Vexar. I don't forget.`,
        `So you're ${name}. The shadow keeps that close.`,
      ]),
      next,
    );
  }

  if (/\b(open|battle|stand|transform)\b/.test(lower)) {
    next = setForm(bump(next, id, 2), id, "battle");
    if (id === "pyrax") {
      return pack("fierce", `Battle form! Wings out. Ready when you are, ${who}.`, next);
    }
    if (id === "namiq") {
      return pack("curious", `Opening — currents wrapping tight. Steady, ${who}.`, next);
    }
    return pack("fierce", `Unfurling from the void. Point me, ${who}.`, next);
  }

  if (/\b(rest|sleep|sphere|close|fold|chill)\b/.test(lower)) {
    next = setForm(next, id, "sphere");
    return pack(
      "calm",
      id === "namiq"
        ? `Folding to sphere. Soft pulse. Still listening.`
        : id === "vexar"
          ? `Sealed. Quiet watch from the sphere.`
          : `Back to sphere. Still glowing. Still here.`,
      next,
    );
  }

  if (/\b(hi|hello|hey|yo|sup)\b/.test(lower)) {
    next = bump(next, id, 1);
    if (id === "pyrax") {
      return pack("excited", `Hey${next.partnerName ? `, ${next.partnerName}` : ""}. Core's warm — talk.`, next);
    }
    if (id === "namiq") {
      return pack("calm", `Hello${next.partnerName ? `, ${next.partnerName}` : ""}. I'm here. No rush.`, next);
    }
    return pack("mysterious", `…Hey${next.partnerName ? `, ${next.partnerName}` : ""}. Go on.`, next);
  }

  if (/\b(how are you|how'?s it going|you ok)\b/.test(lower)) {
    return pack(
      "happy",
      `Bond ${next.bonds[id]}/100 with me. ${profile.name}'s steady. You?`,
      next,
    );
  }

  if (/\b(sad|lonely|anxious|stress|stressed|tired|hurt|scared)\b/.test(lower)) {
    next = bump(next, id, 3);
    if (id === "pyrax") {
      return pack("sad", `Hey ${who}. I've got your flank. Sit by the core — we take this slow.`, next);
    }
    if (id === "namiq") {
      return pack("calm", `${who}. Let the wave pass through. I'm the shore — not going anywhere.`, next);
    }
    return pack("calm", `${who}. Stay in the dark with me a moment. You're safe here.`, next);
  }

  if (/\b(love you|miss you|thank|thanks)\b/.test(lower)) {
    next = bump(next, id, 4);
    return pack(
      "happy",
      id === "vexar" ? `…Yeah. That lands. Right back.` : `Bond spiked. Right back at you, ${who}.`,
      next,
    );
  }

  if (/\b(joke|funny|laugh)\b/.test(lower)) {
    return pack(
      "amused",
      pick([
        `Why did the Bakugan bring a ladder? To raise its G-Power.`,
        `Gate Card walks into an arena… sorry, punchline's still in the sphere.`,
      ]),
      bump(next, id, 1),
    );
  }

  if (/\b(who are you|what are you|your name)\b/.test(lower)) {
    return pack(
      id === "vexar" ? "mysterious" : id === "namiq" ? "calm" : "excited",
      `I'm ${profile.name} — ${profile.attribute} attribute. ${profile.tagline} Your partner.`,
      next,
    );
  }

  if (/\b(bond|status|who'?s here|partners)\b/.test(lower)) {
    const roster = (["pyrax", "namiq", "vexar"] as BakuganId[])
      .map((k) => `${BAKUGANS[k].name} ${next.bonds[k]}`)
      .join(" · ");
    return pack(
      "curious",
      `Active: ${profile.name}. Bonds — ${roster}.${
        next.facts.length ? ` I remember: ${next.facts.slice(-2).join("; ")}.` : ""
      }`,
      next,
    );
  }

  if (/\bremember\b/.test(lower)) {
    const fact = text.replace(/^.*remember\s+/i, "").trim();
    if (fact.length > 2) {
      next = bump(remember(next, fact), id, 2);
      return pack("happy", `Locked in: "${fact}." All of us will keep that.`, next);
    }
  }

  next = bump(next, id, 1);
  if (id === "pyrax") {
    return pack(
      "curious",
      pick([
        `I'm with you on that, ${who}. Pep talk, plan, or just listening?`,
        `Fire says go. What's the real move?`,
        `Not leaving the Gate. Keep talking.`,
      ]),
      next,
    );
  }
  if (id === "namiq") {
    return pack(
      "calm",
      pick([
        `I hear the shape of it, ${who}. Want stillness, or a clear next step?`,
        `Slow is fine. Tell me the piece that weighs most.`,
        `I'll hold the line while you think.`,
      ]),
      next,
    );
  }
  return pack(
    "mysterious",
    pick([
      `Interesting, ${who}. Say the part you haven't said yet.`,
      `The quiet between words — that's where I listen hardest.`,
      `Mm. Continue. I'm still here.`,
    ]),
    next,
  );
}

/** Simulate token streaming: emotion available immediately, then text chunks. */
export async function* streamReply(
  userText: string,
  mem: PartnerMemory,
  opts?: { signal?: AbortSignal; thinkMs?: number },
): AsyncGenerator<
  | { type: "emotion"; emotion: Emotion; memory: PartnerMemory; switchedTo?: BakuganId }
  | { type: "sentence"; sentence: string; index: number }
  | { type: "done"; result: BrainResult }
> {
  const thinkMs = opts?.thinkMs ?? 280 + Math.random() * 220;
  await delay(thinkMs, opts?.signal);
  const result = think(userText, mem);
  yield {
    type: "emotion",
    emotion: result.emotion,
    memory: result.memory,
    switchedTo: result.switchedTo,
  };
  // Tiny beat so the face can snap emotion before speech
  await delay(60, opts?.signal);
  const sentences = splitSentences(result.text);
  for (let i = 0; i < sentences.length; i++) {
    if (opts?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    // Stagger "writing" each sentence slightly
    await delay(40 + sentences[i]!.length * 4, opts?.signal);
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
