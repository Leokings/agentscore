import type { CourtCase } from "@agentscore/shared";

/** A case the contract can judge: it has a final ruling and a case type the contract reads. */
export function isJudgeable(c: CourtCase): boolean {
  if (c.contractType === "Agreement") return c.status === "RESOLVED" && (c.statementVerdict === "TRUE" || c.statementVerdict === "FALSE");
  if (c.contractType === "TradeFxSettlement") return c.verdictCode !== undefined && !!c.reasoning?.trim();
  return false;
}

/** Contract errors that will never change for the same input, so retrying wastes transactions. */
const PERMANENT = new Set([
  "unsupported_case_type",
  "case_not_registered",
  "invalid_case_parties",
  "case_evidence_too_large",
  "case_evidence_empty",
  "evidence_invalid_utf8",
  "link_not_proven",
  "funder_is_infrastructure",
  "self_link",
  "unknown_link_kind",
  "unknown_network",
  "invalid_proof_json",
  "wallet_link_limit",
  "wallet_case_limit",
]);

export const RETRY_TRANSIENT_MS = 30 * 60 * 1000;
export const RETRY_OTHER_MS = 6 * 60 * 60 * 1000;

export interface Attempt {
  at: number;
  /** "stored" once a read-back from the contract confirms it; never retried after that. */
  outcome: "stored" | "failed";
  tx?: string;
  error?: string;
}

/**
 * When a failed attempt may be retried.
 * - permanent contract errors: never
 * - outages ([TRANSIENT] or [EXTERNAL]): after 30 minutes
 * - anything else, e.g. validators disagreed so nothing was stored: after 6 hours
 */
export function retryAt(a: Attempt): number {
  if (a.outcome === "stored") return Infinity;
  const code = a.error?.split(" ")[1];
  if (code && PERMANENT.has(code)) return Infinity;
  if (a.error?.startsWith("[TRANSIENT]") || a.error?.startsWith("[EXTERNAL]") || a.error?.startsWith("network:")) return a.at + RETRY_TRANSIENT_MS;
  return a.at + RETRY_OTHER_MS;
}

export function isDue(a: Attempt | undefined, now: number): boolean {
  return !a || retryAt(a) <= now;
}
