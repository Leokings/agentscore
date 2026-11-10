import { syncInternetCourt, type Store } from "@agentscore/indexer";
import type { NansenClient } from "@agentscore/links";
import { buildProofs, firstFundingFromBlockscout, firstFundingFromNansen, type AgentScoreChain, type FirstFunding, type LinkProof, type TxOutcome } from "@agentscore/prover";
import type { Address } from "@agentscore/shared";
import { isDue, isJudgeable, type Attempt } from "./plan.js";

export interface KeeperDeps {
  store: Store;
  chain: AgentScoreChain;
  nansen?: NansenClient;
  /** Brings the Internet Court index up to date. Defaults to the indexer's sync. */
  sync?: (store: Store) => Promise<unknown>;
  /** Finds first-funding facts for a wallet. Defaults to Blockscout (testnet) + Nansen (mainnet). */
  discover?: (wallet: Address) => Promise<FirstFunding[]>;
  log?: (msg: string) => void;
  dryRun?: boolean;
  /** Upper bound on contract writes per pass (StudioNet rate-limits per IP). */
  maxWrites?: number;
  now?: () => number;
}

export interface KeeperReport {
  judged: string[];
  alreadyOnChain: string[];
  linksProven: string[];
  failed: Array<{ item: string; error: string }>;
  wouldWrite: string[];
  writes: number;
}

const caseKey = (c: string) => `keeper:case:${c}`;
const linkKey = (a: string, b: string) => `keeper:link:${[a, b].sort().join(":")}`;

async function getAttempt(store: Store, key: string): Promise<Attempt | undefined> {
  const raw = await store.getMeta(key);
  return raw ? (JSON.parse(raw) as Attempt) : undefined;
}

async function setAttempt(store: Store, key: string, a: Attempt): Promise<void> {
  await store.setMeta(key, JSON.stringify(a));
}

/** A read-back that cannot itself fail the pass: an unreadable result counts as not stored. */
async function readBack(check: () => Promise<boolean>): Promise<boolean> {
  try {
    return await check();
  } catch {
    return false;
  }
}

function describeError(outcome: TxOutcome | undefined, e?: unknown): string {
  if (e) return `network: ${(e as Error).message.split("\n")[0]}`;
  if (outcome?.error) return outcome.error;
  return `not stored (leader ${outcome?.leader ?? "UNKNOWN"}, status ${outcome?.status ?? "UNKNOWN"})`;
}

/** One pass: judge newly ruled cases, then prove newly discoverable links. Safe to run repeatedly. */
export async function runOnce(deps: KeeperDeps): Promise<KeeperReport> {
  const { store, chain } = deps;
  const log = deps.log ?? (() => {});
  const now = deps.now ?? Date.now;
  const maxWrites = deps.maxWrites ?? 20;
  const report: KeeperReport = { judged: [], alreadyOnChain: [], linksProven: [], failed: [], wouldWrite: [], writes: 0 };
  const canWrite = () => report.writes < maxWrites;

  await (deps.sync ?? syncInternetCourt)(store);
  const cases = await store.allCases();

  // 1. Judge every ruled case the contract has not judged yet.
  const judgedParties = new Set<Address>();
  for (const c of cases.filter(isJudgeable)) {
    const key = caseKey(c.address);
    const attempt = await getAttempt(store, key);
    if (attempt?.outcome === "stored") {
      c.parties.forEach((p) => judgedParties.add(p.address));
      continue;
    }
    if (!isDue(attempt, now())) continue;
    if (await chain.isJudged(c.address)) {
      await setAttempt(store, key, { at: now(), outcome: "stored" });
      report.alreadyOnChain.push(c.address);
      c.parties.forEach((p) => judgedParties.add(p.address));
      continue;
    }
    if (deps.dryRun) {
      report.wouldWrite.push(`judge case #${c.id} ${c.address}`);
      continue;
    }
    if (!canWrite()) break;
    let outcome: TxOutcome | undefined;
    let err: unknown;
    try {
      report.writes++;
      outcome = await chain.judgeCase(c.address);
    } catch (e) {
      err = e;
    }
    // Read back even after a network error: the transaction may have gone through anyway.
    const stored = await readBack(() => chain.isJudged(c.address));
    if (stored) {
      await setAttempt(store, key, { at: now(), outcome: "stored", tx: outcome?.tx });
      report.judged.push(c.address);
      c.parties.forEach((p) => judgedParties.add(p.address));
      log(`judged case #${c.id} ${c.address} (tx ${outcome?.tx})`);
    } else {
      const error = describeError(outcome, err);
      await setAttempt(store, key, { at: now(), outcome: "failed", tx: outcome?.tx, error });
      report.failed.push({ item: `case #${c.id} ${c.address}`, error });
      log(`case #${c.id} ${c.address} not judged: ${error}`);
    }
  }

  // 2. Prove links between parties of judged cases (and the wallets that funded them).
  const known = new Set<Address>(cases.flatMap((c) => c.parties.map((p) => p.address)));
  const discover =
    deps.discover ??
    (async (w: Address) => {
      const out: FirstFunding[] = [];
      const bs = await firstFundingFromBlockscout(w);
      if (!("error" in bs)) out.push(bs);
      if (deps.nansen?.enabled) {
        const ns = await firstFundingFromNansen(deps.nansen, w);
        if (!("error" in ns)) out.push(ns);
      }
      return out;
    });
  const facts: FirstFunding[] = [];
  for (const w of judgedParties) facts.push(...(await discover(w)));
  const proofs: LinkProof[] = buildProofs(facts, known);

  for (const p of proofs) {
    const key = linkKey(p.subject, p.other);
    const attempt = await getAttempt(store, key);
    if (attempt?.outcome === "stored" || !isDue(attempt, now())) continue;
    if (p.other in (await chain.links(p.subject))) {
      await setAttempt(store, key, { at: now(), outcome: "stored" });
      continue;
    }
    if (deps.dryRun) {
      report.wouldWrite.push(`prove ${p.kind} ${p.subject} ↔ ${p.other} (${p.network}, via ${p.source})`);
      continue;
    }
    if (!canWrite()) break;
    let outcome: TxOutcome | undefined;
    let err: unknown;
    try {
      report.writes++;
      outcome = await chain.proveLink(p);
    } catch (e) {
      err = e;
    }
    const stored = await readBack(async () => p.other in (await chain.links(p.subject)));
    if (stored) {
      await setAttempt(store, key, { at: now(), outcome: "stored", tx: outcome?.tx });
      report.linksProven.push(`${p.subject} ↔ ${p.other}`);
      log(`proved ${p.kind} ${p.subject} ↔ ${p.other} (tx ${outcome?.tx})`);
    } else {
      const error = describeError(outcome, err);
      await setAttempt(store, key, { at: now(), outcome: "failed", tx: outcome?.tx, error });
      report.failed.push({ item: `link ${p.subject} ↔ ${p.other}`, error });
      log(`link ${p.subject} ↔ ${p.other} not stored: ${error}`);
    }
  }

  return report;
}
