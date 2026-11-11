import { createAccount, createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { TransactionStatus } from "genlayer-js/types";
import type { Address } from "@agentscore/shared";
import type { LinkProof } from "./discover.js";

/** What happened to one write, taken from the finalized receipt. */
export interface TxOutcome {
  tx: string;
  status: string;
  leader: "SUCCESS" | "ERROR" | "UNKNOWN";
  /** e.g. "[EXPECTED] case_already_judged" when the contract rejected the call. */
  error?: string;
}

/** The AgentScore contract operations the prover and keeper need. An interface so tests can fake it. */
export interface AgentScoreChain {
  isJudged(caseAddress: Address): Promise<boolean>;
  judgeCase(caseAddress: Address): Promise<TxOutcome>;
  links(wallet: Address): Promise<Record<string, string>>;
  /** Signal links (v8): shared cash-out and closed loops. */
  signals(wallet: Address): Promise<Record<string, string>>;
  proveLink(p: LinkProof): Promise<TxOutcome>;
}

/** Signal kinds are stored apart from proven links (contracts/agent_score.py SIGNAL_KINDS). */
export const SIGNAL_KINDS: ReadonlySet<string> = new Set(["shared_cashout", "closed_loop"]);

/** Whether the contract already holds this link: a proven link always counts; a signal also
 * counts as held when the pair is already proven (the contract rejects it as link_already_proven). */
export async function linkStored(chain: AgentScoreChain, p: Pick<LinkProof, "subject" | "other" | "kind">): Promise<boolean> {
  if (p.other in (await chain.links(p.subject))) return true;
  return SIGNAL_KINDS.has(p.kind) && p.other in (await chain.signals(p.subject));
}

const ERROR_RE = /\[(?:EXPECTED|EXTERNAL|TRANSIENT|LLM_ERROR)\] [a-z0-9_]+/;

export class StudioNetChain implements AgentScoreChain {
  private readonly client;

  constructor(
    readonly contract: Address,
    privateKey: `0x${string}`,
  ) {
    this.client = createClient({ chain: studionet, account: createAccount(privateKey) });
  }

  async isJudged(caseAddress: Address): Promise<boolean> {
    try {
      await this.client.readContract({ address: this.contract, functionName: "get_case", args: [caseAddress], jsonSafeReturn: true });
      return true;
    } catch (e) {
      // The node reports any contract error as "execution failed"; get_case only fails for unjudged cases.
      if (String((e as Error).message).includes("execution failed")) return false;
      throw e;
    }
  }

  async links(wallet: Address): Promise<Record<string, string>> {
    return (await this.client.readContract({ address: this.contract, functionName: "get_links", args: [wallet], jsonSafeReturn: true })) as Record<string, string>;
  }

  async signals(wallet: Address): Promise<Record<string, string>> {
    return (await this.client.readContract({ address: this.contract, functionName: "get_signals", args: [wallet], jsonSafeReturn: true })) as Record<string, string>;
  }

  judgeCase(caseAddress: Address): Promise<TxOutcome> {
    return this.write("judge_cases", [[caseAddress]]);
  }

  proveLink(p: LinkProof): Promise<TxOutcome> {
    return this.write("prove_link", [p.subject, p.other, p.kind, JSON.stringify(p.proof)]);
  }

  private async write(functionName: string, args: unknown[]): Promise<TxOutcome> {
    const tx = (await this.client.writeContract({ address: this.contract, functionName, args: args as never, value: 0n })) as string;
    type ReceiptArgs = Parameters<typeof this.client.waitForTransactionReceipt>[0];
    await this.client.waitForTransactionReceipt({ hash: tx as ReceiptArgs["hash"], status: TransactionStatus.FINALIZED, retries: 120, interval: 5000 });
    const receipt = (await this.client.getTransaction({ hash: tx as ReceiptArgs["hash"] })) as unknown as {
      statusName?: string;
      consensus_data?: { leader_receipt?: Array<{ execution_result?: string; result?: unknown }> | { execution_result?: string; result?: unknown } };
    };
    const lr = receipt.consensus_data?.leader_receipt;
    const leader = Array.isArray(lr) ? lr[0] : lr;
    const exec = leader?.execution_result === "SUCCESS" || leader?.execution_result === "ERROR" ? leader.execution_result : "UNKNOWN";
    const error = JSON.stringify(leader?.result ?? "").match(ERROR_RE)?.[0];
    return { tx, status: receipt.statusName ?? "UNKNOWN", leader: exec, ...(error ? { error } : {}) };
  }
}
