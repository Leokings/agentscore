import { existsSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

// Locally, read the repository's .env (Vercel sets the same variables in its project settings).
const envFile = resolve(repoRoot, ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

// A relative local database path is relative to the repository root, as for the other workspaces.
const db = process.env.DATABASE_URL || "file:data/agentscore.db";
if (db.startsWith("file:") && !isAbsolute(db.slice("file:".length))) {
  process.env.DATABASE_URL = `file:${resolve(repoRoot, db.slice("file:".length))}`;
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Workspace packages ship TypeScript source.
  transpilePackages: ["@agentscore/shared", "@agentscore/indexer", "@agentscore/links", "@agentscore/api", "@agentscore/mcp"],
  // Native / Node-only clients stay outside the server bundle.
  serverExternalPackages: ["@libsql/client", "libsql"],
  env: {
    // Same origin by default (the API is mounted at /api); override to point at another API.
    NEXT_PUBLIC_AGENTSCORE_API_URL: process.env.NEXT_PUBLIC_AGENTSCORE_API_URL ?? "/api",
  },
  webpack(config) {
    // The workspace sources use ESM-style ".js" import specifiers for ".ts" files.
    config.resolve.extensionAlias = { ".js": [".ts", ".tsx", ".js"], ".mjs": [".mts", ".mjs"] };
    return config;
  },
};

export default nextConfig;
