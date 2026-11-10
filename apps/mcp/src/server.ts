#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

/**
 * AgentScore MCP server. A thin layer over the REST API, so MCP clients and HTTP clients
 * always see the same data. Configure the API with AGENTSCORE_API_URL.
 */
const API = (process.env.AGENTSCORE_API_URL ?? "http://localhost:8787").replace(/\/$/, "");
const wallet = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "A 0x-prefixed EVM wallet address");

async function call(path: string) {
  try {
    const res = await fetch(`${API}${path}`, { headers: { accept: "application/json" } });
    const text = await res.text();
    return { content: [{ type: "text" as const, text }], isError: !res.ok };
  } catch (e) {
    return { content: [{ type: "text" as const, text: `AgentScore API unreachable at ${API}: ${(e as Error).message}` }], isError: true };
  }
}

const server = new McpServer({ name: "agentscore", version: "0.1.0" });

server.tool(
  "get_agent_score",
  "Get an AI agent's AgentScore credit grade (A–F), reasons and flags, by wallet address.",
  { wallet },
  async (args) => call(`/v1/agents/${args.wallet}/score`),
);

server.tool(
  "check_counterparty",
  "Before paying or hiring an agent: should a job of this size go ahead without escrow? Returns approve/deny with reasons.",
  { wallet, amount: z.number().nonnegative().describe("Job size in USD") },
  async (args) => call(`/v1/check?wallet=${args.wallet}&amount=${args.amount}`),
);

server.tool(
  "get_court_record",
  "List every Internet Court case where this wallet is a party, with verdicts and the AI jury's reasoning.",
  { wallet },
  async (args) => call(`/v1/agents/${args.wallet}/court-record`),
);

server.tool(
  "get_agent_links",
  "Show wallets likely controlled by the same owner as this agent (shared funder, parent/child, shared cash-out, same deployer or signer, fake court wins, closed loops, abandoned predecessor wallets).",
  { wallet },
  async (args) => call(`/v1/agents/${args.wallet}/links`),
);

await server.connect(new StdioServerTransport());
