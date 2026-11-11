import { blockscoutGet, type Store } from "@agentscore/indexer";
import { transfers } from "@agentscore/links";
import { normalizeAddress, type Address, type TxHash } from "@agentscore/shared";
import type { LinkProof } from "./discover.js";
import { fetchTxs, MAX_FUNDER_NONCE, MIN_LINK_VALUE_WEI, type ChainTx } from "./rpc.js";

// Must match contracts/agent_score.py (Base produces a block every 2 seconds).
const CASHOUT_WINDOW_BLOCKS = 30 * 24 * 1800;
const LOOP_WINDOW_BLOCKS = 24 * 1800;
const LOOP_MIN_RETURN_PERCENT = 80n;
const MIN = MIN_LINK_VALUE_WEI["base-sepolia"];

const isHash = (v: unknown): v is TxHash => typeof v === "string" && /^0x[0-9a-fA-F]{64}$/.test(v);

/**
 * Finds v8 link proofs among Internet Court parties on Base Sepolia and pre-checks each with the
 * contract's rules, so nothing is submitted that the contract would reject:
 *   deployed_by / shared_deployer  a party's wallet is a contract created directly by an ordinary
 *                                  wallet (another party, or the same deployer as another party)
 *   shared_cashout (signal)        two parties paid the same third wallet within 30 days, and that
 *                                  wallet later sent a transaction of its own with nonce ≤ 1,000
 *   closed_loop (signal)           one party paid another, which sent ≥ 80% back within a day
 * First-funding links are found by discover.ts.
 */
export async function discoverV8Proofs(store: Store, parties: Address[], log: (m: string) => void = () => {}): Promise<LinkProof[]> {
  const set = new Set(parties);
  const proofs: LinkProof[] = [];

  // --- Deployments
  const deployments: Array<{ wallet: Address; deployer: Address; tx: TxHash }> = [];
  for (const w of parties) {
    const info = await blockscoutGet<{ is_contract?: boolean; creator_address_hash?: string | null; creation_transaction_hash?: string | null }>(`/addresses/${w}`).catch(() => ({}) as Record<string, never>);
    if (!info.is_contract || !info.creator_address_hash || !isHash(info.creation_transaction_hash)) continue;
    const h = info.creation_transaction_hash.toLowerCase() as TxHash;
    const t = (await fetchTxs("base-sepolia", [h])).get(h);
    const deployer = normalizeAddress(info.creator_address_hash);
    // A creation transaction (no `to`) sent by the deployer itself; factories never qualify.
    if (t && t.succeeded && t.to === "" && t.from === deployer && t.nonce <= MAX_FUNDER_NONCE) deployments.push({ wallet: w, deployer, tx: h });
  }
  for (const d of deployments) {
    if (set.has(d.deployer)) proofs.push(proof(d.wallet, d.deployer, "deployed_by", { creation_tx: d.tx }, `${d.deployer} deployed ${d.wallet} directly`));
  }
  for (let i = 0; i < deployments.length; i++) {
    for (let j = i + 1; j < deployments.length; j++) {
      const [a, b] = [deployments[i]!, deployments[j]!];
      if (a.deployer === b.deployer && !set.has(a.deployer)) {
        proofs.push(proof(a.wallet, b.wallet, "shared_deployer", { subject_creation_tx: a.tx, other_creation_tx: b.tx }, `${a.deployer} deployed both`));
      }
    }
  }

  // --- Native payments between and from parties (Blockscout), checked on the RPC node.
  const out = new Map<Address, Array<{ to: Address; tx: TxHash }>>();
  for (const w of parties) {
    const list = (await transfers(store, w, "from")).filter((t) => t.asset === "ETH" && t.amount >= MIN);
    out.set(w, list.map((t) => ({ to: t.to, tx: t.txHash })));
  }
  const hashes = [...new Set([...out.values()].flat().map((p) => p.tx))];
  const txs = new Map<TxHash, ChainTx>();
  for (let i = 0; i < hashes.length; i += 10) for (const [h, t] of await fetchTxs("base-sepolia", hashes.slice(i, i + 10))) txs.set(h, t);
  const ok = (h: TxHash) => {
    const t = txs.get(h);
    return t && t.succeeded && t.value >= MIN ? t : undefined;
  };

  // Closed loops: a -> b, then b -> a with at least 80% back within a day.
  for (const a of parties) {
    for (const o of out.get(a) ?? []) {
      if (!set.has(o.to) || o.to === a) continue;
      const first = ok(o.tx);
      if (!first) continue;
      const back = (out.get(o.to) ?? [])
        .filter((x) => x.to === a)
        .map((x) => ok(x.tx))
        .find((t) => t && t.value * 100n >= first.value * LOOP_MIN_RETURN_PERCENT && t.block >= first.block && t.block - first.block <= LOOP_WINDOW_BLOCKS && t.nonce <= MAX_FUNDER_NONCE);
      if (back) proofs.push(proof(a, o.to, "closed_loop", { out_tx: first.hash, back_tx: back.hash }, `${a} paid ${o.to}, which sent most of it back within a day`));
    }
  }

  // Shared cash-out: two parties paid the same non-party wallet within 30 days.
  const payersOf = new Map<Address, Array<{ party: Address; tx: ChainTx }>>();
  for (const [party, list] of out) {
    for (const o of list) {
      const t = ok(o.tx);
      if (!t || set.has(o.to)) continue;
      payersOf.set(o.to, [...(payersOf.get(o.to) ?? []), { party, tx: t }]);
    }
  }
  for (const [wallet, payers] of payersOf) {
    const byParty = new Map(payers.map((p) => [p.party, p.tx]));
    const ps = [...byParty.entries()];
    for (let i = 0; i < ps.length; i++) {
      for (let j = i + 1; j < ps.length; j++) {
        const [[a, ta], [b, tb]] = [ps[i]!, ps[j]!];
        if (Math.abs(ta.block - tb.block) > CASHOUT_WINDOW_BLOCKS) continue;
        const after = await laterTxFrom(wallet, Math.max(ta.block, tb.block));
        if (!after) {
          log(`cash-out ${a} + ${b} -> ${wallet}: that wallet has sent nothing since, so it cannot be checked yet`);
          continue;
        }
        if (after.nonce > MAX_FUNDER_NONCE) {
          log(`cash-out ${a} + ${b} -> ${wallet}: skipped, that wallet had sent ${after.nonce} transactions (infrastructure)`);
          continue;
        }
        proofs.push(proof(a, b, "shared_cashout", { subject_tx: ta.hash, other_tx: tb.hash, cashout_tx: after.hash }, `${a} and ${b} both paid ${wallet}`));
      }
    }
  }
  // One proof per pair and kind (a payment can be listed twice, e.g. once per Blockscout page).
  const seen = new Set<string>();
  return proofs.filter((p) => {
    const key = `${p.kind}:${[p.subject, p.other].sort().join(":")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** The earliest transaction sent by `wallet` at or after `block` (Blockscout, newest first). */
async function laterTxFrom(wallet: Address, block: number): Promise<ChainTx | undefined> {
  const page = await blockscoutGet<{ items?: Array<{ hash: string; block_number?: number; block?: number }> }>(`/addresses/${wallet}/transactions`, { filter: "from" }).catch(() => ({ items: [] }));
  const candidates = (page.items ?? []).filter((t) => isHash(t.hash) && (t.block_number ?? t.block ?? 0) >= block);
  const earliest = candidates.at(-1);
  if (!earliest) return undefined;
  const h = earliest.hash.toLowerCase() as TxHash;
  const t = (await fetchTxs("base-sepolia", [h])).get(h);
  return t && t.succeeded && t.from === wallet ? t : undefined;
}

function proof(subject: Address, other: Address, kind: LinkProof["kind"], p: Record<string, string>, explanation: string): LinkProof {
  return { subject, other, kind, proof: p, network: "base-sepolia", source: "blockscout", explanation: `${explanation} (base-sepolia)` };
}
