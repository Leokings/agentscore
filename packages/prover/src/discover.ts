import { blockscoutGet } from "@agentscore/indexer";
import { classifyLabel, NansenBudgetError, type NansenClient } from "@agentscore/links";
import { isAddress, normalizeAddress, type Address, type TxHash } from "@agentscore/shared";
import { checkFirstFunding, fetchTxs, type FundingCheck, type ProofNetwork } from "./rpc.js";

/** One first-funding fact about a wallet: who gave it gas before its nonce-0 transaction. */
export interface FirstFunding {
  wallet: Address;
  funder: Address;
  network: ProofNetwork;
  fundingTx: TxHash;
  firstTx: TxHash;
  /** Where the funder and transactions were found. */
  source: "nansen" | "blockscout";
  funderLabel?: string;
  check: FundingCheck;
}

/** A proof ready for the contract's prove_link(subject, other, kind, proof). */
export interface LinkProof {
  subject: Address;
  other: Address;
  kind: "first_funded_by" | "shared_first_funder";
  proof: Record<string, string>;
  network: ProofNetwork;
  source: FirstFunding["source"];
  explanation: string;
}

const isHash = (v: unknown): v is TxHash => typeof v === "string" && /^0x[0-9a-fA-F]{64}$/.test(v);

/**
 * Base mainnet, via Nansen: related-wallets names the wallet's First Funder and the funding
 * transaction; the transactions endpoint gives the wallet's earliest transactions, one of which is
 * its nonce-0 transaction. Both are then checked against the Base RPC node, as the contract will.
 */
export async function firstFundingFromNansen(nansen: NansenClient, wallet: Address): Promise<FirstFunding | { wallet: Address; error: string }> {
  try {
    const related = await nansen.relatedWallets(wallet, "base");
    const ff = related.find((r) => r.relation.toLowerCase().includes("first funder") && isAddress(r.address));
    if (!ff) return { wallet, error: "Nansen reports no first funder on Base" };
    const funder = normalizeAddress(ff.address);
    const label = ff.address_label ?? undefined;
    if (!isHash(ff.transaction_hash)) return { wallet, error: "Nansen gave no funding transaction hash" };
    const fundingTx = ff.transaction_hash.toLowerCase() as TxHash;

    const earliest = (await nansen.earliestTransactions(wallet, "base")).map((t) => t.transaction_hash).filter(isHash);
    const txs = await fetchTxs("base", [fundingTx, ...earliest.map((h) => h.toLowerCase() as TxHash)]);
    const first = [...txs.values()].find((t) => t.from === wallet && t.nonce === 0);
    let check = checkFirstFunding(wallet, funder, txs.get(fundingTx), first);
    if (check.ok && classifyLabel(label) !== "none") check = { ok: false, reason: `Nansen labels the funder "${label}"` };
    return { wallet, funder, network: "base", fundingTx, firstTx: (first?.hash ?? "0x") as TxHash, source: "nansen", funderLabel: label, check };
  } catch (e) {
    if (e instanceof NansenBudgetError) return { wallet, error: e.message };
    return { wallet, error: `Nansen lookup failed: ${(e as Error).message}` };
  }
}

interface BsTx {
  hash: string;
  nonce: number;
  block_number: number;
  value: string;
  status: string;
  from: { hash: string };
}

async function bsPages(path: string, params: Record<string, string>, maxPages = 6): Promise<BsTx[]> {
  const out: BsTx[] = [];
  let next: Record<string, string | number> | undefined;
  for (let i = 0; i < maxPages; i++) {
    const body = await blockscoutGet<{ items: BsTx[]; next_page_params: Record<string, string | number> | null }>(path, { ...params, ...(next ?? {}) });
    out.push(...body.items);
    if (!body.next_page_params) break;
    next = body.next_page_params;
  }
  return out;
}

/** Base Sepolia, via Blockscout (Nansen does not index testnets). */
export async function firstFundingFromBlockscout(wallet: Address): Promise<FirstFunding | { wallet: Address; error: string }> {
  try {
    const outgoing = await bsPages(`/addresses/${wallet}/transactions`, { filter: "from" });
    const nonce0 = outgoing.find((t) => t.nonce === 0);
    if (!nonce0) return { wallet, error: "wallet has never sent a transaction on Base Sepolia" };
    const incoming = await bsPages(`/addresses/${wallet}/transactions`, { filter: "to" });
    const funding = incoming
      .filter((t) => t.status === "ok" && BigInt(t.value || "0") > 0n && t.block_number <= nonce0.block_number)
      .sort((a, b) => a.block_number - b.block_number)[0];
    if (!funding) return { wallet, error: "no native-value funding before the wallet's first transaction" };
    const fundingTx = funding.hash.toLowerCase() as TxHash;
    const firstTx = nonce0.hash.toLowerCase() as TxHash;
    const funder = normalizeAddress(funding.from.hash);
    const txs = await fetchTxs("base-sepolia", [fundingTx, firstTx]);
    const check = checkFirstFunding(wallet, funder, txs.get(fundingTx), txs.get(firstTx));
    return { wallet, funder, network: "base-sepolia", fundingTx, firstTx, source: "blockscout", check };
  } catch (e) {
    return { wallet, error: `Blockscout lookup failed: ${(e as Error).message}` };
  }
}

/**
 * Turns first-funding facts into contract proofs:
 * - parent links where one known wallet funded another,
 * - sibling links where two known wallets share a (non-infrastructure) funder on the same network.
 */
export function buildProofs(facts: FirstFunding[], known: Set<Address>): LinkProof[] {
  const valid = facts.filter((f) => f.check.ok);
  const proofs: LinkProof[] = [];
  for (const f of valid) {
    if (!known.has(f.funder)) continue;
    proofs.push({
      subject: f.wallet,
      other: f.funder,
      kind: "first_funded_by",
      network: f.network,
      source: f.source,
      proof: { ...(f.network === "base" ? { network: "base" } : {}), funding_tx: f.fundingTx, subject_first_tx: f.firstTx },
      explanation: `${f.funder} gave ${f.wallet} its first funds on ${f.network} (found via ${f.source})`,
    });
  }
  const byFunder = new Map<string, FirstFunding[]>();
  for (const f of valid) {
    const key = `${f.network}:${f.funder}`;
    byFunder.set(key, [...(byFunder.get(key) ?? []), f]);
  }
  for (const group of byFunder.values()) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const [a, b] = [group[i]!, group[j]!];
        if (a.wallet === a.funder || b.wallet === b.funder) continue;
        proofs.push({
          subject: a.wallet,
          other: b.wallet,
          kind: "shared_first_funder",
          network: a.network,
          source: a.source,
          proof: {
            ...(a.network === "base" ? { network: "base" } : {}),
            funder: a.funder,
            subject_funding_tx: a.fundingTx,
            subject_first_tx: a.firstTx,
            other_funding_tx: b.fundingTx,
            other_first_tx: b.firstTx,
          },
          explanation: `${a.funder} gave both ${a.wallet} and ${b.wallet} their first funds on ${a.network} (found via ${a.source})`,
        });
      }
    }
  }
  return proofs;
}
