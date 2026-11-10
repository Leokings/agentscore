// The AgentScore REST API (apps/api), served by the website at /api/v1/... so one deployment
// (localhost or Vercel) runs both. The standalone server in apps/api/src/server.ts serves the
// same routes at /v1/... for the MCP server and local scripts.
import { Hono } from "hono";
import { Store } from "@agentscore/indexer";
import { createApp } from "@agentscore/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A cold start may sync the Internet Court index and read the GenLayer contract.
export const maxDuration = 60;

let app: Promise<Hono> | undefined;

function getApp(): Promise<Hono> {
  app ??= Store.open().then((store) => new Hono().route("/api", createApp(store)));
  return app;
}

async function handle(req: Request): Promise<Response> {
  return (await getApp()).fetch(req);
}

export { handle as GET, handle as OPTIONS };
