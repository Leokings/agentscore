import { INTERNET_COURT, type Address, type TxHash } from "@agentscore/shared";
import type { Hex } from "viem";

/** A log in the raw shape viem can decode. */
export interface RawLog {
  topics: [Hex, ...Hex[]];
  data: Hex;
  blockNumber: number;
  transactionHash: TxHash;
  logIndex: number;
}

interface BlockscoutLogItem {
  topics: Array<Hex | null>;
  data: Hex;
  block_number: number;
  transaction_hash: TxHash;
  index: number;
}

interface BlockscoutPage<T> {
  items: T[];
  next_page_params: Record<string, string | number> | null;
}

export async function blockscoutGet<T>(path: string, params?: Record<string, string | number>): Promise<T> {
  const url = new URL(`${INTERNET_COURT.blockscoutApi}${path}`);
  for (const [k, v] of Object.entries(params ?? {})) url.searchParams.set(k, String(v));
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (res.ok) return (await res.json()) as T;
    if (attempt >= 3 || (res.status !== 429 && res.status < 500)) {
      throw new Error(`Blockscout ${res.status} for ${url.pathname}`);
    }
    await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
  }
}

/** Every log an address has emitted, oldest first. Used to backfill the factory history. */
export async function fetchAllLogs(address: Address, maxPages = 200): Promise<RawLog[]> {
  const out: RawLog[] = [];
  let params: Record<string, string | number> | undefined;
  for (let page = 0; page < maxPages; page++) {
    const body: BlockscoutPage<BlockscoutLogItem> = await blockscoutGet(`/addresses/${address}/logs`, params);
    for (const item of body.items) {
      const topics = item.topics.filter((t): t is Hex => !!t);
      if (topics.length === 0) continue;
      out.push({
        topics: topics as [Hex, ...Hex[]],
        data: item.data,
        blockNumber: Number(item.block_number),
        transactionHash: item.transaction_hash,
        logIndex: Number(item.index),
      });
    }
    if (!body.next_page_params) break;
    params = body.next_page_params;
  }
  return out.sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex);
}
