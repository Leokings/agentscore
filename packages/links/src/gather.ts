import type { Store } from "@agentscore/indexer";
import { isAddress, normalizeAddress, type Address } from "@agentscore/shared";
import { emptyNode, type WalletGraph, type WalletNode } from "./graph.js";
import { classifyInfra, classifyLabel, FAN_OUT_INFRA_THRESHOLD } from "./infra.js";
import { NansenBudgetError, type NansenClient } from "./nansen.js";
import { addressInfo, transfers } from "./testnet.js";

export interface GatherOptions {
  nansen?: NansenClient;
  /** Upper bound on wallets we fetch history for, besides the subject. */
  maxCandidates?: number;
  log?: (msg: string) => void;
}

/** Builds the subject's node from Base Sepolia history. */
async function testnetNode(store: Store, wallet: Address): Promise<WalletNode> {
  const [incoming, outgoing, info] = await Promise.all([
    transfers(store, wallet, "to"),
    transfers(store, wallet, "from"),
    addressInfo(store, wallet),
  ]);
  const node = emptyNode(wallet);
  const firstIn = incoming.find((t) => t.from !== wallet);
  if (firstIn) node.firstFunders.push({ address: firstIn.from, network: "base-sepolia", txHash: firstIn.txHash, timestamp: firstIn.timestamp });
  const seen = new Set<string>();
  for (const t of outgoing) {
    if (t.to === wallet || seen.has(t.to)) continue;
    seen.add(t.to);
    node.outgoing.push({ to: t.to, network: "base-sepolia", txHash: t.txHash, timestamp: t.timestamp });
  }
  if (info.isContract && info.creator) node.deployer = info.creator;
  const times = [...incoming, ...outgoing].map((t) => t.timestamp);
  if (times.length) {
    node.firstSeen = Math.min(...times);
    node.lastActive = Math.max(...times);
  }
  return node;
}

/** Adds Base mainnet relations from Nansen (first funder, deployer, signer, cash-out wallets). */
async function addNansen(nansen: NansenClient, graph: WalletGraph, node: WalletNode, withCounterparties: boolean): Promise<void> {
  const related = await nansen.relatedWallets(node.address, "base");
  for (const r of related) {
    if (!isAddress(r.address)) continue;
    const addr = normalizeAddress(r.address);
    const kind = classifyLabel(r.address_label ?? undefined);
    if (kind !== "none") graph.infra[addr] = { kind, label: r.address_label ?? undefined };
    const rel = r.relation.toLowerCase();
    const ts = r.block_timestamp ? Math.floor(Date.parse(r.block_timestamp) / 1000) : undefined;
    const txHash = r.transaction_hash && /^0x[0-9a-f]{64}$/i.test(r.transaction_hash) ? (r.transaction_hash as `0x${string}`) : undefined;
    if (rel.includes("first funder")) node.firstFunders.push({ address: addr, network: "base", txHash, timestamp: ts });
    else if (rel.includes("signer")) node.signers.push(addr);
    else if (rel.includes("deploy")) node.deployer ??= addr;
  }
  if (!withCounterparties) return;
  const counterparties = await nansen.counterparties(node.address, "base");
  for (const c of counterparties) {
    if (!isAddress(c.counterparty_address)) continue;
    const addr = normalizeAddress(c.counterparty_address);
    const label = c.counterparty_address_label?.join(", ");
    const kind = classifyLabel(label);
    if (kind !== "none") graph.infra[addr] = { kind, label };
    if (c.volume_out_usd > 0 && !node.outgoing.some((o) => o.to === addr)) node.outgoing.push({ to: addr, network: "base" });
  }
}

/** Marks an address as infrastructure if its label or sheer transaction count says so. */
async function checkInfra(store: Store, graph: WalletGraph, addr: Address): Promise<boolean> {
  if (graph.infra[addr]) return graph.infra[addr]!.kind !== "none";
  const info = await addressInfo(store, addr);
  const kind = classifyInfra({ label: info.name, fanOut: info.transactionsCount });
  graph.infra[addr] = { kind, label: info.name };
  return kind !== "none";
}

/**
 * Gathers the subject's neighbourhood: its own history, its funder's other recipients,
 * the other payers of its cash-out wallets, and the history of every candidate found.
 */
export async function gatherGraph(store: Store, subject: Address, opts: GatherOptions = {}): Promise<WalletGraph> {
  const log = opts.log ?? (() => {});
  const maxCandidates = opts.maxCandidates ?? 30;
  const graph: WalletGraph = { subject, nodes: {}, infra: {}, fundedBy: {}, paidBy: {} };

  const s = await testnetNode(store, subject);
  s.cases = await store.casesForWallet(subject);
  graph.nodes[subject] = s;

  if (opts.nansen?.enabled) {
    try {
      await addNansen(opts.nansen, graph, s, true);
    } catch (e) {
      log(`Nansen skipped for subject: ${(e as Error).message}`);
    }
  }

  // Candidates, in priority order: court counterparties, wallets the subject paid, siblings, co-payers.
  const candidates: Address[] = [];
  const push = (a: Address) => {
    if (a !== subject && !candidates.includes(a)) candidates.push(a);
  };
  for (const c of s.cases) for (const p of c.parties) push(p.address);
  for (const f of s.firstFunders) push(f.address);

  for (const o of s.outgoing) {
    if (o.network !== "base-sepolia" || (await checkInfra(store, graph, o.to))) continue;
    push(o.to);
    const payers = (await transfers(store, o.to, "to", 2)).map((t) => t.from).filter((a) => a !== o.to);
    graph.paidBy[o.to] = [...new Set(payers)];
  }

  for (const f of s.firstFunders) {
    if (f.network !== "base-sepolia" || (await checkInfra(store, graph, f.address))) continue;
    const recipients = [...new Set((await transfers(store, f.address, "from", 2)).map((t) => t.to))];
    if (recipients.length > FAN_OUT_INFRA_THRESHOLD) {
      graph.infra[f.address] = { kind: "faucet" };
      continue;
    }
    graph.fundedBy[f.address] = recipients;
    recipients.forEach(push);
  }
  for (const payers of Object.values(graph.paidBy)) payers.forEach(push);

  for (const addr of candidates.slice(0, maxCandidates)) {
    if (graph.infra[addr] && graph.infra[addr]!.kind !== "none") continue;
    const node = await testnetNode(store, addr);
    node.cases = await store.casesForWallet(addr);
    graph.nodes[addr] = node;
    if (opts.nansen?.enabled && node.cases.length > 0) {
      try {
        await addNansen(opts.nansen, graph, node, false);
      } catch (e) {
        if (!(e instanceof NansenBudgetError)) log(`Nansen skipped for ${addr}: ${(e as Error).message}`);
      }
    }
  }
  if (candidates.length > maxCandidates) log(`Candidate list truncated to ${maxCandidates} of ${candidates.length}`);
  return graph;
}
