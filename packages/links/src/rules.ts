import type { Address, LinkEvidence, LinkStrength, LinkType, WalletLink } from "@agentscore/shared";
import type { WalletGraph, WalletNode } from "./graph.js";

const DAY = 86_400;
/** Two wallets funded by the same wallet within this window are a strong sibling link. */
export const SIBLING_STRONG_WINDOW = DAY;
/** A linked wallet that went quiet no later than this after the subject appeared may be its predecessor. */
export const SUCCESSOR_WINDOW = 3 * DAY;

const RANK: Record<LinkStrength, number> = { weak: 0, medium: 1, strong: 2 };
/** Link types that say "probably the same owner". Used by the fake-win and successor rules. */
const OWNERSHIP_TYPES: LinkType[] = ["shared_funder", "funded_by", "funded", "shared_cashout", "same_deployer", "same_signer"];

class LinkSet {
  private readonly map = new Map<string, WalletLink>();

  add(type: LinkType, other: Address, direction: WalletLink["direction"], strength: LinkStrength, evidence: LinkEvidence): void {
    const key = `${type}:${other}`;
    const existing = this.map.get(key);
    if (!existing) {
      this.map.set(key, { type, other, direction, strength, evidence: [evidence] });
      return;
    }
    if (RANK[strength] > RANK[existing.strength]) existing.strength = strength;
    if (!existing.evidence.some((e) => e.description === evidence.description)) existing.evidence.push(evidence);
  }

  ownershipLinkTo(other: Address): WalletLink | undefined {
    let best: WalletLink | undefined;
    for (const l of this.map.values()) {
      if (l.other !== other || !OWNERSHIP_TYPES.includes(l.type) || l.strength === "weak") continue;
      if (!best || RANK[l.strength] > RANK[best.strength]) best = l;
    }
    return best;
  }

  list(): WalletLink[] {
    return [...this.map.values()].sort((a, b) => RANK[b.strength] - RANK[a.strength] || a.type.localeCompare(b.type) || a.other.localeCompare(b.other));
  }
}

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/**
 * Derives typed links between the subject and other wallets. Pure and deterministic:
 * the same graph always gives the same links, so the GenLayer contract can rely on them.
 */
export function buildLinks(graph: WalletGraph): WalletLink[] {
  const S = graph.subject;
  const subject = graph.nodes[S];
  if (!subject) return [];
  const isInfra = (a: string) => {
    const k = graph.infra[a]?.kind;
    return k !== undefined && k !== "none";
  };
  const others = Object.values(graph.nodes).filter((n) => n.address !== S);
  const links = new LinkSet();

  // #2 parent: who funded the subject first.
  for (const f of subject.firstFunders) {
    if (isInfra(f.address) || f.address === S) continue;
    links.add("funded_by", f.address, "other_initiated", "strong", {
      description: `${short(f.address)} sent this wallet its first funds`,
      txHash: f.txHash,
      network: f.network,
    });
  }

  // #2 child: wallets whose first funds came from the subject.
  for (const o of others) {
    for (const f of o.firstFunders) {
      if (f.address !== S) continue;
      links.add("funded", o.address, "subject_initiated", "strong", {
        description: `This wallet sent ${short(o.address)} its first funds`,
        txHash: f.txHash,
        network: f.network,
      });
    }
  }

  // #1 siblings: the same (non-infrastructure) wallet funded both.
  for (const f of subject.firstFunders) {
    if (isInfra(f.address)) continue;
    for (const o of others) {
      if (o.address === f.address) continue;
      const theirs = o.firstFunders.find((g) => g.address === f.address);
      if (!theirs) continue;
      const close = f.timestamp !== undefined && theirs.timestamp !== undefined && Math.abs(f.timestamp - theirs.timestamp) <= SIBLING_STRONG_WINDOW;
      links.add("shared_funder", o.address, "shared", close ? "strong" : "medium", {
        description: `Both were first funded by ${short(f.address)}${close ? " within 24 hours" : ""}`,
        via: f.address,
        network: f.network,
      });
    }
    for (const sibling of graph.fundedBy[f.address] ?? []) {
      if (sibling === S || sibling === f.address || graph.nodes[sibling]) continue;
      links.add("shared_funder", sibling, "shared", "medium", {
        description: `${short(f.address)} also sent funds to this wallet`,
        via: f.address,
        network: f.network,
      });
    }
  }

  // #3 shared cash-out: both send value to the same private wallet.
  const isAgent = (a: string) => (graph.nodes[a]?.cases.length ?? 0) > 0;
  const destinations = new Set(subject.outgoing.map((o) => o.to).filter((d) => d !== S && !isInfra(d) && !isAgent(d)));
  for (const d of destinations) {
    const payers = new Set<Address>([
      ...others.filter((o) => o.outgoing.some((x) => x.to === d)).map((o) => o.address),
      ...(graph.paidBy[d] ?? []),
    ]);
    for (const p of payers) {
      if (p === S || p === d) continue;
      links.add("shared_cashout", p, "shared", "strong", {
        description: `Both send funds to ${short(d)}`,
        via: d,
      });
    }
  }

  // #4 same deployer / signer.
  for (const o of others) {
    if (subject.deployer && o.deployer === subject.deployer && !isInfra(subject.deployer)) {
      links.add("same_deployer", o.address, "shared", "strong", { description: `Both deployed by ${short(subject.deployer)}`, via: subject.deployer });
    }
    for (const s of subject.signers) {
      if (o.signers.includes(s)) links.add("same_signer", o.address, "shared", "strong", { description: `Both controlled by signer ${short(s)}`, via: s });
    }
  }

  // #5 fake wins: a court counterparty is linked to the subject.
  for (const c of subject.cases) {
    for (const p of c.parties) {
      if (p.address === S) continue;
      const owner = links.ownershipLinkTo(p.address);
      if (!owner) continue;
      links.add("linked_counterparty", p.address, "shared", owner.strength, {
        description: `Case #${c.id}: the other party is linked to this wallet (${owner.type.replace("_", " ")})`,
      });
    }
  }

  // #6 closed loops: value goes S -> X -> S or S -> X -> Y -> S.
  const out = (n: WalletNode | undefined) => new Set((n?.outgoing ?? []).map((o) => o.to).filter((a) => !isInfra(a)));
  const outS = out(subject);
  for (const x of outS) {
    const outX = out(graph.nodes[x]);
    if (outX.has(S)) {
      links.add("closed_loop", x as Address, "subject_initiated", "medium", { description: `Funds went to ${short(x)} and came back` });
    }
    for (const y of outX) {
      if (y === S || y === x) continue;
      if (out(graph.nodes[y]).has(S)) {
        links.add("closed_loop", x as Address, "subject_initiated", "medium", {
          description: `Funds went around ${short(x)} → ${short(y)} and back`,
          via: y as Address,
        });
      }
    }
  }

  // #7 successor: a linked wallet with ruled cases went quiet around when the subject appeared.
  if (subject.firstSeen !== undefined) {
    for (const o of others) {
      const owner = links.ownershipLinkTo(o.address);
      if (!owner) continue;
      const ruled = o.cases.filter((c) => c.verdictCode !== undefined);
      if (ruled.length === 0 || o.lastActive === undefined) continue;
      if (o.lastActive <= subject.firstSeen + SUCCESSOR_WINDOW) {
        links.add("successor_of", o.address, "shared", owner.strength, {
          description: `${short(o.address)} has ${ruled.length} ruled case(s) and went quiet as this wallet appeared`,
        });
      }
    }
  }

  return links.list();
}
