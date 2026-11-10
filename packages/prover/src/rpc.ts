import type { Address, TxHash } from "@agentscore/shared";

/** The networks the contract accepts link proofs on, with the same public RPC endpoints it uses. */
export const NETWORK_RPC = {
  "base-sepolia": "https://sepolia.base.org",
  base: "https://mainnet.base.org",
} as const;
export type ProofNetwork = keyof typeof NETWORK_RPC;

/** Must match MAX_FUNDER_NONCE in contracts/agent_score.py. */
export const MAX_FUNDER_NONCE = 1000;

export interface ChainTx {
  hash: TxHash;
  from: Address;
  to: Address | "";
  value: bigint;
  nonce: number;
  block: number;
  succeeded: boolean;
}

/** Fetches transactions and receipts in one batch, exactly as the contract does. Missing txs are omitted. */
export async function fetchTxs(network: ProofNetwork, hashes: TxHash[]): Promise<Map<TxHash, ChainTx>> {
  const payload = hashes.flatMap((h, i) => [
    { jsonrpc: "2.0", id: 2 * i + 1, method: "eth_getTransactionByHash", params: [h] },
    { jsonrpc: "2.0", id: 2 * i + 2, method: "eth_getTransactionReceipt", params: [h] },
  ]);
  const res = await fetch(NETWORK_RPC[network], {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "agentscore-prover" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`${network} RPC ${res.status}`);
  const items = (await res.json()) as Array<{ id: number; result?: Record<string, string> | null }>;
  const byId = new Map(items.map((i) => [i.id, i.result ?? null]));
  const out = new Map<TxHash, ChainTx>();
  hashes.forEach((h, i) => {
    const tx = byId.get(2 * i + 1);
    const receipt = byId.get(2 * i + 2);
    if (!tx) return;
    out.set(h, {
      hash: h,
      from: tx.from!.toLowerCase() as Address,
      to: (tx.to?.toLowerCase() ?? "") as Address | "",
      value: BigInt(tx.value!),
      nonce: Number(BigInt(tx.nonce!)),
      block: Number(BigInt(tx.blockNumber!)),
      succeeded: receipt?.status === "0x1",
    });
  });
  return out;
}

export type FundingCheck = { ok: true } | { ok: false; reason: string };

/** The contract's first-funding rule, checked locally so we never submit a proof that will fail. */
export function checkFirstFunding(wallet: Address, funder: Address, funding: ChainTx | undefined, first: ChainTx | undefined): FundingCheck {
  if (!funding) return { ok: false, reason: "funding transaction not found on this network" };
  if (!first) return { ok: false, reason: "wallet's first transaction not found on this network" };
  if (!funding.succeeded || !first.succeeded) return { ok: false, reason: "a transaction failed or is pending" };
  if (funding.from !== funder || funding.to !== wallet) return { ok: false, reason: "funding does not go from the funder to the wallet" };
  if (funding.value <= 0n) return { ok: false, reason: "funding carries no value" };
  if (first.from !== wallet || first.nonce !== 0) return { ok: false, reason: "first transaction is not the wallet's nonce 0" };
  if (funding.block > first.block) return { ok: false, reason: "funding came after the wallet's first transaction" };
  if (funding.nonce > MAX_FUNDER_NONCE) return { ok: false, reason: `funder had sent ${funding.nonce} transactions: an exchange or faucet` };
  return { ok: true };
}
