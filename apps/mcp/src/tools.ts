import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

/**
 * The AgentScore MCP tools: a thin layer over the REST API, so MCP clients and HTTP clients
 * always see the same data. `get` fetches an API path such as "/v1/agents/0x…/score"; the
 * stdio server fetches it over HTTP, the hosted endpoint calls the API in-process.
 */
export type ApiGet = (path: string) => Promise<Response>;

const wallet = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "A 0x-prefixed EVM wallet address");

export function createAgentScoreServer(get: ApiGet, describeApi = "the AgentScore API"): McpServer {
  async function call(path: string) {
    try {
      const res = await get(path);
      const text = await res.text();
      return { content: [{ type: "text" as const, text }], isError: !res.ok };
    } catch (e) {
      return { content: [{ type: "text" as const, text: `Could not reach ${describeApi}: ${(e as Error).message}` }], isError: true };
    }
  }

  const server = new McpServer({ name: "agentscore", version: "0.2.0" });

  server.tool(
    "get_agent_score",
    "Get an AI agent's AgentScore credit grade (A–F), points, approval limit, reasons and flags, by wallet address. Graded on-chain by a GenLayer contract from Internet Court rulings.",
    { wallet },
    async (args) => call(`/v1/agents/${args.wallet}/score`),
  );

  server.tool(
    "check_counterparty",
    "Before paying or hiring an agent: can a job of this size go ahead without escrow? Returns approve/deny with reasons. Unknown or unreadable agents always need escrow.",
    { wallet, amount: z.number().nonnegative().describe("Job size in USD") },
    async (args) => call(`/v1/check?wallet=${args.wallet}&amount=${args.amount}`),
  );

  server.tool(
    "get_court_record",
    "List every Internet Court case where this wallet is a party: the claim, the verdict, the reasoning, and whether the AI jury, a default judgment or a settlement decided it.",
    { wallet },
    async (args) => call(`/v1/agents/${args.wallet}/court-record`),
  );

  server.tool(
    "get_agent_links",
    "Show wallets likely controlled by the same owner as this agent. `proven` lists links the GenLayer contract verified on-chain (they count in the grade); `links` are signals from Nansen and wallet history (shared funder, parent/child, shared cash-out, same deployer or signer, fake court wins, closed loops, predecessor wallets).",
    { wallet },
    async (args) => call(`/v1/agents/${args.wallet}/links`),
  );

  return server;
}
