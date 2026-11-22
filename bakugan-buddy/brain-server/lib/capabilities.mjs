/**
 * Preyas's honest, live capability list.
 *
 * Everything here is checked against this Mac: which MCP tool packages are
 * installed and enabled, which model files are on the drive, whether a free
 * cloud key or DeepSeek key exists, which media banks are present, and which
 * services answer right now. A capability that is not available is not listed,
 * so the chat can say "I can't do that yet" instead of pretending.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseGroqConfig } from "../../packages/alive/src/freeCloud.ts";
import { TIERS } from "./modelSwitch.mjs";
import { paidAvailability } from "./history.mjs";
import { latestChangelog, readChangelog } from "./changelog.mjs";
import { providerEnvFromSources } from "./providerHealth.mjs";

export const CAPABILITY_VERSION = 1;
/** The prompt block is meant to stay well under ~400 tokens. */
export const SUMMARY_TOKEN_BUDGET = 400;
export const SUMMARY_MAX_CHARS = 1400;

export const SERVICE_SPECS = [
  { id: "llama", label: "llama-server", port: 8790, url: "http://127.0.0.1:8790/health", mode: "ok", required: true },
  { id: "litellm", label: "LiteLLM", port: 4000, url: "http://127.0.0.1:4000/health/liveliness", mode: "ok", required: false },
  { id: "kiwix", label: "kiwix-serve", port: 8791, url: "http://127.0.0.1:8791/", mode: "any", required: false },
  { id: "brain", label: "brain-server", port: 8788, url: "http://127.0.0.1:8788/v1/health", mode: "ok", required: true },
  { id: "web", label: "Expo web", port: 8081, url: "http://127.0.0.1:8081/", mode: "preyas", required: true },
];

export const SLOT_NAMES = ["hero", "bg", "house", "car", "study", "bakugan-buddy", "studio"];
const IMAGE_EXT = /\.(?:png|jpe?g|webp)$/i;

const LOCAL_MODELS = [
  { id: "small", label: "8B local", tier: "small" },
  { id: "big", label: "14B local", tier: "big" },
  { id: "huge", label: "30B local", tier: "huge" },
  { id: "tiny", label: "Tiny 0.8B off-grid", tier: "tiny" },
];

export function estimateTokens(text) {
  return Math.max(0, Math.ceil(String(text ?? "").length / 4));
}

function exists(fsImpl, file) {
  try {
    return fsImpl.existsSync(file);
  } catch {
    return false;
  }
}

function list(fsImpl, dir) {
  try {
    return fsImpl.readdirSync(dir);
  } catch {
    return [];
  }
}

function readText(fsImpl, file) {
  try {
    return fsImpl.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function findOnPath(bin, env, pathExists) {
  for (const dir of String(env?.PATH ?? "").split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, bin);
    if (pathExists(candidate)) return candidate;
  }
  return "";
}

function browserCacheReady(env = process.env) {
  const dir =
    String(env.PLAYWRIGHT_BROWSERS_PATH || "").trim() ||
    (process.platform === "darwin"
      ? path.join(os.homedir(), "Library", "Caches", "ms-playwright")
      : path.join(os.homedir(), ".cache", "ms-playwright"));
  try {
    return fs.readdirSync(dir).some((name) => name.startsWith("chromium"));
  } catch {
    return false;
  }
}

function nowIso(now) {
  const value = typeof now === "function" ? now() : now;
  const date = value instanceof Date ? value : new Date(value ?? Date.now());
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

export async function defaultCheckService(spec, fetchImpl, timeoutMs) {
  try {
    const res = await fetchImpl(spec.url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res) return false;
    if (spec.mode === "any") return true;
    if (spec.mode === "preyas") {
      const text = typeof res.text === "function" ? await res.text() : "";
      return /preyas/i.test(text);
    }
    return Boolean(res.ok);
  } catch {
    return false;
  }
}

const FALLBACK_MCP_SERVERS = {
  files: { enabled: true },
  shell: { enabled: true },
  browser: { enabled: true },
};

/** The MCP module needs its npm packages; load it only when the brain runs. */
async function mcpConfigFor(dataDir, repoRoot, override) {
  if (override && typeof override === "object") return override;
  try {
    const mcp = await import("./os/mcp.mjs");
    return mcp.loadMcpConfig(dataDir, { repoRoot }).config;
  } catch {
    return { v: 1, servers: FALLBACK_MCP_SERVERS };
  }
}

function buildTools(options) {
  const {
    dataDir,
    repoRoot,
    env,
    pathExists,
    browserReady,
    mcpConfig,
    zimDir,
    agentRoot,
    fsImpl,
  } = options;
  const config = mcpConfig && typeof mcpConfig === "object" ? mcpConfig : { v: 1, servers: FALLBACK_MCP_SERVERS };
  const servers = config?.servers ?? {};
  const out = [];

  const filesPkg = path.join(
    repoRoot,
    "brain-server",
    "node_modules",
    "@modelcontextprotocol",
    "server-filesystem",
    "dist",
    "index.js",
  );
  const shellServer = path.join(repoRoot, "brain-server", "lib", "os", "terminalServer.mjs");
  const browserPkg = path.join(repoRoot, "brain-server", "node_modules", "@playwright", "mcp", "cli.js");

  if (servers.files?.enabled !== false && pathExists(filesPkg)) {
    out.push({ id: "files", label: "Files", detail: "read and write files on the Agent drive", kind: "tool" });
  }
  if (servers.shell?.enabled !== false && pathExists(shellServer)) {
    out.push({ id: "terminal", label: "Terminal", detail: "run one safe shell command at a time", kind: "tool" });
  }
  if (servers.browser?.enabled !== false && pathExists(browserPkg) && browserReady) {
    out.push({ id: "browser", label: "Browser", detail: "open pages, click and read the web", kind: "tool" });
  }

  let zimCount = 0;
  try {
    zimCount = list(fsImpl, zimDir).filter((name) => String(name).toLowerCase().endsWith(".zim")).length;
  } catch {
    zimCount = 0;
  }
  const kiwix =
    String(env.PREYAS_KIWIX_BIN || "").trim() ||
    path.join(agentRoot, "bin", "kiwix-serve");
  const kiwixReady = pathExists(kiwix) || Boolean(findOnPath("kiwix-serve", env, pathExists));
  if (zimCount > 0 && kiwixReady) {
    out.push({
      id: "offline_search",
      label: "Offline search",
      detail: zimCount === 1 ? "1 offline pack" : zimCount + " offline packs",
      kind: "tool",
    });
  }

  if (String(env.PREYAS_NO_WEB_SEARCH ?? "") !== "1") {
    out.push({ id: "web_search", label: "Web search", detail: "DuckDuckGo, no key needed", kind: "tool" });
  }
  return out;
}

function buildModels(options) {
  const {
    modelsDir,
    env,
    secretsText,
    currentModel,
    pathExists,
    services,
  } = options;
  const out = [];
  let current = "";
  try {
    current = String(currentModel?.() ?? "");
  } catch {
    current = "";
  }

  for (const entry of LOCAL_MODELS) {
    const tier = TIERS[entry.tier];
    const file = path.join(modelsDir, tier.file);
    if (!pathExists(file)) continue;
    out.push({
      id: entry.id,
      label: entry.label,
      kind: "model",
      current: entry.id === current,
      detail: entry.id === current ? "the model running now" : "installed on the Agent drive",
    });
  }

  const groq = parseGroqConfig(options.providerEnv || env);
  if (groq.enabled) {
    out.push({ id: "groq", label: "Groq free cloud", kind: "model", current: false, detail: "an opt-in free cloud key is on this Mac" });
  }

  const paid = paidAvailability(secretsText);
  if (paid.available) {
    const gateway = (services || []).find((service) => service.id === "litellm");
    out.push({
      id: "paid",
      label: "DeepSeek Flash paid fallback",
      kind: "model",
      current: false,
      detail: (gateway && gateway.running ? "ready" : "key found; the gateway is off") + (paid.offPeakOnly ? ", off-peak only" : ""),
    });
  }
  return out;
}

function buildMedia(options) {
  const { repoRoot, agentRoot, pathExists, fsImpl } = options;
  const out = [];
  const soundsDir = path.join(repoRoot, "apps", "mobile", "assets", "sounds");
  const sounds = list(fsImpl, soundsDir).filter((name) => String(name).toLowerCase().endsWith(".wav")).length;
  if (sounds > 0) {
    out.push({ id: "sounds", label: "Reaction sounds", kind: "media", detail: sounds + " sounds" });
  }

  const artDir = path.join(agentRoot, "art");
  let pictures = 0;
  if (pathExists(artDir)) {
    for (const slot of SLOT_NAMES) {
      if (list(fsImpl, artDir).some((name) => String(name).replace(IMAGE_EXT, "") === slot && IMAGE_EXT.test(name))) pictures += 1;
    }
  }
  if (pictures > 0) {
    out.push({ id: "images", label: "Pictures", kind: "media", detail: pictures + " of " + SLOT_NAMES.length + " picture slots" });
  }
  return out;
}

async function buildServices(options) {
  const { checkService, fetchImpl, probeTimeoutMs, now } = options;
  const services = await Promise.all(
    SERVICE_SPECS.map(async (spec) => {
      let running = false;
      try {
        running = await checkService(spec, fetchImpl, probeTimeoutMs);
      } catch {
        running = false;
      }
      return {
        id: spec.id,
        label: spec.label,
        port: spec.port,
        required: spec.required,
        running: Boolean(running),
        detail: running ? "running" : "stopped",
      };
    }),
  );
  void now;
  return services;
}

/**
 * The compact system-prompt block: only available capabilities plus the five
 * newest changelog lines. The honesty instruction sits near the top so a
 * length cut can never remove it.
 */
export function buildSummary(snapshot, maxChars = SUMMARY_MAX_CHARS) {
  const labels = (rows, markCurrent = false) =>
    (rows || [])
      .map((row) => row.label + (markCurrent && row.current ? " (running)" : ""))
      .join(", ") || "none";
  const running = (snapshot.services || []).filter((row) => row.running).map((row) => row.label).join(", ") || "none";
  const newest = latestChangelog(snapshot.changelog, 5).map((item) => "- " + item.text);
  const lines = [
    "What you can do right now:",
    'Only describe what is listed here. If something is not listed, say "I can\'t do that yet." Never invent a capability.',
    "Tools: " + labels(snapshot.tools) + ".",
    "Models: " + labels(snapshot.models, true) + ".",
    "Media: " + labels(snapshot.media) + ".",
    "Services running: " + running + ".",
  ];
  if (newest.length) lines.push("Newest changes:", ...newest);
  let text = lines.join("\n");
  if (text.length > maxChars) {
    const cut = text.slice(0, maxChars);
    const at = cut.lastIndexOf("\n");
    text = (at > 0 ? cut.slice(0, at) : cut) + "\n…";
  }
  return text;
}

/** Build the live list once at startup and refresh it when asked. */
export function createCapabilities(options = {}) {
  const {
    dataDir = "",
    repoRoot = "",
    buddyRoot = "/Volumes/Agent/BakuganBuddy",
    agentRoot = "/Volumes/Agent/agent",
    modelsDir = path.join(buddyRoot, "models"),
    zimDir = path.join(agentRoot, "knowledge", "zim"),
    changelogPath = repoRoot ? path.join(repoRoot, "CHANGELOG_PREYAS.md") : "",
    changelogItems = null,
    env = process.env,
    secretsFile = path.join(agentRoot, "secrets", ".env"),
    brainEnvFile = "",
    fsImpl = fs,
    pathExists = (file) => exists(fsImpl, file),
    fetchImpl = fetch,
    checkService = defaultCheckService,
    currentModel = () => "",
    browserReady = undefined,
    mcpConfig = null,
    probeTimeoutMs = 800,
    now = () => new Date(),
  } = options;

  let last = null;
  let inflight = null;

  async function build() {
    const secretsText = options.secretsText !== undefined ? String(options.secretsText) : readText(fsImpl, secretsFile);
    const providerTexts = [];
    if (options.brainEnvText !== undefined) providerTexts.push(String(options.brainEnvText));
    else if (brainEnvFile) providerTexts.push(readText(fsImpl, brainEnvFile));
    if (options.secretsText === undefined && dataDir) providerTexts.push(readText(fsImpl, path.join(dataDir, "secrets", ".env")));
    providerTexts.push(secretsText);
    const providerEnv = providerEnvFromSources({ processEnv: env, texts: providerTexts });
    const serviceRows = await buildServices({ checkService, fetchImpl, probeTimeoutMs, now });
    const resolvedMcp = await mcpConfigFor(dataDir, repoRoot, mcpConfig);
    const tools = buildTools({
      dataDir,
      repoRoot,
      env,
      pathExists,
      browserReady: browserReady === undefined ? browserCacheReady(env) : Boolean(browserReady),
      mcpConfig: resolvedMcp,
      zimDir,
      agentRoot,
      fsImpl,
    });
    const models = buildModels({
      modelsDir,
      env,
      providerEnv,
      secretsText,
      currentModel,
      pathExists,
      checkService,
      services: serviceRows,
    });
    const media = buildMedia({ repoRoot, agentRoot, pathExists, fsImpl });
    const items = Array.isArray(changelogItems)
      ? changelogItems
      : readChangelog(changelogPath, { fsImpl }).items;
    const snapshot = {
      v: CAPABILITY_VERSION,
      builtAt: nowIso(now),
      currentModel: (() => {
        try {
          return String(currentModel?.() ?? "");
        } catch {
          return "";
        }
      })(),
      tools,
      models,
      media,
      services: serviceRows,
      changelog: items,
      summary: "",
    };
    snapshot.summary = buildSummary(snapshot);
    return snapshot;
  }

  async function refresh() {
    if (inflight) return inflight;
    inflight = build()
      .then((snapshot) => {
        last = snapshot;
        return snapshot;
      })
      .finally(() => {
        inflight = null;
      });
    return inflight;
  }

  function snapshot() {
    return last;
  }

  return {
    refresh,
    snapshot,
    summary: () => last?.summary ?? "",
  };
}
