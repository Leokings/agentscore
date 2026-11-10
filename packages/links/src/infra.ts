import type { InfraKind } from "@agentscore/shared";

const PATTERNS: Array<[InfraKind, RegExp]> = [
  ["faucet", /faucet/i],
  ["bridge", /\b(bridge|across|stargate|layerzero|wormhole|hop protocol|orbiter|socket|li\.?fi|relay\.link|superbridge)\b/i],
  [
    "exchange",
    /\b(binance|coinbase|kraken|okx|bybit|kucoin|gate\.io|htx|huobi|bitget|mexc|crypto\.com|gemini|bitfinex|upbit|exchange|cex|hot wallet|deposit)\b/i,
  ],
  ["protocol", /\b(uniswap|aave|router|pool|vault|1inch|multicall|entrypoint|paymaster|gnosis safe|proxy|token contract)\b/i],
];

/**
 * A wallet that sent funds to more than this many distinct addresses is treated as infrastructure
 * (a faucet, exchange or payroll wallet), so two agents funded by it are not linked.
 */
export const FAN_OUT_INFRA_THRESHOLD = 200;

export function classifyLabel(label: string | undefined): InfraKind {
  if (!label) return "none";
  for (const [kind, re] of PATTERNS) if (re.test(label)) return kind;
  return "none";
}

export function classifyInfra(opts: { label?: string; fanOut?: number; isContract?: boolean }): InfraKind {
  const byLabel = classifyLabel(opts.label);
  if (byLabel !== "none") return byLabel;
  if ((opts.fanOut ?? 0) > FAN_OUT_INFRA_THRESHOLD) return "faucet";
  return "none";
}
