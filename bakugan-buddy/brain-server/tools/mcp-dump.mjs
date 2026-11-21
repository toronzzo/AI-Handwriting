import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "node:path";

const target = process.argv[2]; // files | browser
const here = process.cwd();
let command, args;
if (target === "files") {
  command = process.execPath;
  args = [path.join(here, "node_modules/@modelcontextprotocol/server-filesystem/dist/index.js"), "/tmp"];
} else {
  command = process.execPath;
  args = [path.join(here, "node_modules/@playwright/mcp/cli.js"), "--headless", "--isolated"];
}
const client = new Client({ name: "dump", version: "1.0.0" });
const transport = new StdioClientTransport({ command, args, stderr: "pipe" });
await client.connect(transport);
const { tools } = await client.listTools();
for (const t of tools) {
  console.log("### " + t.name);
  console.log("desc: " + (t.description || "").replace(/\n/g, " ").slice(0, 300));
  console.log("schema: " + JSON.stringify(t.inputSchema ?? {}));
}
await client.close();
process.exit(0);
