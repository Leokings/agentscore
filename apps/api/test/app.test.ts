import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Store } from "@agentscore/indexer";
import { createApp } from "../src/app.js";
import type { ScoreReader } from "../src/contract.js";

// Uses the live Base Sepolia chain and Blockscout, so it needs network access.
let store: Store;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  store = await Store.open(":memory:");
  app = createApp(store);
}, 120_000);

afterAll(() => store.close());

describe("API", () => {
  it("rejects a malformed wallet", async () => {
    const res = await app.request("/v1/agents/not-a-wallet/score");
    expect(res.status).toBe(400);
  });

  it("returns a real Internet Court record", async () => {
    const res = await app.request("/v1/agents/0xce413FFE2628b60cdaF4413d63d7838B8d4309AC/court-record");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { totals: { cases: number; ruled: number } };
    expect(body.totals.cases).toBeGreaterThanOrEqual(2);
    expect(body.totals.ruled).toBeGreaterThanOrEqual(2);
  }, 180_000);

  it("approves only within the contract's approval limit", async () => {
    const fake = {
      configured: true,
      contract: "0x0000000000000000000000000000000000000abc",
      read: async () => ({ wallet: "", grade: "B", points: 70, approval_limit_usd: 1000, flags: ["FAKE_WINS"], counts: { ruled_cases: 3, wins: 2, loss_penalty: 0, inherited_penalty: 0 } }),
    } as unknown as ScoreReader;
    const scored = createApp(store, fake);
    const w = "0xce413FFE2628b60cdaF4413d63d7838B8d4309AC";
    const ok = (await (await scored.request(`/v1/check?wallet=${w}&amount=1000`)).json()) as { decision: string; grade: string };
    const no = (await (await scored.request(`/v1/check?wallet=${w}&amount=1001`)).json()) as { decision: string; reasons: string[] };
    expect(ok).toMatchObject({ decision: "approve", grade: "B" });
    expect(no.decision).toBe("deny");
    expect(no.reasons.join(" ")).toContain("do not count");
  });

  it("never approves when the contract cannot be read", async () => {
    const broken = { configured: true, contract: "0xabc", read: async () => Promise.reject(new Error("down")) } as unknown as ScoreReader;
    const body = (await (await createApp(store, broken).request("/v1/check?wallet=0xce413FFE2628b60cdaF4413d63d7838B8d4309AC&amount=1")).json()) as {
      decision: unknown;
      status: string;
    };
    expect(body).toMatchObject({ decision: null, status: "pending" });
  });

  it("never reports a grade before the scoring contract exists", async () => {
    const res = await app.request("/v1/check?wallet=0xce413FFE2628b60cdaF4413d63d7838B8d4309AC&amount=500");
    const body = (await res.json()) as { decision: unknown; status: string; grade: unknown };
    expect(body).toMatchObject({ decision: null, status: "not_scored", grade: null });
  });
});
