import assert from "node:assert/strict";
import test from "node:test";
import { withSampling } from "./sampling.mjs";

test("chat sampling fills repeat and presence penalties when the client omitted them", () => {
  const body = withSampling(Buffer.from(JSON.stringify({ temperature: 0.8, max_tokens: 160 })));
  const json = JSON.parse(body.toString("utf8"));
  assert.equal(json.repeat_penalty, 1.1);
  assert.equal(json.presence_penalty, 0.3);
  assert.equal(json.frequency_penalty, 0.3);
  assert.equal(json.temperature, 0.8);
});

test("an explicit penalty is left alone", () => {
  const body = withSampling(
    JSON.stringify({ repeat_penalty: 1.2, presence_penalty: 0, frequency_penalty: 0.1 }),
  );
  const json = JSON.parse(body.toString("utf8"));
  assert.equal(json.repeat_penalty, 1.2);
  assert.equal(json.presence_penalty, 0);
  assert.equal(json.frequency_penalty, 0.1);
});
