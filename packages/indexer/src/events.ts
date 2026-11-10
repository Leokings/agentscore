import { decodeEventLog } from "viem";
import { normalizeAddress, type Address, type TxHash } from "@agentscore/shared";
import { factoryEventsAbi } from "./abi.js";
import type { RawLog } from "./blockscout.js";
import type { Store } from "./store.js";

export type FactoryEvent =
  | { name: "AgreementCreated"; id: number; address: Address; partyA: Address; partyB: Address; block: number; tx: TxHash }
  | { name: "CaseRegistered"; id: number; address: Address; block: number; tx: TxHash }
  | { name: "DisputeRequested"; address: Address; block: number; tx: TxHash }
  | { name: "VerdictReceived"; address: Address; verdict: number; block: number; tx: TxHash };

/** Decodes a factory log. Returns undefined for events we do not track (e.g. OwnershipTransferred). */
export function decodeFactoryLog(log: RawLog): FactoryEvent | undefined {
  let decoded;
  try {
    decoded = decodeEventLog({ abi: factoryEventsAbi, topics: log.topics, data: log.data });
  } catch {
    return undefined;
  }
  const base = { block: log.blockNumber, tx: log.transactionHash };
  switch (decoded.eventName) {
    case "AgreementCreated":
      return {
        name: "AgreementCreated",
        id: Number(decoded.args.id),
        address: normalizeAddress(decoded.args.agreementAddress),
        partyA: normalizeAddress(decoded.args.partyA),
        partyB: normalizeAddress(decoded.args.partyB),
        ...base,
      };
    case "CaseRegistered":
      return { name: "CaseRegistered", id: Number(decoded.args.id), address: normalizeAddress(decoded.args.caseAddress), ...base };
    case "DisputeRequested":
      return { name: "DisputeRequested", address: normalizeAddress(decoded.args.agreementAddress), ...base };
    case "VerdictReceived":
      return { name: "VerdictReceived", address: normalizeAddress(decoded.args.agreementAddress), verdict: Number(decoded.args.verdict), ...base };
  }
}

/**
 * Applies events in chain order. Registration and dispute share a block for registered cases
 * (DisputeRequested is emitted first), so case creation is applied before the rest of its block.
 */
export async function applyEvents(store: Store, events: FactoryEvent[]): Promise<void> {
  const creations = events.filter((e) => e.name === "AgreementCreated" || e.name === "CaseRegistered");
  const others = events.filter((e) => e.name === "DisputeRequested" || e.name === "VerdictReceived");
  for (const e of creations) {
    if (e.name === "AgreementCreated") {
      await store.upsertCaseCreated({ id: e.id, address: e.address, kind: "agreement", createdBlock: e.block, createdTx: e.tx });
      await store.setParties(e.address, [
        { role: "partyA", address: e.partyA },
        { role: "partyB", address: e.partyB },
      ]);
    } else if (e.name === "CaseRegistered") {
      await store.upsertCaseCreated({ id: e.id, address: e.address, kind: "registered", createdBlock: e.block, createdTx: e.tx });
    }
  }
  for (const e of others) {
    if (e.name === "DisputeRequested") await store.markDisputed(e.address, e.block);
    else if (e.name === "VerdictReceived") await store.setVerdict(e.address, e.verdict, e.block);
  }
}
