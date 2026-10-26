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
    "Recall your bond with this partner: name, form (sphere/battle), bond level, and remembered facts.",
  effect: "read",
  inputSchema: z.object({}),
  async execute(_input, ctx) {
    const state = (await ctx.host.kv.get(KEY)) as BondState | null;
    if (!state) {
      return {
        empty: true as const,
        partnerName: null,
        form: "sphere" as const,
        bond: 0,
        facts: [] as string[],
      };
    }
    return {
      empty: false as const,
      partnerName: state.partnerName ?? null,
      form: state.form,
      bond: state.bond,
      facts: state.facts,
      updatedAt: state.updatedAt,
    };
  },
});
