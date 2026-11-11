import type { Address } from "@agentscore/shared";
import { linkStored, StudioNetChain } from "./chain.js";
import type { LinkProof } from "./discover.js";

export interface SubmitResult {
  tx: string;
  stored: boolean;
  error?: string;
  links: Record<string, string>;
}

/**
 * Sends prove_link to the AgentScore contract on StudioNet, waits for FINALIZED, then reads the
 * links back. The contract re-checks everything; `stored` is the read-back, not our hope.
 */
export async function submitProof(p: LinkProof, contract: Address, privateKey: `0x${string}`): Promise<SubmitResult> {
  const chain = new StudioNetChain(contract, privateKey);
  const outcome = await chain.proveLink(p);
  const links = await chain.links(p.subject);
  const stored = await linkStored(chain, p);
  return { tx: outcome.tx, stored, ...(outcome.error ? { error: outcome.error } : {}), links };
}
