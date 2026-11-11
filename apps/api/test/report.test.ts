import { describe, expect, it } from "vitest";
import type { Address, CourtCase, WalletLink } from "@agentscore/shared";
import { adviceFor, buildReport, type ContractCase, type ScoreView } from "../src/report.js";

const a = (n: number) => `0x${n.toString(16).padStart(40, "0")}` as Address;
const ME = a(0xa1), SOCK = a(0x51), CLIENT = a(0xc1), OLD = a(0x0d);

const scored = (over: Partial<ScoreView> = {}): ScoreView => ({
  wallet: ME, grade: "C", status: "scored", reasons: ["summary line"], flags: [], points: 58, approvalLimitUsd: 100, ...over,
});

function courtCase(id: number, partyA: Address, partyB: Address, resolution: CourtCase["resolution"] = "jury"): CourtCase & { role: string } {
  return {
    id, address: a(0xca5e00 + id), kind: "agreement", contractType: "Agreement", createdBlock: 1, disputed: true, resolution,
    parties: [{ role: "partyA", address: partyA }, { role: "partyB", address: partyB }],
    statement: `Claim ${id}`, reasoning: `Reasoning ${id}`, role: partyA === ME ? "partyA" : "partyB",
  };
}

function judged(c: CourtCase, winner: Address, severity = "MINOR"): ContractCase {
  return {
    case_id: c.id, case_type: "Agreement", resolution: c.resolution,
    parties: c.parties.map((p) => ({ address: p.address, role: p.role, outcome: p.address === winner ? "FAVORABLE" : "UNFAVORABLE", severity: p.address === winner ? "NONE" : severity })),
  };
}

describe("advice", () => {
  it("speaks to whoever pays, with or without an amount", () => {
    expect(adviceFor(scored()).advice).toMatch(/paid without escrow for jobs up to \$100/);
    expect(adviceFor(scored(), 50)).toMatchObject({ decision: "approve" });
    expect(adviceFor(scored(), 500)).toMatchObject({ decision: "escrow" });
    expect(adviceFor(scored({ approvalLimitUsd: 0 })).advice).toMatch(/only through escrow.*whatever the amount/);
    expect(adviceFor(scored({ approvalLimitUsd: 0 }), 0)).toMatchObject({ decision: "escrow" });
  });

  it("never approves an agent it cannot score", () => {
    expect(adviceFor(scored({ status: "pending", grade: null }), 1)).toMatchObject({ decision: null });
    expect(adviceFor(scored({ status: "not_scored", grade: null })).advice).toMatch(/unknown.*escrow/);
  });
});

describe("report", () => {
  const jury = courtCase(1, CLIENT, ME); // ME wins a jury case
  const fake = courtCase(2, ME, SOCK, "default"); // ME beats its own sock by default
  const noShow = courtCase(3, ME, a(0xee), "default"); // ME wins because the other side never answered
  const lost = courtCase(4, a(0xc2), ME); // ME loses with non-delivery
  const oldLoss = courtCase(5, a(0xc3), OLD); // a proven linked wallet's loss
  const signal: WalletLink = { type: "shared_cashout", other: a(0x99), direction: "shared", strength: "strong", evidence: [{ description: "Both send funds to 0x…" }] };

  const report = buildReport({
    wallet: ME,
    score: scored({ flags: ["FAKE_WINS", "INHERITED_LOSSES"] }),
    cases: [lost, noShow, fake, jury],
    judged: new Map([
      [jury.address, judged(jury, ME)],
      [fake.address, judged(fake, ME)],
      [noShow.address, judged(noShow, ME)],
      [lost.address, judged(lost, a(0xc2), "MATERIAL")],
    ]),
    proven: { [SOCK]: "first funding", [OLD]: "first funding" },
    signals: [signal],
    linkedCases: new Map([
      [OLD, [{ courtCase: { ...oldLoss, role: "partyB" }, judged: judged(oldLoss, a(0xc3), "SEVERE") }]],
      [SOCK, [{ courtCase: { ...fake, role: "partyB" }, judged: judged(fake, ME) }]],
    ]),
  });

  it("explains what every case did to the score, in case order", () => {
    expect(report.cases.map((c) => [c.id, c.result, c.effect.split(":")[0]])).toEqual([
      [1, "won", "+8"],
      [2, "won", "−10"],
      [3, "won", "0"],
      [4, "lost", "−20"],
    ]);
    expect(report.cases[1]!.effect).toMatch(/fake win/);
    expect(report.cases[2]!.effect).toMatch(/without a jury/);
    expect(report.cases[3]!.severity).toBe("MATERIAL");
    expect(report.cases[0]!.decidedBy).toMatch(/AI jury/);
  });

  it("lists proven links with the losses they pass on, and signals that do not count", () => {
    const old = report.linkedWallets.find((l) => l.wallet === OLD)!;
    expect(old).toMatchObject({ proven: true, countsInGrade: true });
    expect(old.inheritedLosses).toEqual([expect.objectContaining({ caseId: 5, severity: "SEVERE" })]);
    expect(old.inheritedLosses[0]!.effect).toMatch(/^−40: inherited severe loss/);
    // The sock's case against ME is already counted on ME's own side, so it is not inherited.
    expect(report.linkedWallets.find((l) => l.wallet === SOCK)!.inheritedLosses).toEqual([]);
    expect(report.linkedWallets.find((l) => l.wallet === a(0x99))).toMatchObject({ proven: false, countsInGrade: false });
  });

  it("explains each flag and carries the advice", () => {
    expect(report.flags.map((f) => f.code)).toEqual(["FAKE_WINS", "INHERITED_LOSSES"]);
    expect(report.flags.every((f) => f.meaning.length > 20)).toBe(true);
    expect(report.advice).toMatch(/up to \$100/);
  });

  it("puts verified signals in their own tier, between proven links and hints", () => {
    const CASHOUT_PEER = a(0x77);
    const r = buildReport({
      wallet: ME, score: scored({ flags: ["POSSIBLE_SAME_OWNER"] }), cases: [], judged: new Map(), proven: {},
      verifiedSignals: { [CASHOUT_PEER]: "both sent money to the same wallet within 30 days (base-sepolia)" },
      signals: [{ ...signal, other: CASHOUT_PEER }], linkedCases: new Map(),
    });
    expect(r.linkedWallets).toHaveLength(1); // the hint about the same wallet is folded into the signal
    expect(r.linkedWallets[0]).toMatchObject({ wallet: CASHOUT_PEER, tier: "signal", countsInGrade: true, inheritedLosses: [] });
    expect(r.linkedWallets[0]!.effect).toMatch(/above \$100 need escrow/);
    expect(r.flags[0]!.meaning).toMatch(/\$100/);
  });

  it("shows a case the contract has not judged yet as not counting", () => {
    const fresh = courtCase(9, CLIENT, ME);
    const r = buildReport({ wallet: ME, score: scored(), cases: [fresh], judged: new Map(), proven: {}, signals: [], linkedCases: new Map() });
    expect(r.cases[0]).toMatchObject({ result: "pending", judgedOnChain: false });
    expect(r.cases[0]!.effect).toMatch(/does not count/);
  });
});
