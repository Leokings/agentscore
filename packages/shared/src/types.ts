/** A lower-cased 0x-prefixed EVM address. Agents are identified by wallet address. */
export type Address = `0x${string}`;
export type TxHash = `0x${string}`;

// ---------------------------------------------------------------------------
// Internet Court
// ---------------------------------------------------------------------------

/**
 * Standard agreements are created by the factory (`AgreementCreated`).
 * Registered cases are app-specific contracts that call `registerCase()`.
 */
export type CaseKind = "agreement" | "registered";

/** Which reader understood the case contract. "unknown" means no adapter matched. */
export type CaseContractType = "Agreement" | "TradeFxSettlement" | "unknown";

/** Standard Agreement verdict enum: the AI jury rules on whether the statement is true. */
export type StatementVerdict = "UNDETERMINED" | "TRUE" | "FALSE";

export interface CaseParty {
  /** Role name as the case contract defines it, e.g. partyA, partyB, exporter, importer. */
  role: string;
  address: Address;
}

export interface CourtCase {
  id: number;
  address: Address;
  kind: CaseKind;
  contractType: CaseContractType;
  parties: CaseParty[];
  /** The claim the jury evaluates (standard agreements) or the contested statement. */
  statement?: string;
  /** The jury's written explanation, when the case contract exposes one. */
  reasoning?: string;
  /** Raw status code from the case contract; meaning depends on contractType. */
  statusCode?: number;
  status?: string;
  escrowAmount?: string;
  createdBlock: number;
  createdTx?: TxHash;
  disputed: boolean;
  disputeBlock?: number;
  /** Code from the factory's VerdictReceived event (app-specific for registered cases). */
  verdictCode?: number;
  verdictBlock?: number;
  /** Only set for standard agreements, decoded from the Agreement verdict enum. */
  statementVerdict?: StatementVerdict;
  /** How a ruled case was decided, read the same way the GenLayer contract reads it. */
  resolution?: CaseResolution;
}

/**
 * jury: both sides submitted evidence and Internet Court's AI jury ruled.
 * default: one side never answered the dispute, so it was decided by default.
 * settlement: no dispute; the parties agreed on the outcome themselves.
 */
export type CaseResolution = "jury" | "default" | "settlement";

/** An agent's view of Internet Court: every case where its wallet is a party. */
export interface CourtRecord {
  wallet: Address;
  cases: Array<CourtCase & { role: string }>;
  totals: {
    cases: number;
    disputed: number;
    ruled: number;
    /** Ruled cases that Internet Court's AI jury decided (the only wins that earn points). */
    jury: number;
    pendingRuling: number;
  };
  indexedToBlock: number;
}

// ---------------------------------------------------------------------------
// Wallet history (from Nansen on mainnets, from our own indexer on testnets)
// ---------------------------------------------------------------------------

export type Network = "base" | "ethereum" | "base-sepolia";

/** A labelled entity such as an exchange, bridge or faucet. Links through these are ignored. */
export type InfraKind = "exchange" | "bridge" | "faucet" | "protocol" | "none";

export interface WalletRelation {
  /** The other wallet. */
  address: Address;
  label?: string;
  infra: InfraKind;
  /**
   * funded_by: the other wallet sent the subject its first funds.
   * funded: the subject sent the other wallet funds.
   * cashout: the subject sent earnings to the other wallet (largest outgoing destinations).
   * deployer / signer: from Nansen related-wallets relations.
   */
  relation: "funded_by" | "funded" | "cashout" | "deployer" | "signer";
  network: Network;
  txHash?: TxHash;
  timestamp?: number;
  amountUsd?: number;
}

export interface WalletProfile {
  wallet: Address;
  relations: WalletRelation[];
  firstSeen?: number;
  lastActive?: number;
  sources: Array<"nansen" | "blockscout">;
}

// ---------------------------------------------------------------------------
// Wallet links
// ---------------------------------------------------------------------------

export type LinkType =
  | "shared_funder" // #1 siblings: the same wallet funded both
  | "funded_by" // #2 parent: the other wallet funded the subject
  | "funded" // #2 child: the subject funded the other wallet
  | "shared_cashout" // #3 both send earnings to the same wallet
  | "same_deployer" // #4 same deployer
  | "same_signer" // #4 same signer
  | "linked_counterparty" // #5 a court counterparty is linked to the subject (possible fake win)
  | "closed_loop" // #6 money goes around a short circle back to the subject
  | "successor_of"; // #7 subject appeared after a linked wallet with lost cases went quiet

export type LinkStrength = "strong" | "medium" | "weak";

export interface LinkEvidence {
  description: string;
  txHash?: TxHash;
  network?: Network;
  via?: Address;
}

export interface WalletLink {
  type: LinkType;
  /** The linked agent wallet. */
  other: Address;
  /** Whether the subject controlled the action that created this link. Inbound-only links are weak. */
  direction: "subject_initiated" | "other_initiated" | "shared";
  strength: LinkStrength;
  evidence: LinkEvidence[];
}

// ---------------------------------------------------------------------------
// Scores (produced by the GenLayer contract; see docs/DESIGN.md)
// ---------------------------------------------------------------------------

export type Grade = "A" | "B" | "C" | "D" | "F";

export interface AgentScore {
  wallet: Address;
  grade: Grade | null;
  status: "scored" | "pending" | "not_scored";
  reasons: string[];
  flags: string[];
  /** GenLayer transaction that produced the grade, so anyone can verify it. */
  genlayerTx?: string;
  scoredAt?: number;
}
