/// <reference types="node" />
import assert from "node:assert/strict";
import test from "node:test";
import { errorDetail, PAIR_HINT, probeBodyError, probeResponseError, probeThrownError } from "./probe.ts";

function named(name: string, message = ""): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}

test("only a real abort is called a timeout", () => {
  assert.equal(probeThrownError("Status", named("TimeoutError")), "Status timed out. Is Preyas running?");
  assert.equal(probeThrownError("Model status", named("AbortError")), "Model status timed out. Is Preyas running?");
});

test("an unreachable Mac is not called a timeout", () => {
  const network = named("TypeError", "Failed to fetch");
  assert.equal(probeThrownError("Status", network), "Status could not reach the Mac. Is Preyas running?");
});

test("any other failure shows its own reason", () => {
  assert.equal(probeThrownError("Status", named("SyntaxError", "Unexpected token <")), "Status failed: Unexpected token <");
  assert.equal(probeThrownError("Status", "odd"), "Status could not reach the Mac. Is Preyas running?");
});

test("a refused request shows the status, and pairing when it is auth", () => {
  assert.equal(probeResponseError("Status", 401, { error: "pair this device" }), PAIR_HINT);
  assert.equal(probeResponseError("Status", 429, null), PAIR_HINT);
  assert.equal(probeResponseError("Status", 500, { error: "drive missing" }), "Status answered 500: drive missing");
  assert.equal(probeResponseError("Model status", 404, {}), "Model status answered 404.");
  assert.equal(probeResponseError("Vault", 503, "nope"), "Vault answered 503.");
});

test("the error line is read only when it is a real string", () => {
  assert.equal(errorDetail({ error: "  boom  " }), "boom");
  assert.equal(errorDetail({ error: 42 }), "");
  assert.equal(errorDetail(null), "");
  assert.equal(errorDetail("text"), "");
  assert.equal(errorDetail({ error: "x".repeat(300) }).length, 120);
});

test("a non-JSON 200 names the status instead of pretending success", () => {
  assert.equal(probeBodyError("Status", 200), "Status answered 200 but the answer was not JSON.");
});
