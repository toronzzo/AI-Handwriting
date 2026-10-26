import { defineEval } from "@grok/agent-sdk/evals";

export default defineEval({
  tags: ["smoke"],
  description: "Pyrax recalls bond state with the recall_bond tool.",
  async test(t) {
    await t.send(
      "Hey partner — check our bond with your recall tool and tell me what you remember.",
    );
    t.succeeded();
    t.calledTool("recall_bond");
  },
});
