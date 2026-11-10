import { serve } from "@hono/node-server";
import { Store } from "@agentscore/indexer";
import { createApp } from "./app.js";

const port = Number(process.env.API_PORT ?? 8787);
const store = await Store.open();
serve({ fetch: createApp(store).fetch, port }, (info) => {
  console.log(`AgentScore API listening on http://localhost:${info.port}`);
});
