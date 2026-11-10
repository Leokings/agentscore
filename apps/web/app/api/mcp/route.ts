// Hosted AgentScore MCP server (Streamable HTTP, stateless). Add it to any MCP client with no
// install, e.g.  claude mcp add --transport http agentscore https://agentscore-seven.vercel.app/api/mcp
// Each request gets a fresh server and transport; the tools call the REST API in-process.
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { Hono } from "hono";
import { Store } from "@agentscore/indexer";
import { createApp } from "@agentscore/api";
import { createAgentScoreServer } from "@agentscore/mcp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

let api: Promise<Hono> | undefined;

function getApi(): Promise<Hono> {
  api ??= Store.open().then((store) => createApp(store));
  return api;
}

async function handle(req: Request): Promise<Response> {
  const app = await getApi();
  const server = createAgentScoreServer((path) => Promise.resolve(app.fetch(new Request(new URL(path, "http://agentscore.internal")))));
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  return transport.handleRequest(req);
}

export { handle as GET, handle as POST, handle as DELETE };
