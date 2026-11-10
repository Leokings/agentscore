import { createClient } from "genlayer-js";
import { localnet, studionet, testnetBradbury } from "genlayer-js/chains";
import type { Address, AgentScore, Grade } from "@agentscore/shared";

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
}

const FLAG_REASONS: Record<string, string> = {
  FAKE_WINS: "Some court wins were against wallets proven to share this agent's owner, so they do not count.",
  INHERITED_LOSSES: "Wallets proven to share this agent's owner have lost Internet Court cases.",
  UNCLEAR_RULINGS: "Validators could not tell what some rulings meant for this agent; they add nothing.",
  NO_HISTORY: "No judged Internet Court cases and no inherited losses yet: unknown, so escrow is required.",
};

export function toAgentScore(wallet: Address, s: ContractScore, contract: string): AgentScore & { points: number; approvalLimitUsd: number; counts: Record<string, number>; contract: string } {
  const c = s.counts;
  const reasons = [
    `${c.ruled_cases ?? 0} judged Internet Court case(s): ${c.wins ?? 0} genuine win(s), ${c.loss_penalty ?? 0} points lost to rulings, ${c.inherited_penalty ?? 0} inherited from linked wallets.`,
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
