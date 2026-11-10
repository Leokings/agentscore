import { createPublicClient, http, type PublicClient } from "viem";
import { baseSepolia } from "viem/chains";

let client: PublicClient | undefined;

export function baseSepoliaClient(): PublicClient {
  client ??= createPublicClient({
    chain: baseSepolia,
    transport: http(process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org", {
      retryCount: 3,
      retryDelay: 500,
    }),
  }) as PublicClient;
  return client;
}
