import type { Address, AgentScore, CourtCase, WalletLink } from "@agentscore/shared";

/** What the contract stored for a judged case (get_case). */
export interface ContractCase {
  case_id: number;
  case_type: string;
  resolution?: "jury" | "default" | "settlement";
  parties: Array<{ address: string; role: string; outcome: string; severity: string }>;
}

/** The score as the API returns it (see contract.ts). */
export type ScoreView = AgentScore & { points?: number; approvalLimitUsd?: number; contract?: string };

// Mirrors the contract's scoring table (contracts/agent_score.py), so the report can say what
// each case did to the score. The grade itself always comes from the contract.
const WIN_POINTS = 8;
const MAX_COUNTED_WINS = 5;
const FAKE_WIN_PENALTY = 10;
const LOSS_PENALTY: Record<string, number> = { MINOR: 8, MATERIAL: 20, SEVERE: 40 };

const SEVERITY_MEANING: Record<string, string> = {
  MINOR: "minor loss (validators found no deception or non-delivery)",
  MATERIAL: "material loss (validators found it did not deliver)",
  SEVERE: "severe loss (validators found deception or fraud)",
};

const DECIDED_BY: Record<string, string> = {
  jury: "Internet Court's AI jury",
  default: "default judgment (one side never answered; no jury)",
  settlement: "settlement between the parties (no jury)",
};

export const FLAG_MEANING: Record<string, string> = {
  FAKE_WINS: "Some wins were against wallets proven to have the same owner; they cost points instead of earning them.",
  INHERITED_LOSSES: "Wallets proven to have the same owner lost Internet Court cases; those losses count here too.",
  UNCONTESTED_WINS: "Some wins came from a no-show or a settlement, not a jury verdict, so they earn nothing.",
  UNCLEAR_RULINGS: "Validators could not tell what some rulings meant for this agent; they add nothing.",
  NO_HISTORY: "Nothing trustworthy is known yet (no jury ruling, loss or linked loss).",
};

const CASE_EXPLORER = "https://base-sepolia.blockscout.com/address/";

/** One sentence for whoever is about to pay this agent. */
export function adviceFor(score: ScoreView, amount?: number): { advice: string; decision: "approve" | "escrow" | null } {
  if (score.status !== "scored") {
    return { advice: "No score is available right now: treat this agent as unknown and pay it only through escrow (an Internet Court agreement).", decision: null };
  }
  const limit = score.approvalLimitUsd ?? 0;
  if (amount !== undefined) {
    return amount <= limit && limit > 0
      ? { advice: `A $${amount} job is within this agent's $${limit} limit: it can be paid without escrow.`, decision: "approve" }
      : { advice: `Pay this agent only through escrow (an Internet Court agreement) for a $${amount} job${limit > 0 ? `; it can be paid directly only up to $${limit}` : ""}.`, decision: "escrow" };
  }
  return limit > 0
    ? { advice: `Can be paid without escrow for jobs up to $${limit}; above that, pay only through escrow (an Internet Court agreement).`, decision: null }
    : { advice: "Pay this agent only through escrow (an Internet Court agreement), whatever the amount.", decision: null };
}

export interface ReportInput {
  wallet: Address;
  score: ScoreView;
  /** Internet Court cases where the wallet is a party (from the indexer). */
  cases: Array<CourtCase & { role: string }>;
  /** What the contract stored per case address; null when the contract has not judged it. */
  judged: Map<string, ContractCase | null>;
  /** Links the contract verified: other wallet -> description. */
  proven: Record<string, string>;
  /** Link-builder signals (Nansen + chain history). */
  signals: WalletLink[];
  /** Cases of each proven linked wallet, with what the contract stored for them. */
  linkedCases: Map<string, Array<{ courtCase: CourtCase & { role: string }; judged: ContractCase | null }>>;
}

export function buildReport(input: ReportInput) {
  const { wallet, score, proven } = input;
  const cluster = new Set(Object.keys(proven));
  let juryWins = 0;

  const cases = [...input.cases]
    .sort((a, b) => a.id - b.id)
    .map((c) => {
      const judged = input.judged.get(c.address) ?? null;
      const me = judged?.parties.find((p) => p.address === wallet);
      const counterparties = c.parties.filter((p) => p.address !== wallet).map((p) => p.address);
      const resolution = judged?.resolution ?? c.resolution;
      let result = "pending";
      let effect = "not judged on-chain yet: does not count";
      if (me) {
        if (me.outcome === "FAVORABLE") {
          result = "won";
          if (counterparties.some((p) => cluster.has(p))) effect = `−${FAKE_WIN_PENALTY}: fake win, the other side is a wallet proven to have the same owner`;
          else if (resolution && resolution !== "jury") effect = "0: won without a jury, so it earns nothing";
          else effect = ++juryWins <= MAX_COUNTED_WINS ? `+${WIN_POINTS}: jury win` : `0: only ${MAX_COUNTED_WINS} jury wins count`;
        } else if (me.outcome === "UNFAVORABLE") {
          result = "lost";
          effect = `−${LOSS_PENALTY[me.severity] ?? 0}: ${SEVERITY_MEANING[me.severity] ?? `${me.severity.toLowerCase()} loss`}`;
        } else {
          result = me.outcome === "NEUTRAL" ? "neither side prevailed" : "unclear";
          effect = "0";
        }
      }
      return {
        id: c.id,
        address: c.address,
        explorer: CASE_EXPLORER + c.address,
        role: c.role,
        counterparties,
        claim: c.statement ?? null,
        reasoning: c.reasoning ?? null,
        decidedBy: resolution ? DECIDED_BY[resolution] : "not ruled yet",
        result,
        severity: me && me.outcome === "UNFAVORABLE" ? me.severity : null,
        effect,
        judgedOnChain: !!judged,
      };
    });

  const linkedWallets = [
    ...Object.keys(proven).map((other) => {
      const seen = input.signals.find((l) => l.other === other && (l.type === "funded" || l.type === "funded_by"));
      const losses = (input.linkedCases.get(other) ?? [])
        .filter(({ courtCase }) => !courtCase.parties.some((p) => p.address === wallet)) // counted on the agent's own side
        .flatMap(({ courtCase, judged }) => {
          const them = judged?.parties.find((p) => p.address === other);
          return them?.outcome === "UNFAVORABLE"
            ? [{ caseId: courtCase.id, explorer: CASE_EXPLORER + courtCase.address, claim: courtCase.statement ?? null, severity: them.severity, effect: `−${LOSS_PENALTY[them.severity] ?? 0}: inherited ${SEVERITY_MEANING[them.severity] ?? "loss"}` }]
            : [];
        });
      return {
        wallet: other,
        proven: true,
        countsInGrade: true,
        evidence: seen?.evidence[0]?.description ?? "first-funding proof verified on-chain by GenLayer validators",
        evidenceTx: seen?.evidence[0]?.txHash ?? null,
        inheritedLosses: losses,
      };
    }),
    ...[...new Set(input.signals.filter((l) => !cluster.has(l.other)).map((l) => l.other))].map((other) => {
      const ls = input.signals.filter((l) => l.other === other);
      return {
        wallet: other,
        proven: false,
        countsInGrade: false,
        evidence: ls.map((l) => `${l.type.replaceAll("_", " ")}: ${l.evidence[0]?.description ?? ""}`).join("; "),
        evidenceTx: ls[0]?.evidence[0]?.txHash ?? null,
        inheritedLosses: [],
      };
    }),
  ];

  return {
    wallet,
    ...adviceFor(score),
    grade: score.grade,
    status: score.status,
    points: score.points ?? null,
    approvalLimitUsd: score.approvalLimitUsd ?? null,
    flags: score.flags.map((code) => ({ code, meaning: FLAG_MEANING[code] ?? code })),
    summary: score.reasons[0] ?? null,
    contract: score.contract ?? null,
    cases,
    linkedWallets,
    signals: input.signals,
    proven,
  };
}
