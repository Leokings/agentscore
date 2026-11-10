#!/usr/bin/env node
// AgentScore MCP server over stdio, for clients that run a local command. The same tools are
// hosted at https://agentscore-seven.vercel.app/api/mcp (Streamable HTTP), which needs no install.
// Point it at an API with AGENTSCORE_API_URL (default: the hosted API).
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createAgentScoreServer } from "./tools.js";

const API = (process.env.AGENTSCORE_API_URL ?? "https://agentscore-seven.vercel.app/api").replace(/\/$/, "");

const server = createAgentScoreServer((path) => fetch(`${API}${path}`, { headers: { accept: "application/json" } }), `the AgentScore API at ${API}`);
await server.connect(new StdioServerTransport());
