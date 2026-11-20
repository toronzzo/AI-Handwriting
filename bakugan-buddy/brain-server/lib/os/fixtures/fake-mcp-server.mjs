/**
 * A fake MCP server over stdio for tests: two tools, no side effects.
 * Spawned as `node fixtures/fake-mcp-server.mjs` by mcp.test.mjs.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "fake", version: "1.0.0" });

server.registerTool(
  "ping",
  { title: "Ping", description: "Answers pong.", inputSchema: { text: z.string().optional() } },
  async ({ text }) => ({ content: [{ type: "text", text: `pong ${text || ""}`.trim() }] }),
);

server.registerTool(
  "echo",
  { title: "Echo", description: "Echoes the message.", inputSchema: { message: z.string() } },
  async ({ message }) => ({ content: [{ type: "text", text: message }] }),
);

await server.connect(new StdioServerTransport());
