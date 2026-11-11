import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Store } from "@agentscore/indexer";
import type { Address } from "@agentscore/shared";
import { NansenBudgetError, NansenClient } from "../src/index.js";

const W = "0x00000000000000000000000000000000000000a1" as Address;
const W2 = "0x00000000000000000000000000000000000000a2" as Address;
const DAY = 24 * 60 * 60 * 1000;

/** A fake Nansen API that counts paid calls. */
function fakeNansen(answer: (path: string) => unknown) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const path = new URL(url).pathname;
      calls.push(path);
      return new Response(JSON.stringify(answer(path)), { status: 200 });
    }),
  );
  return calls;
}

const firstFunder = { data: [{ address: W2, address_label: null, relation: "First Funder", transaction_hash: null, block_timestamp: null, order: 1, chain: "base" }] };
const earliest = { data: [{ chain: "base", method: "send", transaction_hash: "0x" + "1".repeat(64), block_timestamp: "2026-01-01" }] };

describe("Nansen credit protection", () => {
  let store: Store;
  // The cache's expiry and the client's daily budget both follow the (faked) system clock.
  let t: number;
  const now = () => t;
  const advance = (ms: number) => {
    t += ms;
    vi.setSystemTime(t);
  };

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    t = Date.parse("2026-11-10T12:00:00Z");
    vi.setSystemTime(t);
    store = await Store.open(":memory:");
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("pays once for a first funder and earliest transactions, then reuses them for good", async () => {
    const calls = fakeNansen((p) => (p.endsWith("related-wallets") ? firstFunder : earliest));
    const client = new NansenClient(store, "key", 40, 8, now);
    await client.relatedWallets(W, "base");
    await client.earliestTransactions(W, "base");
    // Days, then a year, later: the earliest-transactions request body now carries another date,
    // but the answer cannot have changed, so nothing is paid for again.
    for (const later of [DAY, 2 * DAY, 365 * DAY]) {
      advance(later);
      await new NansenClient(store, "key", 40, 8, now).relatedWallets(W, "base");
      await new NansenClient(store, "key", 40, 8, now).earliestTransactions(W, "base");
    }
    expect(calls).toHaveLength(2);
  });

  it("asks again about a wallet with no answer, but only after a week", async () => {
    const calls = fakeNansen(() => ({ data: [] }));
    const client = () => new NansenClient(store, "key", 40, 8, now);
    await client().relatedWallets(W, "base");
    advance(6 * DAY);
    await client().relatedWallets(W, "base");
    expect(calls).toHaveLength(1);
    advance(2 * DAY);
    await client().relatedWallets(W, "base");
    expect(calls).toHaveLength(2);
  });

  it("shares one daily budget across processes and resets it the next UTC day", async () => {
    const calls = fakeNansen(() => ({ data: [] }));
    const wallets = Array.from({ length: 6 }, (_, i) => `0x${(0xb0 + i).toString(16).padStart(40, "0")}` as Address);
    // Two "processes" (e.g. two keeper runs) with a 3-credit daily budget between them.
    const a = new NansenClient(store, "key", 40, 3, now);
    const b = new NansenClient(store, "key", 40, 3, now);
    await a.relatedWallets(wallets[0]!, "base");
    await a.relatedWallets(wallets[1]!, "base");
    await b.relatedWallets(wallets[2]!, "base");
    await expect(b.relatedWallets(wallets[3]!, "base")).rejects.toBeInstanceOf(NansenBudgetError);
    expect(calls).toHaveLength(3);
    expect(await a.spentToday()).toBe(3);

    advance(DAY);
    await new NansenClient(store, "key", 40, 3, now).relatedWallets(wallets[4]!, "base");
    expect(calls).toHaveLength(4);
  });

  it("still enforces the per-run cap", async () => {
    fakeNansen(() => ({ data: [] }));
    const client = new NansenClient(store, "key", 1, 100, now);
    await client.relatedWallets(W, "base");
    await expect(client.relatedWallets(W2, "base")).rejects.toThrow(/cap for this run/);
  });

  it("stops asking for the rest of the day once Nansen refuses for its daily limit", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      calls++;
      return new Response(JSON.stringify({ message: "This API key would exceed its daily credit limit (40 of 40 credits used)" }), { status: 429 });
    }));
    const client = () => new NansenClient(store, "key", 40, 8, now);
    await expect(client().relatedWallets(W, "base")).rejects.toBeInstanceOf(NansenBudgetError);
    await expect(client().relatedWallets(W2, "base")).rejects.toBeInstanceOf(NansenBudgetError);
    expect(calls).toBe(1);
    advance(DAY);
    await expect(client().relatedWallets(W2, "base")).rejects.toBeInstanceOf(NansenBudgetError);
    expect(calls).toBe(2); // a new UTC day: asked again
  });

  it("reuses an answer cached under the old date-based key instead of paying again", async () => {
    const calls = fakeNansen(() => earliest);
    const day = new Date(t).toISOString().slice(0, 10);
    const oldBody = {
      address: W,
      chain: "base",
      date: { from: "2023-06-01", to: day },
      hide_spam_token: true,
      pagination: { page: 1, per_page: 10 },
      order_by: [{ field: "block_timestamp", direction: "ASC" }],
    };
    await store.cacheSet(`nansen:/api/v1/profiler/address/transactions:${JSON.stringify(oldBody)}`, earliest, DAY);
    const txs = await new NansenClient(store, "key", 40, 8, now).earliestTransactions(W, "base");
    expect(txs).toHaveLength(1);
    expect(calls).toHaveLength(0);
  });
});
