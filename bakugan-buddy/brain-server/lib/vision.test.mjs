import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { authorizeRequest, QUERY_TOKEN_PATHS, requestToken } from "./pairing.mjs";
import { PREYAS_CHAT_PERSONA } from "../../packages/alive/src/persona.ts";
import {
  MAX_IMAGE_BYTES,
  VISION_NOTE,
  answerNotice,
  askVision,
  chooseVisionRoute,
  cleanLocalAnswer,
  decodeImage,
  findLocalVision,
  handleVisionHttp,
  isGeminiVision,
  isGroqVision,
  noneMessage,
  previewNotice,
  visionStatus,
} from "./vision.mjs";

const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const PERSONA = "You are Preyas, the test coach. [[ASK_PAID]]";

function pngBytes() {
  return Buffer.from(PNG_B64, "base64");
}

function touch(dir, name) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.writeFileSync(file, "x");
  return file;
}

function runtime(discovery, extra = {}) {
  return {
    discovery,
    gatewayUrl: "http://127.0.0.1:4000",
    timeoutMs: extra.timeoutMs || 5_000,
    personaText: () => PERSONA,
    fetchImpl: extra.fetchImpl,
    spawnImpl: extra.spawnImpl,
  };
}

function cloudFetch(content, { status = 200, throwError = null } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, body: init?.body ? JSON.parse(init.body) : null });
    if (throwError) throw throwError;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => ({ choices: [{ message: { content } }] }),
    };
  };
  return { calls, fetchImpl };
}

function childProcess(stdout, { code = 0, stderr = "", hang = false } = {}) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killed = false;
  child.kill = () => {
    child.killed = true;
    child.emit("close", null);
  };
  if (!hang) {
    queueMicrotask(() => {
      if (stdout) child.stdout.emit("data", Buffer.from(stdout));
      if (stderr) child.stderr.emit("data", Buffer.from(stderr));
      child.emit("close", code);
    });
  }
  return child;
}

function localSpawn(stdout, options = {}) {
  const calls = [];
  const spawnImpl = (bin, args) => {
    const imagePath = args[args.indexOf("--image") + 1];
    assert.equal(fs.existsSync(imagePath), true, "the picture exists only while the local model runs");
    calls.push({ bin, args, imagePath });
    return childProcess(stdout, options);
  };
  return { calls, spawnImpl };
}

function groqDiscovery(local = null) {
  return { models: ["local", "groq-vision", "paid"], local, localFiles: Boolean(local), localBinFound: Boolean(local) };
}

test("vision routes keep the pairing token in the header", () => {
  assert.equal(QUERY_TOKEN_PATHS.has("/v1/vision"), false);
  assert.equal(QUERY_TOKEN_PATHS.has("/v1/vision/ask"), false);
  assert.equal(
    requestToken({ path: "/v1/vision/ask", method: "POST", queryToken: "tok_abcdefghijklmnop" }),
    "",
  );
  const denied = authorizeRequest({
    path: "/v1/vision/ask",
    method: "POST",
    token: "",
    remoteAddress: "127.0.0.1",
    book: { devices: [] },
  });
  assert.equal(denied.allow, false);
  assert.equal(denied.status, 401);
  const allowed = authorizeRequest({
    path: "/v1/vision",
    method: "GET",
    token: "tok_abcdefghijklmnop",
    remoteAddress: "127.0.0.1",
    book: { devices: [{ token: "tok_abcdefghijklmnop", name: "Mac", pairedAt: 1, lastSeen: 1 }] },
  });
  assert.equal(allowed.allow, true);
});

test("decodeImage accepts a png data URL and rejects text and huge pictures", () => {
  const decoded = decodeImage(`data:image/png;base64,${PNG_B64}`);
  assert.equal(decoded.mime, "image/png");
  assert.equal(decoded.bytes[0], 0x89);
  assert.throws(() => decodeImage(Buffer.from("hello").toString("base64")), /PNG, JPEG/);
  assert.throws(() => decodeImage(""), /Attach a picture/);
  const big = Buffer.alloc(MAX_IMAGE_BYTES + 1, 7);
  big[0] = 0xff;
  big[1] = 0xd8;
  big[2] = 0xff;
  assert.throws(() => decodeImage(big.toString("base64")), /too large/);
});

test("Groq is preferred over Gemini, and the text models are not vision models", () => {
  assert.equal(isGroqVision("groq-vision"), true);
  assert.equal(isGroqVision("meta-llama/llama-4-scout-17b-16e-instruct"), true);
  assert.equal(isGroqVision("llama-3.1-8b-instant"), false);
  assert.equal(isGeminiVision("gemini-flash"), true);
  assert.equal(isGeminiVision("gemini-2.5-flash"), true);
  assert.equal(isGeminiVision("gemini-embedding-001"), false);
  assert.equal(isGroqVision("deepseek-v4-flash-vision-exp"), false);
  assert.equal(isGeminiVision("deepseek-v4-flash"), false);
  const both = chooseVisionRoute({ models: ["gemini-flash", "groq-vision", "deepseek-v4-flash"], local: null }, "auto");
  assert.equal(both.route, "groq");
  assert.equal(both.model, "groq-vision");
  const gemini = chooseVisionRoute({ models: ["paid", "gemini-flash"], local: null }, "auto");
  assert.equal(gemini.route, "gemini");
  const forced = chooseVisionRoute({ models: ["groq-vision", "gemini-flash"], local: { model: "m", mmproj: "p", bin: "b" } }, "gemini");
  assert.equal(forced.route, "gemini");
  const onlyDeepseek = chooseVisionRoute({ models: ["deepseek-v4-flash-vision-exp", "local"], local: null }, "auto");
  assert.equal(onlyDeepseek.route, "none");
});

test("a cloud answer goes to the gateway, keeps Preyas's persona, and says the picture left the Mac", async () => {
  const cloud = cloudFetch("Tap the blue Export button.");
  const spawn = localSpawn("should not run");
  const result = await askVision(
    {
      question: "how do I do this in iGrafx?",
      image: PNG_B64,
      history: [
        { role: "user", content: "what app is this?" },
        { role: "assistant", content: "iGrafx." },
        { role: "user", content: [{ type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } }] },
      ],
    },
    runtime(groqDiscovery(), { fetchImpl: cloud.fetchImpl, spawnImpl: spawn.spawnImpl }),
  );
  assert.equal(result.status, 200);
  assert.equal(result.body.answer, "Tap the blue Export button.");
  assert.equal(result.body.route, "groq");
  assert.equal(result.body.leavesMac, true);
  assert.equal(result.body.notice, answerNotice("groq"));
  assert.match(result.body.notice, /left this Mac/);
  assert.equal(spawn.calls.length, 0);
  assert.equal(cloud.calls.length, 1);
  assert.equal(cloud.calls[0].url, "http://127.0.0.1:4000/v1/chat/completions");
  assert.equal(cloud.calls[0].url.includes("8790"), false);
  const body = cloud.calls[0].body;
  assert.equal(body.model, "groq-vision");
  assert.equal(body.cache["no-store"], true);
  assert.match(body.messages[0].content, /You are Preyas, the test coach/);
  assert.match(body.messages[0].content, /\[\[ASK_PAID\]\]/);
  assert.ok(body.messages[0].content.includes(VISION_NOTE));
  assert.equal(body.messages[0].content.includes(PNG_B64), false);
  assert.equal(body.messages[1].content, "what app is this?");
  assert.equal(body.messages[2].content, "iGrafx.");
  const picture = body.messages[3].content.find((part) => part.type === "image_url");
  assert.match(picture.image_url.url, /^data:image\/png;base64,/);
  assert.equal(body.messages[3].content.filter((part) => part.type === "image_url").length, 1);
});

test("Gemini is used when Groq is absent, and prefer local never calls the gateway", async () => {
  const cloud = cloudFetch("A column of numbers.");
  const gemini = await askVision(
    { question: "what's your opinion?", image: PNG_B64 },
    runtime({ models: ["gemini-flash"], local: null, localFiles: false, localBinFound: false }, { fetchImpl: cloud.fetchImpl }),
  );
  assert.equal(gemini.body.route, "gemini");
  assert.equal(gemini.body.leavesMac, true);
  assert.match(gemini.body.notice, /Gemini/);
  assert.match(gemini.body.notice, /left this Mac/);

  const local = {
    model: "/models/vision/moondream.gguf",
    mmproj: "/models/vision/moondream-mmproj.gguf",
    bin: "/bin/llama-mtmd-cli",
  };
  const spawn = localSpawn("It is a sum.\n");
  const kept = await askVision(
    { question: "solve this", image: PNG_B64, prefer: "local" },
    runtime(groqDiscovery(local), { fetchImpl: cloud.fetchImpl, spawnImpl: spawn.spawnImpl }),
  );
  assert.equal(kept.body.route, "local");
  assert.equal(kept.body.leavesMac, false);
  assert.match(kept.body.notice, /stayed on this Mac/);
  assert.equal(spawn.calls.length, 1);
  assert.equal(cloud.calls.length, 1, "only the Gemini call above; prefer local adds none");
  const prompt = spawn.calls[0].args[spawn.calls[0].args.indexOf("-p") + 1];
  assert.match(prompt, /You are Preyas, the test coach/);
  assert.match(prompt, /solve this/);
  assert.equal(prompt.includes(PNG_B64), false);
  assert.equal(spawn.calls[0].args.includes(local.mmproj), true);
  assert.equal(fs.existsSync(spawn.calls[0].imagePath), false);
});

test("no vision model returns a clear message and does not call anyone", async () => {
  const cloud = cloudFetch("nope");
  const spawn = localSpawn("nope");
  const discovery = { models: ["local", "paid"], local: null, localFiles: false, localBinFound: false };
  const result = await askVision(
    { question: "what is this?", image: PNG_B64 },
    runtime(discovery, { fetchImpl: cloud.fetchImpl, spawnImpl: spawn.spawnImpl }),
  );
  assert.equal(result.status, 503);
  assert.equal(result.body.error, "no_vision_model");
  assert.equal(result.body.leavesMac, false);
  assert.match(result.body.message, /No vision model is configured/);
  assert.match(result.body.message, /stayed on this Mac/);
  assert.equal(result.body.message, noneMessage(discovery, "none"));
  assert.equal(cloud.calls.length, 0);
  assert.equal(spawn.calls.length, 0);
});

test("a gateway HTTP error does not fall back, and a refused connection does", async () => {
  const local = { model: "/models/vision/moondream.gguf", mmproj: "/models/vision/mmproj.gguf", bin: "/bin/llama-mtmd-cli" };
  const http = cloudFetch("secret-provider-error-body", { status: 500 });
  const spawn = localSpawn("local answer");
  const failed = await askVision(
    { question: "what is this?", image: PNG_B64 },
    runtime(groqDiscovery(local), { fetchImpl: http.fetchImpl, spawnImpl: spawn.spawnImpl }),
  );
  assert.equal(failed.status, 502);
  assert.equal(failed.body.leavesMac, true);
  assert.match(failed.body.message, /left this Mac/);
  assert.equal(failed.body.message.includes("secret-provider-error-body"), false);
  assert.equal(spawn.calls.length, 0);

  const down = cloudFetch("", {
    throwError: Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } }),
  });
  const fallback = localSpawn("<think>scratch</think>\nAdd the two numbers.\n");
  const saved = await askVision(
    { question: "calculate this", image: PNG_B64 },
    runtime(groqDiscovery(local), { fetchImpl: down.fetchImpl, spawnImpl: fallback.spawnImpl }),
  );
  assert.equal(saved.status, 200);
  assert.equal(saved.body.route, "local");
  assert.equal(saved.body.fellBack, true);
  assert.equal(saved.body.leavesMac, false);
  assert.equal(saved.body.answer, "Add the two numbers.");
  assert.match(saved.body.notice, /stayed on this Mac/);

  const timed = cloudFetch("", { throwError: Object.assign(new Error("slow"), { name: "TimeoutError" }) });
  const noSpawn = localSpawn("no");
  const timeout = await askVision(
    { question: "what is this?", image: PNG_B64 },
    runtime(groqDiscovery(local), { fetchImpl: timed.fetchImpl, spawnImpl: noSpawn.spawnImpl }),
  );
  assert.equal(timeout.status, 502);
  assert.equal(timeout.body.leavesMac, true);
  assert.match(timeout.body.message, /may have left this Mac/);
  assert.equal(noSpawn.calls.length, 0);
});

test("the text Qwen file is not the local vision model; a small GGUF plus mmproj is", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "preyas-vision-scan-"));
  try {
    const models = path.join(root, "models");
    touch(models, "Huihui-Qwen3-8B-abliterated-v2.Q4_K_M.gguf");
    touch(models, "mmproj-qwen3.gguf");
    const bin = touch(root, "llama-mtmd-cli");
    const pathExists = (file) => String(file).startsWith(root) && fs.existsSync(file);
    const skipped = findLocalVision({
      dirs: [models],
      env: { LLAMA_BIN: path.join(root, "llama-server"), PATH: "" },
      pathExists,
    });
    assert.equal(skipped.local, null);
    assert.equal(skipped.localFiles, false);

    const vision = path.join(models, "vision");
    touch(vision, "moondream2.gguf");
    touch(vision, "moondream2-mmproj.gguf");
    touch(models, "llama-server");
    const found = findLocalVision({
      dirs: [models, vision],
      env: { LLAMA_BIN: path.join(models, "llama-server"), PATH: "" },
      pathExists,
    });
    assert.equal(found.localBinFound, false);

    touch(models, "llama-mtmd-cli");
    const ready = findLocalVision({
      dirs: [vision],
      env: { LLAMA_BIN: path.join(models, "llama-server"), PATH: "" },
      pathExists,
    });
    assert.equal(path.basename(ready.local.model), "moondream2.gguf");
    assert.match(path.basename(ready.local.mmproj), /mmproj/);
    assert.equal(path.basename(ready.local.bin), "llama-mtmd-cli");

    const text = touch(models, "Huihui-Qwen3-8B.gguf");
    const proj = touch(models, "mmproj-unused.gguf");
    const forced = findLocalVision({
      dirs: [],
      env: { PREYAS_VISION_GGUF: text, PREYAS_VISION_MMPROJ: proj, PREYAS_VISION_BIN: bin, PATH: "" },
      pathExists,
    });
    assert.equal(forced.local, null, "an explicit path at the text model is still not a vision model");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("files without llama-mtmd-cli say what is missing", async () => {
  const discovery = {
    models: [],
    local: null,
    localFiles: true,
    localBinFound: false,
  };
  const status = await visionStatus(runtime(discovery));
  assert.equal(status.body.route, "none");
  assert.equal(status.body.leavesMac, false);
  assert.match(status.body.notice, /llama-mtmd-cli/);
  assert.match(status.body.notice, /stayed on this Mac/);
  assert.equal(previewNotice("groq").includes("will leave this Mac"), true);
  assert.equal(previewNotice("local").includes("will stay on this Mac"), true);
});

test("cleanLocalAnswer drops think tags and llama.cpp logs", () => {
  const text = cleanLocalAnswer("llama_model_load: ok\n<think>hidden</think>\nPress Save.\n");
  assert.equal(text, "Press Save.");
});

test("GET /v1/vision and POST /v1/vision/ask answer through the route handler", async () => {
  const discovery = groqDiscovery();
  const cloud = cloudFetch("One next step: open File.");
  const visionRuntime = runtime(discovery, { fetchImpl: cloud.fetchImpl, spawnImpl: localSpawn("no").spawnImpl });
  const status = await handleVisionHttp({ method: "GET", pathname: "/v1/vision", runtime: visionRuntime });
  assert.equal(status.status, 200);
  assert.equal(status.body.route, "groq");
  assert.equal(status.body.leavesMac, true);
  assert.match(status.body.notice, /will leave this Mac/);

  const ask = await handleVisionHttp({
    method: "POST",
    pathname: "/v1/vision/ask",
    rawBody: Buffer.from(JSON.stringify({ question: "how do I do this?", image: PNG_B64 })),
    runtime: visionRuntime,
  });
  assert.equal(ask.status, 200);
  assert.equal(ask.body.answer, "One next step: open File.");
  assert.equal(ask.body.leavesMac, true);
  assert.match(cloud.calls[0].body.messages[0].content, /You are Preyas/);

  const bad = await handleVisionHttp({
    method: "POST",
    pathname: "/v1/vision/ask",
    rawBody: Buffer.from("{"),
    runtime: visionRuntime,
  });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, "bad_json");

  const empty = await handleVisionHttp({
    method: "POST",
    pathname: "/v1/vision/ask",
    rawBody: Buffer.from(JSON.stringify({ question: "  ", image: PNG_B64 })),
    runtime: visionRuntime,
  });
  assert.equal(empty.status, 400);
  assert.equal(empty.body.leavesMac, false);
  assert.match(empty.body.notice, /stayed on this Mac/);
  assert.equal(await handleVisionHttp({ method: "GET", pathname: "/v1/other", runtime: visionRuntime }), null);
});

test("the repo persona is the default voice when a runtime has none", () => {
  assert.match(PREYAS_CHAT_PERSONA, /You are Preyas/);
  assert.match(PREYAS_CHAT_PERSONA, /\[\[ASK_PAID\]\]/);
});
