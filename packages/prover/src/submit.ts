import { createAccount, createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { TransactionStatus } from "genlayer-js/types";
import type { Address } from "@agentscore/shared";
import type { LinkProof } from "./discover.js";

export interface SubmitResult {
  tx: string;
  stored: boolean;
  links: Record<string, string>;
}

/**
 * Sends prove_link to the AgentScore contract on StudioNet, waits for FINALIZED, then reads the
 * links back. The contract re-checks everything; `stored` is the read-back, not our hope.
 */
export async function submitProof(p: LinkProof, contract: Address, privateKey: `0x${string}`): Promise<SubmitResult> {
  const client = createClient({ chain: studionet, account: createAccount(privateKey) });
  const tx = (await client.writeContract({
    address: contract,
    functionName: "prove_link",
    args: [p.subject, p.other, p.kind, JSON.stringify(p.proof)],
    value: 0n,
  })) as string;
  type ReceiptArgs = Parameters<typeof client.waitForTransactionReceipt>[0];
  await client.waitForTransactionReceipt({ hash: tx as ReceiptArgs["hash"], status: TransactionStatus.FINALIZED, retries: 120, interval: 5000 });
  const links = (await client.readContract({ address: contract, functionName: "get_links", args: [p.subject], jsonSafeReturn: true })) as Record<string, string>;
  return { tx, stored: p.other in links, links };
}
