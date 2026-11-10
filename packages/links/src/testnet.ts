import { blockscoutGet, type Store } from "@agentscore/indexer";
import { normalizeAddress, type Address, type TxHash } from "@agentscore/shared";

/**
 * Base Sepolia wallet history from Blockscout. Nansen does not index testnets, so this is
 * where links between Internet Court agents (which live on Base Sepolia today) come from.
 */

export interface Transfer {
  from: Address;
  to: Address;
  /** Native value in wei, or token amount in base units. */
  amount: bigint;
  asset: string;
  txHash: TxHash;
  timestamp: number;
  toIsContract: boolean;
}

export interface AddressInfo {
  address: Address;
  isContract: boolean;
  name?: string;
  creator?: Address;
  transactionsCount?: number;
}

interface BsParty {
  hash: string;
  is_contract?: boolean;
  name?: string | null;
}
interface BsTx {
  hash: TxHash;
  from: BsParty;
  to: BsParty | null;
  value: string;
  timestamp: string;
  status?: string;
}
interface BsTokenTransfer {
  from: BsParty;
  to: BsParty;
  total?: { value?: string };
  token?: { symbol?: string; address_hash?: string; address?: string };
  transaction_hash: TxHash;
  timestamp: string;
}
interface BsPage<T> {
  items: T[];
  next_page_params: Record<string, string | number> | null;
}

const TTL = 15 * 60 * 1000;

async function cached<T>(store: Store, key: string, load: () => Promise<T>): Promise<T> {
  const hit = await store.cacheGet<T>(key);
  if (hit !== undefined) return hit;
  const value = await load();
  await store.cacheSet(key, value, TTL);
  return value;
}

async function pages<T>(path: string, params: Record<string, string>, maxPages: number): Promise<T[]> {
  const out: T[] = [];
  let next: Record<string, string | number> | undefined;
  for (let i = 0; i < maxPages; i++) {
    const body: BsPage<T> = await blockscoutGet(path, { ...params, ...(next ?? {}) });
    out.push(...body.items);
    if (!body.next_page_params) break;
    next = body.next_page_params;
  }
  return out;
}

type SerializedTransfer = Omit<Transfer, "amount"> & { amount: string };
const ser = (t: Transfer): SerializedTransfer => ({ ...t, amount: t.amount.toString() });
const de = (t: SerializedTransfer): Transfer => ({ ...t, amount: BigInt(t.amount) });

/** Native-value transfers and ERC-20 transfers in one direction, oldest first. */
export async function transfers(store: Store, wallet: Address, direction: "to" | "from", maxPages = 4): Promise<Transfer[]> {
  const key = `bs:transfers:${wallet}:${direction}:${maxPages}`;
  const list = await cached(store, key, async () => {
    const [txs, tokens] = await Promise.all([
      pages<BsTx>(`/addresses/${wallet}/transactions`, { filter: direction }, maxPages),
      pages<BsTokenTransfer>(`/addresses/${wallet}/token-transfers`, { filter: direction, type: "ERC-20" }, maxPages),
    ]);
    const out: Transfer[] = [];
    for (const tx of txs) {
      if (!tx.to || tx.status === "error" || BigInt(tx.value || "0") === 0n) continue;
      out.push({
        from: normalizeAddress(tx.from.hash),
        to: normalizeAddress(tx.to.hash),
        amount: BigInt(tx.value),
        asset: "ETH",
        txHash: tx.hash,
        timestamp: Math.floor(Date.parse(tx.timestamp) / 1000),
        toIsContract: !!tx.to.is_contract,
      });
    }
    for (const t of tokens) {
      const value = BigInt(t.total?.value || "0");
      if (value === 0n) continue;
      out.push({
        from: normalizeAddress(t.from.hash),
        to: normalizeAddress(t.to.hash),
        amount: value,
        asset: t.token?.symbol || t.token?.address_hash || t.token?.address || "TOKEN",
        txHash: t.transaction_hash,
        timestamp: Math.floor(Date.parse(t.timestamp) / 1000),
        toIsContract: !!t.to.is_contract,
      });
    }
    return out.sort((a, b) => a.timestamp - b.timestamp).map(ser);
  });
  return list.map(de);
}

export async function addressInfo(store: Store, wallet: Address): Promise<AddressInfo> {
  return cached(store, `bs:info:${wallet}`, async () => {
    const [info, counters] = await Promise.all([
      blockscoutGet<{ is_contract?: boolean; name?: string | null; creator_address_hash?: string | null }>(`/addresses/${wallet}`).catch(
        () => ({}) as { is_contract?: boolean; name?: string | null; creator_address_hash?: string | null },
      ),
      blockscoutGet<{ transactions_count?: string }>(`/addresses/${wallet}/counters`).catch(() => ({}) as { transactions_count?: string }),
    ]);
    return {
      address: wallet,
      isContract: !!info.is_contract,
      name: info.name ?? undefined,
      creator: info.creator_address_hash ? normalizeAddress(info.creator_address_hash) : undefined,
      transactionsCount: counters.transactions_count ? Number(counters.transactions_count) : undefined,
    };
  });
}
