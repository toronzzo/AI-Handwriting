/**
 * Preyas's MCP hub: starts the filesystem, terminal and Playwright MCP
 * servers from <dataDir>/mcp/servers.json, lists their tools and converts
 * them to OpenAI tool-call format. Tool names are namespaced with the server
 * name so the guard (guardRules.mjs) can classify every call:
 *
 *   files_*   -> @modelcontextprotocol/server-filesystem
 *   shell_*   -> lib/os/terminalServer.mjs (our tiny terminal server)
 *   browser_* -> @playwright/mcp (official Playwright MCP server)
 *
 * Memory rules (16 GB Mac): the Playwright server is started ONLY when a
 * browser tool is first used, and it is stopped after 5 minutes without a
 * browser call. Its tool schemas are static (browserTools.mjs, pinned to the
 * installed @playwright/mcp version) so listing tools never starts it.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveSafePath, SAFE_ROOT } from "../safeFs.mjs";
import { browserToolSpecs, BROWSER_TOOL_NAMES } from "./browserTools.mjs";
import { resolveNavPrivacy } from "./privateHost.mjs";
import { DEFAULT_MAX_OUTPUT, DEFAULT_TIMEOUT_MS } from "./terminalServer.mjs";

export const MCP_IDLE_MS = 5 * 60_000;
export const MCP_CONNECT_TIMEOUT_MS = 15_000;
export const MAX_TOOL_RESULT_CHARS = 4_000;

const BRAIN_DIR = fileURLToPath(new URL("../..", import.meta.url));

export const MODULES = ["files", "shell", "browser"];

/** Default config: files and shell on, browser on but lazy, roots safe. */
export function defaultMcpConfig({ repoRoot = "", dataDir = "" } = {}) {
  return {
    v: 1,
    servers: {
      files: { enabled: true, roots: [SAFE_ROOT, ...(repoRoot ? [repoRoot] : [])] },
      shell: {
        enabled: true,
        roots: [SAFE_ROOT, ...(repoRoot ? [repoRoot] : [])],
        timeoutMs: DEFAULT_TIMEOUT_MS,
        maxOutput: DEFAULT_MAX_OUTPUT,
      },
      browser: {
        enabled: true,
        idleMs: MCP_IDLE_MS,
        headless: true,
        outputDir: dataDir ? path.join(dataDir, "mcp", "shots") : path.join(os.tmpdir(), "preyas-mcp-shots"),
      },
    },
  };
}

/** A configured root may only be the Agent drive, the repo folder, or inside one of them. */
export function rootAllowed(root, allowedRoots) {
  for (const base of allowedRoots) {
    try {
      resolveSafePath(root, base);
      return true;
    } catch {
      /* try the next base */
    }
  }
  return false;
}

function pickBool(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

function pickRoots(value, allowedRoots, fallback) {
  if (!Array.isArray(value)) return fallback;
  const roots = value.filter((root) => typeof root === "string" && rootAllowed(root, allowedRoots));
  return roots.length ? roots : fallback;
}

function pickNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

/**
 * Read and validate <dataDir>/mcp/servers.json, merging it over the defaults.
 * A missing file writes the default (atomic) so the user can edit it by hand.
 * Invalid entries fall back to the default with a warning; nothing throws.
 */
export function loadMcpConfig(dataDir, { repoRoot = "", now = () => new Date() } = {}) {
  const defaults = defaultMcpConfig({ repoRoot, dataDir });
  const warnings = [];
  const file = dataDir ? path.join(dataDir, "mcp", "servers.json") : "";
  let raw = null;
  if (file) {
    try {
      if (!fs.existsSync(file)) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const body = `${JSON.stringify(defaults, null, 2)}\n`;
        const temp = `${file}.tmp`;
        fs.writeFileSync(temp, body);
        fs.renameSync(temp, file);
        return { config: defaults, warnings: [], file };
      }
      raw = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (error) {
      warnings.push(`servers.json could not be read (${error instanceof Error ? error.message : String(error)}); using defaults`);
      return { config: defaults, warnings, file };
    }
  }
  const allowedRoots = [SAFE_ROOT, ...(repoRoot ? [repoRoot] : [])];
  const servers = raw && typeof raw.servers === "object" && raw.servers !== null ? raw.servers : {};
  const config = { v: 1, servers: {} };
  for (const name of MODULES) {
    const entry = servers[name] && typeof servers[name] === "object" ? servers[name] : {};
    const fallback = defaults.servers[name];
    if (!pickBool(entry.enabled, fallback.enabled)) {
      config.servers[name] = { ...fallback, enabled: false };
      continue;
    }
    if (name === "browser") {
      config.servers[name] = {
        enabled: true,
        idleMs: pickNumber(entry.idleMs, fallback.idleMs, 30_000, 3_600_000),
        headless: pickBool(entry.headless, fallback.headless),
        outputDir: typeof entry.outputDir === "string" && entry.outputDir ? entry.outputDir : fallback.outputDir,
      };
      continue;
    }
    const roots = pickRoots(entry.roots, allowedRoots, fallback.roots);
    if (entry.roots !== undefined && roots.length !== entry.roots.length) {
      warnings.push(`server "${name}": some roots are outside /Volumes/Agent or the repo folder and were ignored`);
    }
    config.servers[name] = {
      enabled: true,
      roots,
      timeoutMs: pickNumber(entry.timeoutMs, fallback.timeoutMs, 5_000, 300_000),
      maxOutput: pickNumber(entry.maxOutput, fallback.maxOutput, 1_000, 20_000),
    };
  }
  return { config, warnings, file };
}

/** Spawn arguments for one server: always node with an argument array, no shell. */
export function spawnArgs(moduleName, serverConfig, { dataDir = "" } = {}) {
  if (moduleName === "files") {
    return {
      command: process.execPath,
      args: [path.join(BRAIN_DIR, "node_modules/@modelcontextprotocol/server-filesystem/dist/index.js"), ...serverConfig.roots],
    };
  }
  if (moduleName === "shell") {
    return {
      command: process.execPath,
      args: [
        path.join(BRAIN_DIR, "lib/os/terminalServer.mjs"),
        ...serverConfig.roots.flatMap((root) => ["--allowed-root", root]),
        "--timeout-ms",
        String(serverConfig.timeoutMs),
        "--max-output",
        String(serverConfig.maxOutput),
      ],
    };
  }
  const outputDir = serverConfig.outputDir || path.join(dataDir || os.tmpdir(), "mcp", "shots");
  return {
    command: process.execPath,
    args: [
      path.join(BRAIN_DIR, "node_modules/@playwright/mcp/cli.js"),
      "--browser",
      "chromium",
      "--headless",
      "--isolated",
      "--output-dir",
      outputDir,
      "--viewport-size",
      "1280x800",
      "--timeout-action",
      "15000",
      "--timeout-navigation",
      "60000",
    ],
  };
}

function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** The real stdio connection for one server. */
export async function stdioConnect(moduleName, serverConfig, { env = process.env, dataDir = "" } = {}) {
  const { command, args } = spawnArgs(moduleName, serverConfig, { dataDir });
  const client = new Client({ name: "preyas-mcp", version: "0.1.0" });
  const transport = new StdioClientTransport({ command, args, env, stderr: "ignore" });
  try {
    await withTimeout(client.connect(transport), MCP_CONNECT_TIMEOUT_MS, `${moduleName} server did not start in ${MCP_CONNECT_TIMEOUT_MS / 1000} s`);
  } catch (error) {
    try {
      await client.close();
    } catch {
      /* already dead */
    }
    throw error;
  }
  return {
    module: moduleName,
    listTools: async () => (await client.listTools()).tools || [],
    callTool: async (name, arguments_) => client.callTool({ name, arguments: arguments_ }),
    close: async () => {
      await client.close();
    },
  };
}

/** Flatten an MCP call result into plain text, capped for the model context. */
export function flattenToolResult(result, maxChars = MAX_TOOL_RESULT_CHARS) {
  const parts = [];
  const content = result && Array.isArray(result.content) ? result.content : [];
  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    if (part.type === "text" && typeof part.text === "string") parts.push(part.text);
    else if (part.type === "image") parts.push(`[image: ${String(part.mimeType || "image")}]`);
    else if (part.type === "resource") parts.push(`[resource: ${String(part.resource && part.resource.uri ? part.resource.uri : "")}]`);
  }
  const text = parts.join("\n").trim() || (result && result.isError ? "tool failed" : "(empty result)");
  if (result && result.isError) return `Tool error: ${text.slice(0, maxChars)}`;
  return text.slice(0, maxChars);
}

/** The page URL from a browser_snapshot result ("- Page URL: https://…"). */
export function snapshotPageUrl(snapshotText) {
  const text = String(snapshotText || "");
  const match = text.match(/- Page URL:\s*(\S+)/) || text.match(/\bPage URL:\s*(\S+)/);
  return match ? match[1].replace(/[)\].,;]+$/, "") : "";
}

/** Strip JSON-Schema-only keys so the schemas work as OpenAI parameters. */
export function toOpenAiTools(specs) {
  return specs.map((spec) => {
    const parameters = { ...(spec.parameters || {}) };
    delete parameters.$schema;
    return {
      type: "function",
      function: {
        name: String(spec.name),
        description: String(spec.description || "").slice(0, 1000),
        parameters,
      },
    };
  });
}

const PREFIX = { files: "files_", shell: "shell_", browser: "" };

/** The raw server tool name behind a namespaced tool name. */
export function splitToolName(name) {
  const text = String(name || "");
  if (text.startsWith("files_") && text.length > 6) return { module: "files", tool: text.slice(6) };
  if (text.startsWith("shell_") && text.length > 6) return { module: "shell", tool: text.slice(6) };
  // Playwright tools already carry their browser_ prefix; only curated ones pass.
  if (BROWSER_TOOL_NAMES.has(text)) return { module: "browser", tool: text };
  return null;
}

/**
 * The hub. `connect` is injectable for tests (fake servers); the default is
 * stdioConnect. `schedule`/`clearTimer` are injectable for idle-timer tests.
 */
export function createMcpHub(options = {}) {
  const {
    config,
    dataDir = "",
    env = process.env,
    connect = stdioConnect,
    schedule = (fn, ms) => setTimeout(fn, ms),
    clearTimer = (timer) => clearTimeout(timer),
    log = () => {},
    navCheck = resolveNavPrivacy,
  } = options;

  const state = new Map(); // module -> { connection, broken }
  let browserTimer = null;

  function serverConfig(moduleName) {
    return config?.servers?.[moduleName] || { enabled: false };
  }

  async function ensure(moduleName) {
    const cfg = serverConfig(moduleName);
    if (!cfg.enabled) throw new Error(`${moduleName} tools are disabled`);
    const existing = state.get(moduleName);
    if (existing && existing.connection) return existing.connection;
    if (existing && existing.starting) return existing.starting;
    const starting = (async () => {
      try {
        const connection = await connect(moduleName, cfg, { env, dataDir });
        state.set(moduleName, { connection });
        log(`mcp: ${moduleName} server started`);
        return connection;
      } catch (error) {
        state.delete(moduleName);
        const message = error instanceof Error ? error.message : String(error);
        log(`mcp: ${moduleName} server failed: ${message}`);
        throw new Error(`${moduleName} tools are not available (${message})`);
      }
    })();
    state.set(moduleName, { starting });
    try {
      return await starting;
    } finally {
      const entry = state.get(moduleName);
      if (entry && entry.starting === starting) entry.starting = null;
    }
  }

  async function stopOne(moduleName) {
    const entry = state.get(moduleName);
    if (!entry || !entry.connection) return;
    try {
      await entry.connection.close();
    } catch {
      /* closing is best effort */
    }
    state.delete(moduleName);
    log(`mcp: ${moduleName} server stopped`);
  }

  async function stopBrowser() {
    if (browserTimer) {
      clearTimer(browserTimer);
      browserTimer = null;
    }
    await stopOne("browser");
  }

  /** Reset the 5-minute idle clock after every browser call. */
  function touchBrowser() {
    if (browserTimer) clearTimer(browserTimer);
    const cfg = serverConfig("browser");
    const idleMs = Number(cfg.idleMs) || MCP_IDLE_MS;
    browserTimer = schedule(() => {
      browserTimer = null;
      void stopBrowser();
    }, idleMs);
  }

  return {
    config,

    /**
     * Tool specs for the model: live files + shell tools, static browser
     * tools. Connecting files/shell is cheap; the browser server is NOT
     * started here (lazy start).
     */
    async listTools() {
      const specs = [];
      for (const moduleName of ["files", "shell"]) {
        try {
          const connection = await ensure(moduleName);
          const tools = await connection.listTools();
          for (const tool of tools) {
            if (!tool || typeof tool.name !== "string") continue;
            specs.push({
              name: `${PREFIX[moduleName]}${tool.name}`,
              description: String(tool.description || "").replace(/\s+/g, " ").trim(),
              parameters: tool.inputSchema && typeof tool.inputSchema === "object" ? tool.inputSchema : { type: "object", properties: {} },
            });
          }
        } catch (error) {
          log(`mcp: ${moduleName} tool list failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      for (const spec of browserToolSpecs()) specs.push(spec);
      return specs.sort((left, right) => left.name.localeCompare(right.name));
    },

    /** True when the Playwright server is connected right now. */
    browserRunning() {
      const entry = state.get("browser");
      return Boolean(entry && entry.connection);
    },

    /** Run one namespaced tool; returns capped plain text. */
    async callTool(name, args) {
      const split = splitToolName(name);
      if (!split) throw new Error(`unknown tool "${name}"`);
      const cfg = serverConfig(split.module);
      if (!cfg.enabled) throw new Error(`${split.module} tools are disabled`);
      let connection;
      if (split.module === "browser") {
        connection = await ensure("browser");
        touchBrowser();
      } else {
        connection = await ensure(split.module);
      }
      const result = await connection.callTool(split.tool, args || {});
      const text = flattenToolResult(result, MAX_TOOL_RESULT_CHARS);
      // After a navigation the page may have followed redirects the
      // pre-flight could not see (a rebinding host can change its answer):
      // re-check the FINAL page URL and refuse to go on when it ended on a
      // private address. A failed navigation has no new page to check.
      if (split.module === "browser" && split.tool === "browser_navigate" && !(result && result.isError) && typeof navCheck === "function") {
        try {
          const snapshot = await connection.callTool("browser_snapshot", {});
          const finalUrl = snapshotPageUrl(flattenToolResult(snapshot, MAX_TOOL_RESULT_CHARS));
          if (finalUrl) {
            const nav = await navCheck(finalUrl).catch(() => ({ private: true, host: "unknown", address: null }));
            if (nav.private) {
              return `Blocked by the guard: the page ended on ${finalUrl} (${nav.host || "a private address"}). Stop and ask your partner before continuing.`;
            }
          }
        } catch {
          /* a snapshot failure must not block the navigation result */
        }
      }
      return text;
    },

    /** Stop the browser after an idle timeout without touching the rest. */
    async stopBrowser() {
      await stopBrowser();
    },

    async stop() {
      if (browserTimer) {
        clearTimer(browserTimer);
        browserTimer = null;
      }
      for (const moduleName of MODULES) await stopOne(moduleName);
    },
  };
}

/** A small wrapper so proxy.mjs can own one hub for the whole process. */
export function hubShutdownHook(hub) {
  if (!hub) return;
  process.once("exit", () => {
    void hub.stop();
  });
}
