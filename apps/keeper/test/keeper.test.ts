import { beforeEach, describe, expect, it } from "vitest";
import { Store } from "@agentscore/indexer";
import type { AgentScoreChain, FirstFunding, LinkProof, TxOutcome } from "@agentscore/prover";
import type { Address, CourtCase, TxHash } from "@agentscore/shared";
import { isDue, isJudgeable, retryAt, RETRY_TRANSIENT_MS } from "../src/plan.js";
import { runOnce } from "../src/run.js";

const a = (n: number) => `0x${n.toString(16).padStart(40, "0")}` as Address;
const h = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as TxHash;

/** An in-memory AgentScore contract with scriptable failures. */
class FakeChain implements AgentScoreChain {
  judged = new Set<string>();
  links_ = new Map<string, Record<string, string>>();
  writes: string[] = [];
  failNext: Record<string, string> = {};

  async isJudged(c: Address) {
    return this.judged.has(c);
  }
  async links(w: Address) {
    return this.links_.get(w) ?? {};
  }
  async judgeCase(c: Address): Promise<TxOutcome> {
    this.writes.push(`judge ${c}`);
    const error = this.failNext[c];
    if (error) {
      delete this.failNext[c];
      return { tx: "0xfail", status: "FINALIZED", leader: "ERROR", error };
    }
    this.judged.add(c);
    return { tx: `0xjudge${this.writes.length}`, status: "FINALIZED", leader: "SUCCESS" };
  }
  async proveLink(p: LinkProof): Promise<TxOutcome> {
    this.writes.push(`link ${p.subject} ${p.other}`);
    for (const [x, y] of [[p.subject, p.other], [p.other, p.subject]] as const) this.links_.set(x, { ...(this.links_.get(x) ?? {}), [y]: "proven" });
    return { tx: "0xlink", status: "FINALIZED", leader: "SUCCESS" };
  }
}

function agreementCase(id: number, partyA: Address, partyB: Address, ruled = true): CourtCase {
  return {
    id,
    address: a(0xca5e0 + id),
    kind: "agreement",
    contractType: "Agreement",
    parties: [
      { role: "partyA", address: partyA },
      { role: "partyB", address: partyB },
    ],
    status: ruled ? "RESOLVED" : "ACTIVE",
    statementVerdict: ruled ? "TRUE" : "UNDETERMINED",
    createdBlock: 1,
    disputed: ruled,
    verdictCode: ruled ? 1 : undefined,
  };
}

async function seed(store: Store, cases: CourtCase[]) {
  for (const c of cases) {
    await store.upsertCaseCreated({ id: c.id, address: c.address, kind: c.kind, createdBlock: 1 });
    await store.setParties(c.address, c.parties);
    await store.saveEnrichment(c.address, { contractType: c.contractType, status: c.status, statementVerdict: c.statementVerdict });
    if (c.verdictCode !== undefined) await store.setVerdict(c.address, c.verdictCode, 2);
    await store.saveEnrichment(c.address, { contractType: c.contractType, status: c.status, statementVerdict: c.statementVerdict });
  }
}

const noSync = async () => {};
const fact = (wallet: Address, funder: Address, n: number): FirstFunding => ({
  wallet,
  funder,
  network: "base-sepolia",
  fundingTx: h(100 + n),
  firstTx: h(200 + n),
  source: "blockscout",
  check: { ok: true },
});

describe("plan", () => {
  it("judges only ruled cases of supported types", () => {
    expect(isJudgeable(agreementCase(1, a(1), a(2)))).toBe(true);
    expect(isJudgeable(agreementCase(2, a(1), a(2), false))).toBe(false);
    expect(isJudgeable({ ...agreementCase(3, a(1), a(2)), contractType: "unknown" })).toBe(false);
  });

  it("never retries permanent errors, retries outages after 30 minutes", () => {
    expect(retryAt({ at: 0, outcome: "failed", error: "[EXPECTED] unsupported_case_type" })).toBe(Infinity);
    expect(retryAt({ at: 0, outcome: "failed", error: "[TRANSIENT] rpc_status_503" })).toBe(RETRY_TRANSIENT_MS);
    expect(isDue({ at: 0, outcome: "failed", error: "[TRANSIENT] rpc_status_503" }, RETRY_TRANSIENT_MS - 1)).toBe(false);
    expect(isDue({ at: 0, outcome: "stored" }, 10 ** 15)).toBe(false);
  });
});

describe("runOnce", () => {
  let store: Store;
  let chain: FakeChain;
  const A = a(0xa), B = a(0xb), C = a(0xc), P = a(0xf);

  beforeEach(async () => {
    store = await Store.open(":memory:");
    chain = new FakeChain();
    await seed(store, [agreementCase(1, A, B), agreementCase(2, C, B), agreementCase(3, A, C, false)]);
  });

  it("judges each ruled case once and skips unruled ones", async () => {
    const r = await runOnce({ store, chain, sync: noSync, discover: async () => [] });
    expect(r.judged).toHaveLength(2);
    expect(chain.writes).toHaveLength(2);
    const again = await runOnce({ store, chain, sync: noSync, discover: async () => [] });
    expect(again.writes).toBe(0);
  });

  it("does not resend cases someone else already judged", async () => {
    chain.judged.add(a(0xca5e0 + 1));
    const r = await runOnce({ store, chain, sync: noSync, discover: async () => [] });
    expect(r.alreadyOnChain).toEqual([a(0xca5e0 + 1)]);
    expect(chain.writes).toEqual([`judge ${a(0xca5e0 + 2)}`]);
  });

  it("records failures, gives up on permanent ones and retries outages later", async () => {
    chain.failNext[a(0xca5e0 + 1)] = "[EXPECTED] unsupported_case_type";
    chain.failNext[a(0xca5e0 + 2)] = "[TRANSIENT] rpc_status_503";
    let t = 1_000_000;
    const now = () => t;
    const r = await runOnce({ store, chain, sync: noSync, discover: async () => [], now });
    expect(r.failed.map((f) => f.error)).toEqual(["[EXPECTED] unsupported_case_type", "[TRANSIENT] rpc_status_503"]);
    t += RETRY_TRANSIENT_MS;
    const later = await runOnce({ store, chain, sync: noSync, discover: async () => [], now });
    expect(later.judged).toEqual([a(0xca5e0 + 2)]); // the outage is retried, the permanent error is not
    expect(chain.writes.filter((w) => w.includes(a(0xca5e0 + 1)))).toHaveLength(1);
  });

  it("proves links between parties of judged cases, once", async () => {
    // A and C were both first-funded by P; A was also funded by... nobody known. P is not a court party.
    const discover = async (w: Address) => (w === A ? [fact(A, P, 1)] : w === C ? [fact(C, P, 2)] : []);
    const r = await runOnce({ store, chain, sync: noSync, discover });
    expect(r.linksProven).toEqual([`${A} ↔ ${C}`]);
    const again = await runOnce({ store, chain, sync: noSync, discover });
    expect(again.writes).toBe(0);
  });

  it("dry run writes nothing", async () => {
    const discover = async (w: Address) => (w === A ? [fact(A, P, 1)] : w === C ? [fact(C, P, 2)] : []);
    chain.judged.add(a(0xca5e0 + 1)); // so its parties count as judged
    const r = await runOnce({ store, chain, sync: noSync, discover, dryRun: true });
    expect(chain.writes).toEqual([]);
    expect(r.wouldWrite.some((w) => w.startsWith("judge case #2"))).toBe(true);
  });

  it("counts a case as judged when the receipt poll failed but the transaction went through", async () => {
    const flaky = Object.assign(chain, {
      async judgeCase(c: Address): Promise<TxOutcome> {
        chain.writes.push(`judge ${c}`);
        chain.judged.add(c); // the transaction landed...
        throw new Error("An unknown RPC error occurred."); // ...but polling for its receipt failed
      },
    });
    const r = await runOnce({ store, chain: flaky, sync: noSync, discover: async () => [] });
    expect(r.judged).toHaveLength(2);
    expect(r.failed).toEqual([]);
  });

  it("stops at the write budget", async () => {
    const r = await runOnce({ store, chain, sync: noSync, discover: async () => [], maxWrites: 1 });
    expect(r.writes).toBe(1);
    expect(chain.writes).toHaveLength(1);
  });
});
