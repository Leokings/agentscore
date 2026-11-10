import { describe, expect, it } from "vitest";
import type { Address, TxHash } from "@agentscore/shared";
import { buildProofs, checkFirstFunding, type ChainTx, type FirstFunding } from "../src/index.js";

const a = (n: number) => `0x${n.toString(16).padStart(40, "0")}` as Address;
const h = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as TxHash;
const W = a(1), F = a(2), S = a(3);

const tx = (p: Partial<ChainTx>): ChainTx => ({ hash: h(1), from: F, to: W, value: 1n, nonce: 3, block: 10, succeeded: true, ...p });

describe("checkFirstFunding mirrors the contract", () => {
  const first = tx({ hash: h(2), from: W, to: S, nonce: 0, block: 11 });
  it("accepts funding before the wallet's nonce-0 transaction", () => {
    expect(checkFirstFunding(W, F, tx({}), first)).toEqual({ ok: true });
  });
  it.each([
    ["missing funding", undefined, first, "not found"],
    ["wrong funder", tx({ from: S }), first, "from the funder"],
    ["zero value", tx({ value: 0n }), first, "no value"],
    ["dust after start", tx({ block: 50 }), first, "after the wallet's first"],
    ["not nonce 0", tx({}), tx({ hash: h(2), from: W, nonce: 4, block: 11 }), "nonce 0"],
    ["exchange funder", tx({ nonce: 1001 }), first, "exchange or faucet"],
    ["failed tx", tx({ succeeded: false }), first, "failed"],
  ])("rejects %s", (_name, funding, firstTx, reason) => {
    const r = checkFirstFunding(W, F, funding as ChainTx | undefined, firstTx as ChainTx);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toContain(reason);
  });
});

describe("buildProofs", () => {
  const fact = (wallet: Address, funder: Address, n: number, ok = true, network: FirstFunding["network"] = "base-sepolia"): FirstFunding => ({
    wallet,
    funder,
    network,
    fundingTx: h(100 + n),
    firstTx: h(200 + n),
    source: network === "base" ? "nansen" : "blockscout",
    check: ok ? { ok: true } : { ok: false, reason: "x" },
  });

  it("makes a parent proof when the funder is a known wallet", () => {
    const [p] = buildProofs([fact(W, F, 1)], new Set([W, F]));
    expect(p).toMatchObject({ kind: "first_funded_by", subject: W, other: F, proof: { funding_tx: h(101), subject_first_tx: h(201) } });
    expect(p!.proof).not.toHaveProperty("network"); // base-sepolia is the contract default
  });

  it("makes sibling proofs for wallets that share a funder on the same network", () => {
    const proofs = buildProofs([fact(W, F, 1), fact(S, F, 2), fact(a(9), F, 3, true, "base")], new Set([W, S]));
    expect(proofs).toHaveLength(1);
    expect(proofs[0]).toMatchObject({ kind: "shared_first_funder", subject: W, other: S, proof: { funder: F, other_funding_tx: h(102) } });
  });

  it("marks mainnet proofs with the network and credits Nansen", () => {
    const [p] = buildProofs([fact(W, F, 1, true, "base")], new Set([W, F]));
    expect(p).toMatchObject({ network: "base", source: "nansen", proof: { network: "base" } });
  });

  it("never builds a proof from a failed check", () => {
    expect(buildProofs([fact(W, F, 1, false), fact(S, F, 2, false)], new Set([W, S, F]))).toEqual([]);
  });
});
