import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildEscalationPrompt,
  buildProposePrompt,
  createLlamaProposer,
  createLocalProposer,
  createPaidProposer,
  parseProposal,
  PROPOSER_CONTEXT_MAX,
} from "./computerPropose.mjs";

const SNAPSHOT = {
  elements: [
    { id: "e0", role: "AXButton", label: "New message", x: 10, y: 20, w: 100, h: 30 },
    { id: "e1", role: "AXTextField", label: "To:", x: 10, y: 60, w: 200, h: 24 },
    { id: "e2", role: "AXButton", label: "Send", x: 300, y: 400, w: 60, h: 30 },
  ],
};

test("the propose prompt stays under 3000 characters and names the goal and elements", () => {
  const prompt = buildProposePrompt({
    goal: "write an email to Sam",
    snapshot: SNAPSHOT,
    lastActions: ["clicked \"New message\""],
  });
  assert.ok(prompt.length <= PROPOSER_CONTEXT_MAX);
  assert.ok(prompt.includes("write an email to Sam"));
  assert.ok(prompt.includes("e0"));
  assert.ok(prompt.includes('clicked "New message"'));
});

test("a long element list is cut to fit the context cap", () => {
  const many = { elements: Array.from({ length: 80 }, (_, i) => ({ id: `e${i}`, role: "AXButton", label: `label ${i} ${"x".repeat(80)}` })) };
  const prompt = buildProposePrompt({ goal: "g", snapshot: many, lastActions: [] });
  assert.ok(prompt.length <= PROPOSER_CONTEXT_MAX);
});

test("parseProposal resolves a click element against the snapshot and takes its centre", () => {
  const parsed = parseProposal('{"action":"click","target":"e0","why":"open the composer"}', SNAPSHOT);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.proposal.action, "click");
  assert.equal(parsed.proposal.target, "e0");
  assert.equal(parsed.proposal.targetLabel, "New message");
  assert.deepEqual(parsed.proposal.center, { x: 60, y: 35 });
});

test("parseProposal handles type, key, done and ask", () => {
  assert.equal(parseProposal('{"action":"type","text":"hello","why":"x"}', SNAPSHOT).proposal.text, "hello");
  assert.equal(parseProposal('{"action":"key","combo":"cmd+c","why":"x"}', SNAPSHOT).proposal.combo, "cmd+c");
  assert.equal(parseProposal('{"action":"done","why":"x"}', SNAPSHOT).proposal.action, "done");
  assert.equal(parseProposal('{"action":"ask","why":"x"}', SNAPSHOT).proposal.action, "ask");
});

test("parseProposal refuses bad json, unknown actions, coordinates and unknown element ids", () => {
  assert.equal(parseProposal("not json", SNAPSHOT).reason, "bad_json");
  assert.equal(parseProposal('{"action":"drag"}', SNAPSHOT).reason, "unknown_action");
  assert.equal(parseProposal('{"action":"click","target":"e0","x":5,"y":5}', SNAPSHOT).reason, "coordinates");
  assert.equal(parseProposal('{"action":"click","target":"e99"}', SNAPSHOT).reason, "unknown_element");
  assert.equal(parseProposal('{"action":"click"}', SNAPSHOT).reason, "unknown_element");
  assert.equal(parseProposal("", SNAPSHOT).ok, false);
});

test("the proposer returns the parsed proposal for good json", async () => {
  const proposer = createLlamaProposer({ complete: async () => '{"action":"click","target":"e2","why":"send it"}' });
  const proposal = await proposer.propose({ goal: "send the email", snapshot: SNAPSHOT, lastActions: [] });
  assert.equal(proposal.action, "click");
  assert.equal(proposal.target, "e2");
  assert.equal(proposal.targetLabel, "Send");
});

test("bad json becomes an ask", async () => {
  const proposer = createLlamaProposer({ complete: async () => "I think you should click" });
  const proposal = await proposer.propose({ goal: "g", snapshot: SNAPSHOT, lastActions: [] });
  assert.equal(proposal.action, "ask");
  assert.equal(proposal.why, "I could not decide");
  assert.equal(proposal.reason, "bad_json");
});

test("an unknown element id is refused, not clicked", async () => {
  const proposer = createLlamaProposer({ complete: async () => '{"action":"click","target":"e99","why":"x"}' });
  const proposal = await proposer.propose({ goal: "g", snapshot: SNAPSHOT, lastActions: [] });
  assert.equal(proposal.action, "ask");
  assert.equal(proposal.reason, "unknown_element");
});

test("a timeout becomes an ask", async () => {
  const proposer = createLlamaProposer({
    timeoutMs: 10,
    complete: async () => new Promise((resolve) => setTimeout(() => resolve('{"action":"done","why":"x"}'), 200)),
  });
  const proposal = await proposer.propose({ goal: "g", snapshot: SNAPSHOT, lastActions: [] });
  assert.equal(proposal.action, "ask");
  assert.equal(proposal.reason, "timeout");
});

test("createLocalProposer asks the local llama with temperature 0 and thinking off", async () => {
  const calls = [];
  const proposer = createLocalProposer({
    llamaUrl: "http://llama.test:8790",
    fetchImpl: async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return { ok: true, json: async () => ({ choices: [{ message: { content: '{"action":"key","combo":"cmd+c","why":"copy"}' } }] }) };
    },
  });
  const proposal = await proposer.propose({ goal: "g", snapshot: SNAPSHOT, lastActions: [] });
  assert.equal(proposal.action, "key");
  assert.equal(proposal.combo, "cmd+c");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://llama.test:8790/v1/chat/completions");
  assert.equal(calls[0].body.temperature, 0);
  assert.equal(calls[0].body.chat_template_kwargs.enable_thinking, false);
  assert.equal(calls[0].body.stream, false);
});

test("createLocalProposer on a down llama becomes an ask", async () => {
  const proposer = createLocalProposer({
    llamaUrl: "http://llama.test:8790",
    fetchImpl: async () => ({ ok: false, json: async () => ({}) }),
  });
  const proposal = await proposer.propose({ goal: "g", snapshot: SNAPSHOT, lastActions: [] });
  assert.equal(proposal.action, "ask");
});

test("the escalation preview is redacted and carries no screenshot data", () => {
  const secretSnapshot = {
    elements: [
      { id: "e0", role: "AXTextField", label: "sk-abcdef1234567890", x: 0, y: 0, w: 10, h: 10 },
      { id: "e1", role: "AXButton", label: "Pay", x: 0, y: 0, w: 10, h: 10 },
    ],
  };
  const preview = buildEscalationPrompt({
    goal: "use token Bearer abc123 and pay",
    snapshot: secretSnapshot,
    lastActions: [],
  });
  assert.ok(!preview.includes("sk-abcdef1234567890"), "a token label must be redacted");
  assert.ok(!preview.includes("Bearer abc123"), "a bearer token must be redacted");
  assert.ok(preview.includes("sk-***"));
  assert.ok(!/screenshot|\.jpg|base64/i.test(preview), "no screenshot data may leave the machine");
  assert.ok(preview.length <= PROPOSER_CONTEXT_MAX);
});

test("createPaidProposer sends the same prompt to the paid gateway and returns the raw text", async () => {
  const calls = [];
  const paid = createPaidProposer({
    paidUrl: "http://gateway.test:4000",
    fetchImpl: async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return { ok: true, json: async () => ({ choices: [{ message: { content: '{"action":"ask","why":"need info"}' } }] }) };
    },
  });
  const raw = await paid({ prompt: "the exact prompt" });
  assert.equal(raw, '{"action":"ask","why":"need info"}');
  assert.equal(calls[0].url, "http://gateway.test:4000/v1/chat/completions");
  assert.equal(calls[0].body.model, "paid");
  assert.equal(calls[0].body.messages[1].content, "the exact prompt");
});

test("createPaidProposer throws when the gateway is down", async () => {
  const paid = createPaidProposer({
    paidUrl: "http://gateway.test:4000",
    fetchImpl: async () => ({ ok: false, json: async () => ({}) }),
  });
  await assert.rejects(() => paid({ prompt: "x" }));
});
