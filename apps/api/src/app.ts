import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { courtRecord, Store, syncInternetCourt } from "@agentscore/indexer";
import { buildLinks, gatherGraph, NansenClient } from "@agentscore/links";
import { isAddress, normalizeAddress, type Address, type AgentScore } from "@agentscore/shared";
import { ScoreReader, toAgentScore } from "./contract.js";

/** How stale the Internet Court index may get before a request triggers a sync. */
const SYNC_INTERVAL_MS = 2 * 60 * 1000;

export function createApp(store: Store, reader: ScoreReader = new ScoreReader()) {
  const app = new Hono();
  let lastSync = 0;
  let syncing: Promise<unknown> | undefined;

  /** Keeps the court index fresh without making every request wait on the chain. */
  async function ensureFresh(): Promise<void> {
    if (Date.now() - lastSync < SYNC_INTERVAL_MS) return;
    syncing ??= syncInternetCourt(store)
      .then(() => {
        lastSync = Date.now();
      })
      .finally(() => {
        syncing = undefined;
      });
    await syncing;
  }

  function walletParam(raw: string | undefined): Address {
    if (!raw || !isAddress(raw)) throw new HTTPException(400, { message: "wallet must be a 0x-prefixed 20-byte address" });
    return normalizeAddress(raw);
  }

  async function links(wallet: Address) {
    const graph = await gatherGraph(store, wallet, { nansen: new NansenClient(store) });
    return buildLinks(graph);
  }

  async function provenLinks(wallet: Address): Promise<Record<string, string>> {
    try {
      return await reader.links(wallet);
    } catch (e) {
      console.error("GenLayer link read failed", e);
      return {};
    }
  }

  /** Reads the grade from the GenLayer contract; never invents one when it is unavailable. */
  async function score(wallet: Address): Promise<AgentScore & { approvalLimitUsd?: number }> {
    if (!reader.configured) {
      return { wallet, grade: null, status: "not_scored", reasons: ["The GenLayer scoring contract is not configured (AGENTSCORE_CONTRACT_ADDRESS)."], flags: [] };
    }
    try {
      const raw = await reader.read(wallet);
      if (raw) return toAgentScore(wallet, raw, reader.contract!);
    } catch (e) {
      console.error("GenLayer read failed", e);
    }
    return { wallet, grade: null, status: "pending", reasons: ["The GenLayer contract could not be read right now."], flags: [] };
  }

  app.use("*", cors());

  app.onError((err, c) => {
    if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
    console.error(err);
    return c.json({ error: "Internal error" }, 500);
  });

  app.get("/", (c) =>
    c.json({
      name: "AgentScore API",
      version: "v1",
      endpoints: [
        "GET /v1/agents/:wallet/score",
        "GET /v1/agents/:wallet/court-record",
        "GET /v1/agents/:wallet/links",
        "GET /v1/check?wallet=0x...&amount=500",
        "GET /v1/cases",
      ],
    }),
  );

  app.get("/v1/health", (c) => c.json({ ok: true }));

  app.get("/v1/cases", async (c) => {
    await ensureFresh();
    return c.json({ cases: await store.allCases() });
  });

  app.get("/v1/agents/:wallet/court-record", async (c) => {
    const wallet = walletParam(c.req.param("wallet"));
    await ensureFresh();
    return c.json(await courtRecord(store, wallet));
  });

  app.get("/v1/agents/:wallet/links", async (c) => {
    const wallet = walletParam(c.req.param("wallet"));
    await ensureFresh();
    // `links` are what the link builder sees (Nansen + on-chain history, some only flags);
    // `proven` are the links the GenLayer contract verified and counts in the grade.
    const [walletLinks, proven] = await Promise.all([links(wallet), provenLinks(wallet)]);
    return c.json({ wallet, links: walletLinks, proven });
  });

  app.get("/v1/agents/:wallet/score", async (c) => {
    const wallet = walletParam(c.req.param("wallet"));
    await ensureFresh();
    const [record, walletLinks, s] = await Promise.all([courtRecord(store, wallet), links(wallet), score(wallet)]);
    return c.json({ ...s, court: record.totals, links: walletLinks.length, strongLinks: walletLinks.filter((l) => l.strength === "strong").length });
  });

  app.get("/v1/check", async (c) => {
    const wallet = walletParam(c.req.query("wallet"));
    const amount = Number(c.req.query("amount") ?? "0");
    if (!Number.isFinite(amount) || amount < 0) throw new HTTPException(400, { message: "amount must be a non-negative number" });
    const s = await score(wallet);
    // Only a real grade can approve; unknown or unreadable agents always need escrow.
    const decision = s.status !== "scored" ? null : amount <= (s.approvalLimitUsd ?? 0) ? "approve" : "deny";
    return c.json({ ...s, amount, decision });
  });

  return app;
}
