import type { Address } from "./types.js";

/** Verified on Base Sepolia on 2026-11-09. See docs/internet-court-onchain-notes.md. */
export const INTERNET_COURT = {
  chainId: 84532,
  factory: "0xd533cb0b52e85b3f506b6f0c28b8f6bc4e449dda" as Address,
  factoryDeploymentBlock: 38576182,
  mockUsdc: "0x58c27c7c1ff5dbf480c956acf6b119508b6fba4f" as Address,
  bridgeReceiver: "0xc3e6ae892a704c875bf74df46ed873308db15d82" as Address,
  blockscoutApi: "https://base-sepolia.blockscout.com/api/v2",
  /** Public RPC limit for eth_getLogs, confirmed by a -32614 error. */
  maxLogBlockRange: 200,
} as const;

export const NANSEN = {
  baseUrl: "https://api.nansen.ai",
  /** Credit cost per successful call (docs.nansen.ai/getting-started/credits, 2026-11). */
  credits: {
    relatedWallets: 1,
    firstFunder: 1,
    transactions: 1,
    counterparties: 5,
  },
} as const;
