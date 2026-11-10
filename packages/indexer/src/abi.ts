import { parseAbi } from "viem";

/** Events from the verified InternetCourtFactory source on Base Sepolia. */
export const factoryEventsAbi = parseAbi([
  "event AgreementCreated(uint256 indexed id, address agreementAddress, address partyA, address partyB)",
  "event CaseRegistered(uint256 indexed id, address indexed caseAddress)",
  "event DisputeRequested(address indexed agreementAddress, uint256 timestamp)",
  "event VerdictReceived(address indexed agreementAddress, uint8 verdict)",
]);

export const factoryViewAbi = parseAbi([
  "function nextAgreementId() view returns (uint256)",
  "function agreements(uint256) view returns (address)",
]);

/** Standard Agreement contract (enum values from the verified Agreement.sol source). */
export const agreementAbi = parseAbi([
  "function partyA() view returns (address)",
  "function partyB() view returns (address)",
  "function status() view returns (uint8)",
  "function verdict() view returns (uint8)",
  "function statement() view returns (string)",
  "function reasoning() view returns (string)",
  "function escrowAmount() view returns (uint256)",
]);

export const AGREEMENT_STATUS = ["CREATED", "ACTIVE", "DISPUTED", "RESOLVING", "RESOLVED", "CANCELLED"] as const;
export const AGREEMENT_VERDICT = ["UNDETERMINED", "TRUE", "FALSE"] as const;

/** Registered case type seen on-chain (ids 0 and 1). Roles are exporter / importer. */
export const tradeFxAbi = parseAbi([
  "function exporter() view returns (address)",
  "function importer() view returns (address)",
  "function status() view returns (uint8)",
  "function shipmentStatement() view returns (string)",
  "function shipmentVerdictReason() view returns (string)",
  "function invoiceAmount() view returns (uint256)",
]);

/** Role getters tried on case contracts we have no adapter for. */
export const genericRoleGetters = [
  "partyA",
  "partyB",
  "buyer",
  "seller",
  "client",
  "provider",
  "requester",
  "worker",
  "employer",
  "freelancer",
] as const;

export const genericRoleAbi = parseAbi(genericRoleGetters.map((name) => `function ${name}() view returns (address)`));
