import { createClient } from "genlayer-js";
import { localnet, studionet, testnetBradbury } from "genlayer-js/chains";
import type { Address, AgentScore, Grade } from "@agentscore/shared";
import type { ContractCase } from "./report.js";

/** Shape returned by the contract's get_score view (contracts/agent_score.py). */
export interface ContractScore {
  wallet: string;
  grade: Grade;
  points: number;
  approval_limit_usd: number;
  flags: string[];
  counts: Record<string, number>;
}

type Chain = NonNullable<Parameters<typeof createClient>[0]>["chain"];
type Client = ReturnType<typeof createClient>;

const CHAINS: Record<string, Chain> = { localnet, studionet, testnetBradbury };

/** Reads grades from the deployed AgentScore contract. Returns undefined when none is configured. */
export class ScoreReader {
  private readonly client: Client;

  constructor(
    readonly contract = (process.env.AGENTSCORE_CONTRACT_ADDRESS || undefined) as Address | undefined,
    network: string = process.env.GENLAYER_NETWORK ?? "studionet",
  ) {
    const chain = CHAINS[network];
    if (!chain) throw new Error(`Unknown GENLAYER_NETWORK: ${network}`);
    this.client = createClient({ chain });
  }

  get configured(): boolean {
    return !!this.contract;
  }

  async read(wallet: Address): Promise<ContractScore | undefined> {
    if (!this.contract) return undefined;
    const raw = await this.client.readContract({
      address: this.contract,
      functionName: "get_score",
      args: [wallet],
      jsonSafeReturn: true,
    });
    return raw as unknown as ContractScore;
  }

  /** What the contract stored for a case, or null if it has not judged it. */
  async case(caseAddress: string): Promise<ContractCase | null> {
    if (!this.contract) return null;
    try {
      const raw = await this.client.readContract({
        address: this.contract,
        functionName: "get_case",
        args: [caseAddress],
        jsonSafeReturn: true,
      });
      return (raw ?? null) as ContractCase | null;
    } catch (e) {
      // The contract raises [EXPECTED] case_not_judged for cases it has not judged yet.
      if (/case_not_judged|execution failed/i.test(String((e as Error).message))) return null;
      throw e;
    }
  }

  /** Same-owner links the contract has verified and stored: other wallet -> description. */
  async links(wallet: Address): Promise<Record<string, string>> {
    if (!this.contract) return {};
    const raw = await this.client.readContract({
      address: this.contract,
      functionName: "get_links",
      args: [wallet],
      jsonSafeReturn: true,
    });
    return (raw ?? {}) as Record<string, string>;
  }
}

const FLAG_REASONS: Record<string, string> = {
  FAKE_WINS: "Some court wins were against wallets proven to share this agent's owner, so they do not count.",
  INHERITED_LOSSES: "Wallets proven to share this agent's owner have lost Internet Court cases.",
  UNCLEAR_RULINGS: "Validators could not tell what some rulings meant for this agent; they add nothing.",
  UNCONTESTED_WINS: "Some wins came from a default judgment or a settlement, not a jury verdict, so they add no points.",
  NO_HISTORY: "No jury-ruled Internet Court cases, losses or inherited losses yet: unknown, so escrow is required.",
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** One readable line from the contract's counts. */
function summary(c: Record<string, number>): string {
  const parts = [
    `${plural(c.ruled_cases ?? 0, "ruled case")} judged on-chain (${c.jury_cases ?? 0} by the AI jury)`,
    plural(c.wins ?? 0, "jury win"),
  ];
  if (c.loss_penalty) parts.push(`−${c.loss_penalty} points for its own losses`);
  if (c.inherited_penalty) parts.push(`−${c.inherited_penalty} for losses of linked wallets`);
  return parts.join(" · ") + ".";
}

export function toAgentScore(wallet: Address, s: ContractScore, contract: string): AgentScore & { points: number; approvalLimitUsd: number; counts: Record<string, number>; contract: string } {
  const c = s.counts;
  const reasons = [
    summary(c),
    ...s.flags.map((f) => FLAG_REASONS[f] ?? f),
  ];
  return {
    wallet,
    grade: s.grade,
    status: "scored",
    reasons,
    flags: s.flags,
    points: s.points,
    approvalLimitUsd: s.approval_limit_usd,
    counts: c,
    contract,
  };
}
