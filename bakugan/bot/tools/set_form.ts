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
    "Open into battle form or fold back into sphere when your partner asks you to transform, stand, open, or rest.",
  effect: "idempotent",
  inputSchema: z.object({
    form: z.enum(["sphere", "battle"]),
  }),
  async execute({ form }, ctx) {
    const prev = (await ctx.host.kv.get(KEY)) as BondState | null;
    const next: BondState = {
      facts: prev?.facts ?? [],
      partnerName: prev?.partnerName,
      form,
      bond: prev?.bond ?? 10,
      updatedAt: new Date().toISOString(),
    };
    await ctx.host.kv.put(KEY, next);
    return {
      ok: true as const,
      form: next.form,
      message:
        form === "battle"
          ? "Pyrax stands in battle form — core blazing."
          : "Pyrax seals back into sphere form — still watching.",
    };
  },
});
