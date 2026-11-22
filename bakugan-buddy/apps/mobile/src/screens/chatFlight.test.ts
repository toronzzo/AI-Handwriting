/// <reference types="node" />
import assert from "node:assert/strict";
import test from "node:test";
import { clearFlight, mergeFlightReply, peekFlight, publishFlight, subscribeFlight } from "./chatFlight.ts";

test("a reply that finishes while the chat is away is still there to show", () => {
  clearFlight("c1");
  const seen: string[] = [];
  const stop = subscribeFlight((outcome) => {
    if (outcome.chatId === "c1" && outcome.reply) seen.push(outcome.reply.content);
  });
  publishFlight({
    chatId: "c1",
    reply: { t: 10, role: "assistant", content: "Saturn is a planet." },
    error: "",
  });
  stop();
  const pending = peekFlight("c1");
  assert.equal(pending?.reply?.content, "Saturn is a planet.");
  assert.deepEqual(seen, ["Saturn is a planet."]);

  const shown = mergeFlightReply([{ t: 1, role: "user", content: "tell me about Saturn" }], pending?.reply ?? null);
  assert.equal(shown.length, 2);
  assert.equal(shown[1]?.content, "Saturn is a planet.");
  const again = mergeFlightReply(shown, pending?.reply ?? null);
  assert.equal(again.length, 2, "the same reply is not added twice");
});

test("another chat's reply is not mixed in, and an error is kept", () => {
  clearFlight("c1");
  clearFlight("c2");
  publishFlight({ chatId: "c2", reply: null, error: "Preyas didn't answer. You can ask a paid model if it's on." });
  publishFlight({ chatId: "c1", reply: { t: 2, role: "assistant", content: "hello" }, error: "" });
  assert.equal(peekFlight("c2")?.error.includes("didn't answer"), true);
  assert.equal(peekFlight("c2")?.reply, null);
  assert.equal(peekFlight("c1")?.reply?.content, "hello");
  clearFlight("c2");
  assert.equal(peekFlight("c2"), null);
});
