import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

/**
 * The AgentScore MCP tools: a thin layer over the REST API, so MCP clients and HTTP clients
 * always see the same data. `get` fetches an API path such as "/v1/check?wallet=0x…"; the stdio
 * server fetches it over HTTP, the hosted endpoint calls the API in-process.
 *
 * Two tools, for two moments:
 *   check_agent       quick advice before paying an agent (pay directly, or only through escrow)
 *   get_agent_report  the agent's full history: every case, what it did to the score, linked wallets
 */
export type ApiGet = (path: string) => Promise<Response>;

const wallet = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "A 0x-prefixed EVM wallet address");

/** Keeps the quick answer short: the fields an agent needs to decide, nothing else. */
function quick(body: Record<string, unknown>) {
  const counts = (body.counts ?? {}) as Record<string, number>;
  return {
    wallet: body.wallet,
    advice: body.advice,
    decision: body.decision,
    grade: body.grade,
    points: body.points ?? null,
    approvalLimitUsd: body.approvalLimitUsd ?? null,
    flags: body.flags,
    why: body.reasons,
    juryCases: counts.jury_cases ?? null,
    linkedWallets: counts.linked_wallets ?? null,
    more: "Call get_agent_report for every case and linked wallet behind this.",
  };
}

export function createAgentScoreServer(get: ApiGet, describeApi = "the AgentScore API"): McpServer {
  async function call(path: string, shape?: (body: Record<string, unknown>) => unknown) {
    try {
      const res = await get(path);
      const text = await res.text();
      if (!res.ok || !shape) return { content: [{ type: "text" as const, text }], isError: !res.ok };
      return { content: [{ type: "text" as const, text: JSON.stringify(shape(JSON.parse(text) as Record<string, unknown>), null, 2) }] };
    } catch (e) {
      return { content: [{ type: "text" as const, text: `Could not reach ${describeApi}: ${(e as Error).message}` }], isError: true };
    }
  }

  const server = new McpServer({ name: "agentscore", version: "0.3.0" });

  server.tool(
    "check_agent",
    "Quick advice before paying or hiring an AI agent: can it be paid directly, or only through escrow (an Internet Court agreement)? Give the job size in USD for an approve/deny decision; without it you get the agent's limit. Returns the grade (A–F), points, limit, flags and a one-line reason. Scores come from Internet Court rulings, graded on-chain by a GenLayer contract; an unknown agent always needs escrow.",
    { wallet, amount: z.number().nonnegative().optional().describe("Job size in USD (optional)") },
    async (args) => call(`/v1/check?wallet=${args.wallet}${args.amount === undefined ? "" : `&amount=${args.amount}`}`, quick),
  );

  server.tool(
    "get_agent_report",
    "The agent's full history behind its score: every Internet Court case (the claim, whether it won or lost, whether the AI jury, a default judgment or a settlement decided it, what validators found such as non-delivery or deception, and how many points it added or cost), plus every wallet linked to it, in three tiers: proven same-owner links (their losses count, wins against them are fake), verified signals such as a shared cash-out wallet or a closed loop of payments (no points lost, but jobs above $100 need escrow), and hints from Nansen and wallet history that do not count.",
    { wallet },
    async (args) => call(`/v1/agents/${args.wallet}/report`),
  );

  return server;
}
