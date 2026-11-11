import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { courtRecord, Store, syncInternetCourt } from "@agentscore/indexer";
import { buildLinks, gatherGraph, NansenClient } from "@agentscore/links";
import { isAddress, normalizeAddress, type Address, type AgentScore } from "@agentscore/shared";
import { ScoreReader, toAgentScore } from "./contract.js";
import { adviceFor, buildReport } from "./report.js";

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

  async function verifiedSignals(wallet: Address): Promise<Record<string, string>> {
    try {
      return await reader.signals(wallet);
    } catch (e) {
      console.error("GenLayer signal read failed", e);
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
        "GET /v1/check?wallet=0x...&amount=500   (quick advice; amount optional)",
        "GET /v1/agents/:wallet/report           (full history)",
        "GET /v1/agents/:wallet/score",
        "GET /v1/agents/:wallet/court-record",
        "GET /v1/agents/:wallet/links",
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
    // `proven` are the links the GenLayer contract verified and counts in the grade;
    // `verifiedSignals` are links it verified that only cap the escrow-free limit at $100.
    const [walletLinks, proven, signalLinks] = await Promise.all([links(wallet), provenLinks(wallet), verifiedSignals(wallet)]);
    return c.json({ wallet, links: walletLinks, proven, verifiedSignals: signalLinks });
  });

  app.get("/v1/agents/:wallet/score", async (c) => {
    const wallet = walletParam(c.req.param("wallet"));
    await ensureFresh();
    const [record, walletLinks, s] = await Promise.all([courtRecord(store, wallet), links(wallet), score(wallet)]);
    return c.json({ ...s, court: record.totals, links: walletLinks.length, strongLinks: walletLinks.filter((l) => l.strength === "strong").length });
  });

  /**
   * Quick advice for whoever is about to pay this agent. With an amount, `decision` is "approve"
   * (pay directly) or "deny" (pay only through escrow); without one, `advice` gives the limit.
   */
  app.get("/v1/check", async (c) => {
    const wallet = walletParam(c.req.query("wallet"));
    const rawAmount = c.req.query("amount");
    const amount = rawAmount === undefined || rawAmount === "" ? undefined : Number(rawAmount);
    if (amount !== undefined && (!Number.isFinite(amount) || amount < 0)) throw new HTTPException(400, { message: "amount must be a non-negative number" });
    const s = await score(wallet);
    // Only a real grade can approve; unknown or unreadable agents always need escrow.
    const { advice } = adviceFor(s, amount);
    const decision = s.status !== "scored" || amount === undefined ? null : amount <= (s.approvalLimitUsd ?? 0) && (s.approvalLimitUsd ?? 0) > 0 ? "approve" : "deny";
    return c.json({ ...s, amount: amount ?? null, decision, advice });
  });

  /**
   * The agent's full history: every Internet Court case (claim, result, how it was decided, what
   * the validators found, what it did to the score) and every linked wallet with its evidence and
   * the losses it passes on. Everything is read from the index and the GenLayer contract.
   */
  app.get("/v1/agents/:wallet/report", async (c) => {
    const wallet = walletParam(c.req.param("wallet"));
    await ensureFresh();
    const [s, record, signals, proven, signalLinks] = await Promise.all([score(wallet), courtRecord(store, wallet), links(wallet), provenLinks(wallet), verifiedSignals(wallet)]);
    const readCase = async (address: string) => {
      try {
        return await reader.case(address);
      } catch (e) {
        console.error("GenLayer case read failed", e);
        return null;
      }
    };
    const judged = new Map(await Promise.all(record.cases.map(async (k) => [k.address, await readCase(k.address)] as const)));
    const linkedCases = new Map(
      await Promise.all(
        Object.keys(proven).map(async (other) => {
          const theirs = await courtRecord(store, other as Address);
          return [other, await Promise.all(theirs.cases.map(async (courtCase) => ({ courtCase, judged: await readCase(courtCase.address) })))] as const;
        }),
      ),
    );
    return c.json(buildReport({ wallet, score: s, cases: record.cases, judged, proven, verifiedSignals: signalLinks, signals, linkedCases }));
  });

  return app;
}
