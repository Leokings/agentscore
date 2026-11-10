import { createPublicClient, http, type PublicClient } from "viem";
import { baseSepolia } from "viem/chains";

let client: PublicClient | undefined;

export function baseSepoliaClient(): PublicClient {
  client ??= createPublicClient({
    chain: baseSepolia,
    transport: http(process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org", {
      // The public node allows 25 requests per second; back off and retry instead of failing.
      retryCount: 6,
      retryDelay: 1000,
    }),
  }) as PublicClient;
  return client;
}
