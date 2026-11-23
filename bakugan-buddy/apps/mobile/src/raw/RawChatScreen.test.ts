/// <reference types="node" />
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

/**
 * The screen is a TSX file, and the repo's node test runner only strips
 * types, so the rendering contract is checked against the source: the same
 * approach pages.test.ts and noLooseColours.test.ts use for JSX wiring.
 */
const file = join(process.cwd(), "src/raw/RawChatScreen.tsx");
const screen = readFileSync(file, "utf8");

test("RawChatScreen renders the llama.cpp-style parts from the brief", () => {
  assert.match(screen, /export function RawChatScreen/);
  assert.match(screen, /testID="raw-chat-list"/, "conversation list");
  assert.match(screen, /testID="raw-chat-input"/, "composer");
  assert.match(screen, /testID="raw-chat-send"/, "send button");
  assert.match(screen, /testID="raw-chat-stop"/, "stop button");
  assert.match(screen, /accessibilityLabel="Stop reply"/);
  assert.match(screen, /testID="raw-chat-settings-panel"/, "settings panel");
  assert.match(screen, /testID="raw-chat-list-toggle"/, "phone chat-list toggle");
  assert.match(screen, /function MessageBubble/, "message bubbles");
  assert.match(screen, /formatRawStats\(message\.stats\)/, "stats under replies");
  assert.match(screen, /thinkingOpen \? "Hide" : "Show"/, "collapsible thinking block");
  assert.match(screen, /message.reasoning/, "reasoning is shown live");
  assert.match(screen, /Thinking…/, "live thinking label");
});

test("the settings panel owns the four requested controls", () => {
  for (const label of ["Temperature", "Top P", "Max tokens", "System prompt"]) {
    assert.match(screen, new RegExp(label.replace(" ", "\\s")), label + " is in the panel");
  }
  assert.match(screen, /normalizeRawSettings\(/, "settings are sanitized before use");
  assert.match(screen, /saveRawSettings\(/, "settings are remembered");
});

test("the screen adapts to phone width and reads theme tokens", () => {
  assert.match(screen, /useWindowDimensions\(\)/);
  assert.match(screen, /const wide = width >= 760/);
  assert.match(screen, /wide \? styles\.listWide : styles\.listOverlay/);
  assert.match(screen, /theme\.(bg|card|text|dim|accent|accentSoft|onAccent)/);
});

test("raw chats are local-only and never call Preyas memory routes", () => {
  assert.match(screen, /loadRawChats\(AsyncStorage\)/);
  assert.match(screen, /saveRawChats\(AsyncStorage/);
  assert.match(screen, /loadRawSettings\(AsyncStorage\)/);
  assert.match(screen, /saveRawSettings\(AsyncStorage/);
  assert.match(screen, /"\/v1\/raw\/chat"/);
  assert.equal(/\/v1\/(memory|facts|chats)/.test(screen), false, "no Memory route in the screen");
  assert.match(screen, /no Memory writes/);
});

test("Settings → Advanced links to Raw Qwen and App mounts it", () => {
  const chat = readFileSync(join(process.cwd(), "src/screens/ChatScreen.tsx"), "utf8");
  assert.match(chat, /go\("raw"\)/);
  assert.match(chat, />Raw Qwen</);
  const app = readFileSync(join(process.cwd(), "App.tsx"), "utf8");
  assert.match(app, /advanced === "raw"/);
  assert.match(app, /<RawChatScreen \/>/);
});

test("the llama.cpp MIT notice is kept beside the screen", () => {
  const notice = readFileSync(join(process.cwd(), "src/raw/RAW_QWEN_LICENSE.md"), "utf8");
  assert.match(notice, /llama\.cpp/);
  assert.match(notice, /MIT License/);
  assert.match(notice, /The ggml authors/);
});
