#!/usr/bin/env tsx
/**
 * Smoke test for an MCP endpoint, as a real MCP client: lists the tools and calls each.
 *   npx tsx scripts/check-mcp.ts                                       # the live site
 *   npx tsx scripts/check-mcp.ts http://localhost:3000/api/mcp         # local dev server
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const url = process.argv[2] ?? "https://agentscore-seven.vercel.app/api/mcp";
const AGENT_X = "0x36b26d2DF45a2838E6Fe0F8B3c97Cd0033A124Cc"; // staged fake win, Internet Court case 19

const client = new Client({ name: "agentscore-check", version: "0.1.0" });
await client.connect(new StreamableHTTPClientTransport(new URL(url)));

const { tools } = await client.listTools();
console.log(`${url}: ${tools.length} tools: ${tools.map((t) => t.name).join(", ")}`);

const calls: Array<[string, Record<string, unknown>]> = [
  ["check_agent", { wallet: AGENT_X }],
  ["check_agent", { wallet: AGENT_X, amount: 50 }],
  ["get_agent_report", { wallet: AGENT_X }],
];
let failed = 0;
for (const [name, args] of calls) {
  const r = await client.callTool({ name, arguments: args });
  const text = (r.content as Array<{ type: string; text?: string }>)[0]?.text ?? "";
  if (r.isError) failed++;
  console.log(`${r.isError ? "✗" : "✓"} ${name}(${JSON.stringify(args)}): ${text.replace(/\s+/g, " ").slice(0, 160)}…`);
}
await client.close();
process.exit(failed ? 1 : 0);
