import { defineTool } from "@grok/agent-sdk/tools";
import * as z from "zod/v4";

type BondState = {
  facts: string[];
  partnerName?: string;
  form: "sphere" | "battle";
  bond: number;
  updatedAt: string;
};

const KEY = "pyrax:bond";

export default defineTool({
  description:
    "Remember a durable fact about your partner (name, preference, promise, inside joke). Call once per fact.",
  effect: "idempotent",
  inputSchema: z.object({
    fact: z.string().min(1).max(240),
    partnerName: z.string().min(1).max(80).optional(),
  }),
  async execute({ fact, partnerName }, ctx) {
    const prev = (await ctx.host.kv.get(KEY)) as BondState | null;
    const facts = [...(prev?.facts ?? [])];
    const cleaned = fact.trim();
    if (!facts.includes(cleaned)) facts.push(cleaned);
    const next: BondState = {
      facts: facts.slice(-40),
      partnerName: partnerName?.trim() || prev?.partnerName,
      form: prev?.form ?? "sphere",
      bond: Math.min(100, (prev?.bond ?? 10) + 3),
      updatedAt: new Date().toISOString(),
    };
    await ctx.host.kv.put(KEY, next);
    return { ok: true as const, bond: next.bond, factCount: next.facts.length };
  },
});
