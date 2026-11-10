import { INTERNET_COURT, type Address, type CourtRecord } from "@agentscore/shared";
import { factoryEventsAbi } from "./abi.js";
import { fetchAllLogs, type RawLog } from "./blockscout.js";
import { readCaseDetails } from "./cases.js";
import { baseSepoliaClient } from "./chain.js";
import { applyEvents, decodeFactoryLog } from "./events.js";
import type { Store } from "./store.js";

const LAST_BLOCK_KEY = "ic_last_block";
/** Past this many blocks behind, re-reading the history from Blockscout is cheaper than RPC windows. */
const MAX_RPC_GAP = 20_000;
/** Re-read open cases at most this often. */
const OPEN_CASE_REFRESH_MS = 10 * 60 * 1000;

export interface SyncResult {
  mode: "backfill" | "poll";
  events: number;
  enriched: number;
  fromBlock: number;
  toBlock: number;
}

export interface SyncOptions {
  log?: (msg: string) => void;
}

/** Brings the local database up to date with the Internet Court factory. Safe to run repeatedly. */
export async function syncInternetCourt(store: Store, opts: SyncOptions = {}): Promise<SyncResult> {
  const log = opts.log ?? (() => {});
  const client = baseSepoliaClient();
  const head = Number(await client.getBlockNumber());
  const last = Number((await store.getMeta(LAST_BLOCK_KEY)) ?? 0);

  let mode: SyncResult["mode"];
  let logs: RawLog[];
  let fromBlock: number;

  if (!last || head - last > MAX_RPC_GAP) {
    mode = "backfill";
    fromBlock = INTERNET_COURT.factoryDeploymentBlock;
    log(`Backfilling factory history from Blockscout (head ${head})`);
    logs = await fetchAllLogs(INTERNET_COURT.factory);
  } else {
    mode = "poll";
    fromBlock = last + 1;
    log(`Polling blocks ${fromBlock}..${head} in ${INTERNET_COURT.maxLogBlockRange}-block windows`);
    logs = [];
    for (let start = fromBlock; start <= head; start += INTERNET_COURT.maxLogBlockRange) {
      const end = Math.min(start + INTERNET_COURT.maxLogBlockRange - 1, head);
      const batch = await client.getLogs({
        address: INTERNET_COURT.factory,
        events: factoryEventsAbi,
        fromBlock: BigInt(start),
        toBlock: BigInt(end),
      });
      for (const l of batch) {
        logs.push({
          topics: l.topics as RawLog["topics"],
          data: l.data,
          blockNumber: Number(l.blockNumber),
          transactionHash: l.transactionHash,
          logIndex: Number(l.logIndex),
        });
      }
    }
  }

  const events = logs.map(decodeFactoryLog).filter((e) => e !== undefined);
  await applyEvents(store, events);
  // Blockscout can trail the chain by a few blocks, so keep a small overlap for the next poll.
  await store.setMeta(LAST_BLOCK_KEY, String(mode === "backfill" ? Math.max(head - 50, fromBlock) : head));
  log(`Applied ${events.length} factory events`);

  const toEnrich = await store.casesNeedingEnrichment(OPEN_CASE_REFRESH_MS);
  for (const c of toEnrich) {
    const details = await readCaseDetails(c.address, c.createdTx);
    await store.setParties(c.address, details.parties);
    await store.saveEnrichment(c.address, details);
    log(`Read case ${c.address} as ${details.contractType} (${details.parties.length} parties)`);
  }

  return { mode, events: events.length, enriched: toEnrich.length, fromBlock, toBlock: head };
}

/** Every Internet Court case where the wallet is a party, with simple totals. */
export async function courtRecord(store: Store, wallet: Address): Promise<CourtRecord> {
  const cases = await store.casesForWallet(wallet);
  const ruled = cases.filter((c) => c.verdictCode !== undefined).length;
  const disputed = cases.filter((c) => c.disputed).length;
  return {
    wallet,
    cases,
    totals: { cases: cases.length, disputed, ruled, pendingRuling: cases.filter((c) => c.disputed && c.verdictCode === undefined).length },
    indexedToBlock: Number((await store.getMeta(LAST_BLOCK_KEY)) ?? 0),
  };
}
