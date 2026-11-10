import { normalizeAddress, type Address, type CaseContractType, type CaseParty, type CaseResolution, type StatementVerdict, type TxHash } from "@agentscore/shared";
import { AGREEMENT_STATUS, AGREEMENT_VERDICT, agreementAbi, genericRoleAbi, genericRoleGetters, tradeFxAbi } from "./abi.js";
import { BaseError, ContractFunctionRevertedError, ContractFunctionZeroDataError } from "viem";
import { baseSepoliaClient } from "./chain.js";

export interface CaseDetails {
  contractType: CaseContractType;
  parties: CaseParty[];
  statement?: string;
  reasoning?: string;
  statusCode?: number;
  status?: string;
  escrowAmount?: string;
  statementVerdict?: StatementVerdict;
  resolution?: CaseResolution;
}

/**
 * The contract's rule (contracts/agent_score.py): Agreement.sol only sends a case to the jury once
 * both sides submitted evidence; a default needs a dispute; a settlement never opens one.
 */
export function agreementResolution(aSubmitted: boolean, bSubmitted: boolean, disputedAt: bigint): CaseResolution {
  if (aSubmitted && bSubmitted) return "jury";
  return disputedAt > 0n ? "default" : "settlement";
}

type Abi = readonly unknown[];

/** True only when the call reached the chain and the contract reverted (the getter does not exist). */
function isRevert(e: unknown): boolean {
  if (e instanceof BaseError) {
    return !!e.walk((err) => err instanceof ContractFunctionRevertedError || (err instanceof ContractFunctionZeroDataError));
  }
  return false;
}

/**
 * Calls a view function, returning undefined if the contract does not implement it. Anything else
 * (a rate limit, an outage) is thrown, so a case is never stored with fields wrongly missing; the
 * next sync reads it again. The public Base node allows 25 requests per second.
 */
async function tryRead<T>(address: Address, abi: Abi, functionName: string): Promise<T | undefined> {
  try {
    return (await baseSepoliaClient().readContract({ address, abi: abi as never, functionName } as never)) as T;
  } catch (e) {
    if (isRevert(e)) return undefined;
    throw e;
  }
}

async function readAgreement(address: Address): Promise<CaseDetails | undefined> {
  const partyA = await tryRead<Address>(address, agreementAbi, "partyA");
  if (!partyA) return undefined;
  const [partyB, status, verdict, statement, reasoning, escrow, aSubmitted, bSubmitted, disputedAt] = await Promise.all([
    tryRead<Address>(address, agreementAbi, "partyB"),
    tryRead<number>(address, agreementAbi, "status"),
    tryRead<number>(address, agreementAbi, "verdict"),
    tryRead<string>(address, agreementAbi, "statement"),
    tryRead<string>(address, agreementAbi, "reasoning"),
    tryRead<bigint>(address, agreementAbi, "escrowAmount"),
    tryRead<boolean>(address, agreementAbi, "evidenceASubmitted"),
    tryRead<boolean>(address, agreementAbi, "evidenceBSubmitted"),
    tryRead<bigint>(address, agreementAbi, "disputeTimestamp"),
  ]);
  const ruled = status !== undefined && AGREEMENT_STATUS[status] === "RESOLVED";
  const readable = aSubmitted !== undefined && bSubmitted !== undefined && disputedAt !== undefined;
  const parties: CaseParty[] = [{ role: "partyA", address: normalizeAddress(partyA) }];
  if (partyB) parties.push({ role: "partyB", address: normalizeAddress(partyB) });
  return {
    contractType: "Agreement",
    parties,
    statement,
    reasoning: reasoning || undefined,
    statusCode: status,
    status: status === undefined ? undefined : AGREEMENT_STATUS[status],
    escrowAmount: escrow?.toString(),
    statementVerdict: verdict === undefined ? undefined : AGREEMENT_VERDICT[verdict],
    resolution: ruled && readable ? agreementResolution(aSubmitted!, bSubmitted!, disputedAt!) : undefined,
  };
}

async function readTradeFx(address: Address): Promise<CaseDetails | undefined> {
  const exporter = await tryRead<Address>(address, tradeFxAbi, "exporter");
  if (!exporter) return undefined;
  const [importer, status, statement, reason, invoice] = await Promise.all([
    tryRead<Address>(address, tradeFxAbi, "importer"),
    tryRead<number>(address, tradeFxAbi, "status"),
    tryRead<string>(address, tradeFxAbi, "shipmentStatement"),
    tryRead<string>(address, tradeFxAbi, "shipmentVerdictReason"),
    tryRead<bigint>(address, tradeFxAbi, "invoiceAmount"),
  ]);
  const parties: CaseParty[] = [{ role: "exporter", address: normalizeAddress(exporter) }];
  if (importer) parties.push({ role: "importer", address: normalizeAddress(importer) });
  return {
    contractType: "TradeFxSettlement",
    parties,
    statement: statement || undefined,
    reasoning: reason || undefined,
    statusCode: status,
    escrowAmount: invoice?.toString(),
    // Registered cases are only ever decided by the jury, through the bridge.
    resolution: reason ? "jury" : undefined,
  };
}

/** Last resort: try common role getters, and record who sent the registering transaction. */
async function readUnknown(address: Address, createdTx?: TxHash): Promise<CaseDetails> {
  const parties: CaseParty[] = [];
  const results = await Promise.all(genericRoleGetters.map((name) => tryRead<Address>(address, genericRoleAbi, name)));
  results.forEach((value, i) => {
    if (value && !/^0x0{40}$/i.test(value)) parties.push({ role: genericRoleGetters[i]!, address: normalizeAddress(value) });
  });
  if (createdTx) {
    try {
      const tx = await baseSepoliaClient().getTransaction({ hash: createdTx });
      if (!parties.some((p) => p.address === tx.from.toLowerCase())) {
        parties.push({ role: "initiator", address: normalizeAddress(tx.from) });
      }
    } catch {
      // The registering transaction is optional context; ignore lookup failures.
    }
  }
  return { contractType: "unknown", parties };
}

/** Reads a case contract with the first adapter that recognises it. */
export async function readCaseDetails(address: Address, createdTx?: TxHash): Promise<CaseDetails> {
  return (await readAgreement(address)) ?? (await readTradeFx(address)) ?? (await readUnknown(address, createdTx));
}
