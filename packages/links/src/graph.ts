import type { Address, CourtCase, InfraKind, Network, TxHash } from "@agentscore/shared";

/** One wallet's history, reduced to what the link rules need. JSON-serialisable on purpose. */
export interface WalletNode {
  address: Address;
  /** The wallet that sent this wallet its first funds, per network. */
  firstFunders: Array<{ address: Address; network: Network; txHash?: TxHash; timestamp?: number }>;
  /** Distinct wallets this wallet sent value to. */
  outgoing: Array<{ to: Address; network: Network; txHash?: TxHash; timestamp?: number }>;
  deployer?: Address;
  signers: Address[];
  firstSeen?: number;
  lastActive?: number;
  cases: Array<CourtCase & { role: string }>;
}

export interface WalletGraph {
  subject: Address;
  /** The subject plus every candidate wallet we gathered history for. */
  nodes: Record<string, WalletNode>;
  /** Addresses known to be exchanges, bridges, faucets or protocols. Links through them are ignored. */
  infra: Record<string, { kind: InfraKind; label?: string }>;
  /** funder -> wallets it funded (from the funder's own history; used to find siblings). */
  fundedBy: Record<string, Address[]>;
  /** destination -> wallets that sent it value (used to find shared cash-out wallets). */
  paidBy: Record<string, Address[]>;
}

export function emptyNode(address: Address): WalletNode {
  return { address, firstFunders: [], outgoing: [], signers: [], cases: [] };
}
