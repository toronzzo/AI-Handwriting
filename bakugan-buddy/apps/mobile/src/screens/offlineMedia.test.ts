/// <reference types="node" />
import assert from "node:assert/strict";
import test from "node:test";
import { loadAuthedMediaUrl } from "./offlineMedia.ts";

test("an offline picture is fetched with the caller's fetch and shown as a local url", async () => {
  const created: unknown[] = [];
  const original = URL.createObjectURL;
  URL.createObjectURL = ((blob: Blob) => {
    created.push(blob);
    return "blob:mars";
  }) as typeof URL.createObjectURL;
  let seen = "";
  try {
    const loaded = await loadAuthedMediaUrl("http://127.0.0.1:8788/v1/offline/image?path=%2FI%2Fmars.jpg", async (input) => {
      seen = String(input);
      return new Response(Uint8Array.from([1, 2, 3]), { status: 200, headers: { "content-type": "image/jpeg" } });
    });
    assert.equal(seen, "http://127.0.0.1:8788/v1/offline/image?path=%2FI%2Fmars.jpg");
    assert.ok(!seen.includes("token="), "the long-lived pairing token stays in the header, not the url");
    assert.equal(loaded?.url, "blob:mars");
    assert.equal(created.length, 1);
  } finally {
    URL.createObjectURL = original;
  }
});

test("a 401 from the brain does not invent an image url", async () => {
  const loaded = await loadAuthedMediaUrl("http://brain/v1/offline/image?path=%2Fx", async () => new Response("no", { status: 401 }));
  assert.equal(loaded, null);
});
