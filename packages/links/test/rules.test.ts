import { describe, expect, it } from "vitest";
import type { Address, CourtCase } from "@agentscore/shared";
import { buildLinks, emptyNode, type WalletGraph, type WalletNode } from "../src/index.js";

const addr = (n: number) => `0x${n.toString(16).padStart(40, "0")}` as Address;
const S = addr(1);
const FUNDER = addr(2);
const SIBLING = addr(3);
const CHILD = addr(4);
const CASHOUT = addr(5);
const COPAYER = addr(6);
const FAUCET = addr(7);
const STRANGER = addr(8);
const OLD = addr(9);
const LOOP = addr(10);
const DEPLOYER = addr(11);

const T0 = 1_790_000_000;

function node(a: Address, patch: Partial<WalletNode> = {}): WalletNode {
  return { ...emptyNode(a), ...patch };
}

function courtCase(id: number, parties: Address[], ruled = true): CourtCase & { role: string } {
  return {
    id,
    address: addr(1000 + id),
    kind: "agreement",
    contractType: "Agreement",
    parties: parties.map((p, i) => ({ role: i === 0 ? "partyA" : "partyB", address: p })),
    createdBlock: 1,
    disputed: true,
    verdictCode: ruled ? 1 : undefined,
    role: "partyA",
  };
}

function graph(nodes: WalletNode[], extra: Partial<WalletGraph> = {}): WalletGraph {
  return { subject: S, nodes: Object.fromEntries(nodes.map((n) => [n.address, n])), infra: {}, fundedBy: {}, paidBy: {}, ...extra };
}

const find = (links: ReturnType<typeof buildLinks>, type: string, other: Address) => links.find((l) => l.type === type && l.other === other);

describe("buildLinks", () => {
  it("finds the parent, a strong sibling and a child", () => {
    const links = buildLinks(
      graph([
        node(S, { firstFunders: [{ address: FUNDER, network: "base-sepolia", timestamp: T0 }] }),
        node(SIBLING, { firstFunders: [{ address: FUNDER, network: "base-sepolia", timestamp: T0 + 3600 }] }),
        node(CHILD, { firstFunders: [{ address: S, network: "base-sepolia", timestamp: T0 + 100 }] }),
      ]),
    );
    expect(find(links, "funded_by", FUNDER)?.strength).toBe("strong");
    expect(find(links, "shared_funder", SIBLING)?.strength).toBe("strong");
    expect(find(links, "funded", CHILD)?.direction).toBe("subject_initiated");
  });

  it("marks siblings funded far apart as medium", () => {
    const links = buildLinks(
      graph([
        node(S, { firstFunders: [{ address: FUNDER, network: "base-sepolia", timestamp: T0 }] }),
        node(SIBLING, { firstFunders: [{ address: FUNDER, network: "base-sepolia", timestamp: T0 + 30 * 86_400 }] }),
      ]),
    );
    expect(find(links, "shared_funder", SIBLING)?.strength).toBe("medium");
  });

  it("ignores links through faucets and exchanges", () => {
    const links = buildLinks(
      graph(
        [
          node(S, { firstFunders: [{ address: FAUCET, network: "base-sepolia", timestamp: T0 }], outgoing: [{ to: FAUCET, network: "base-sepolia" }] }),
          node(STRANGER, { firstFunders: [{ address: FAUCET, network: "base-sepolia", timestamp: T0 }], outgoing: [{ to: FAUCET, network: "base-sepolia" }] }),
        ],
        { infra: { [FAUCET]: { kind: "faucet" } } },
      ),
    );
    expect(links).toEqual([]);
  });

  it("finds a shared cash-out wallet, including payers we only know from the destination", () => {
    const links = buildLinks(
      graph([node(S, { outgoing: [{ to: CASHOUT, network: "base-sepolia" }] })], { paidBy: { [CASHOUT]: [S, COPAYER] } }),
    );
    expect(find(links, "shared_cashout", COPAYER)?.strength).toBe("strong");
  });

  it("finds same deployer and same signer", () => {
    const links = buildLinks(
      graph([node(S, { deployer: DEPLOYER, signers: [FUNDER] }), node(SIBLING, { deployer: DEPLOYER, signers: [FUNDER] })]),
    );
    expect(find(links, "same_deployer", SIBLING)).toBeDefined();
    expect(find(links, "same_signer", SIBLING)).toBeDefined();
  });

  it("flags a court win against a linked wallet as a possible fake win", () => {
    const links = buildLinks(
      graph([
        node(S, { firstFunders: [{ address: FUNDER, network: "base-sepolia", timestamp: T0 }], cases: [courtCase(1, [S, SIBLING])] }),
        node(SIBLING, { firstFunders: [{ address: FUNDER, network: "base-sepolia", timestamp: T0 + 60 }] }),
      ]),
    );
    const fake = find(links, "linked_counterparty", SIBLING);
    expect(fake?.strength).toBe("strong");
    expect(fake?.evidence[0]?.description).toContain("Case #1");
  });

  it("does not flag a court counterparty with no ownership link", () => {
    const links = buildLinks(graph([node(S, { cases: [courtCase(1, [S, STRANGER])] }), node(STRANGER)]));
    expect(find(links, "linked_counterparty", STRANGER)).toBeUndefined();
  });

  it("finds two- and three-step closed loops", () => {
    const links = buildLinks(
      graph([
        node(S, { outgoing: [{ to: LOOP, network: "base-sepolia" }, { to: SIBLING, network: "base-sepolia" }] }),
        node(LOOP, { outgoing: [{ to: S, network: "base-sepolia" }] }),
        node(SIBLING, { outgoing: [{ to: CHILD, network: "base-sepolia" }] }),
        node(CHILD, { outgoing: [{ to: S, network: "base-sepolia" }] }),
      ]),
    );
    expect(find(links, "closed_loop", LOOP)).toBeDefined();
    expect(find(links, "closed_loop", SIBLING)?.evidence[0]?.via).toBe(CHILD);
  });

  it("flags the subject as a successor of a linked wallet with ruled cases that went quiet", () => {
    const links = buildLinks(
      graph([
        node(S, { firstFunders: [{ address: OLD, network: "base-sepolia", timestamp: T0 }], firstSeen: T0 }),
        node(OLD, { cases: [courtCase(2, [OLD, STRANGER]), courtCase(3, [OLD, STRANGER])], lastActive: T0 }),
      ]),
    );
    expect(find(links, "successor_of", OLD)?.strength).toBe("strong");
  });

  it("does not call a still-active parent a predecessor", () => {
    const links = buildLinks(
      graph([
        node(S, { firstFunders: [{ address: OLD, network: "base-sepolia", timestamp: T0 }], firstSeen: T0 }),
        node(OLD, { cases: [courtCase(2, [OLD, STRANGER])], lastActive: T0 + 60 * 86_400 }),
      ]),
    );
    expect(find(links, "successor_of", OLD)).toBeUndefined();
  });

  it("is deterministic", () => {
    const g = graph([
      node(S, { firstFunders: [{ address: FUNDER, network: "base-sepolia", timestamp: T0 }], outgoing: [{ to: CASHOUT, network: "base-sepolia" }] }),
      node(SIBLING, { firstFunders: [{ address: FUNDER, network: "base-sepolia", timestamp: T0 }], outgoing: [{ to: CASHOUT, network: "base-sepolia" }] }),
    ]);
    expect(JSON.stringify(buildLinks(g))).toBe(JSON.stringify(buildLinks(structuredClone(g))));
  });
});
