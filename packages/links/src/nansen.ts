import { NANSEN, type Address } from "@agentscore/shared";
import type { Store } from "@agentscore/indexer";

/** Nansen chain ids we use. Nansen does not index testnets. */
export type NansenChain = "base" | "ethereum";

export interface NansenRelatedWallet {
  address: string;
  address_label: string | null;
  relation: string;
  transaction_hash: string | null;
  block_timestamp: string | null;
  order: number;
  chain: string;
}

export interface NansenCounterparty {
  counterparty_address: string;
  counterparty_address_label: string[] | null;
  interaction_count: number;
  total_volume_usd: number;
  volume_in_usd: number;
  volume_out_usd: number;
}

interface NansenPage<T> {
  data: T[];
  pagination?: { page: number; per_page: number; is_last_page: boolean };
}

export class NansenBudgetError extends Error {}

/**
 * Minimal Nansen API v1 client (docs.nansen.ai/api/profiler).
 * Every response is cached for a day, and a per-process credit cap protects the free plan.
 */
export class NansenClient {
  private spent = 0;

  constructor(
    private readonly store: Store,
    private readonly apiKey = process.env.NANSEN_API_KEY ?? "",
    private readonly maxCredits = Number(process.env.NANSEN_MAX_CREDITS_PER_RUN ?? 40),
    private readonly cacheTtlMs = 24 * 60 * 60 * 1000,
  ) {}

  get enabled(): boolean {
    return this.apiKey.length > 0;
  }

  get creditsSpent(): number {
    return this.spent;
  }

  private async post<T>(path: string, body: object, credits: number): Promise<T> {
    const cacheKey = `nansen:${path}:${JSON.stringify(body)}`;
    const cached = await this.store.cacheGet<T>(cacheKey);
    if (cached !== undefined) return cached;
    if (!this.enabled) throw new Error("NANSEN_API_KEY is not set");
    if (this.spent + credits > this.maxCredits) {
      throw new NansenBudgetError(`Nansen credit cap reached (${this.spent}/${this.maxCredits})`);
    }
    const res = await fetch(`${NANSEN.baseUrl}${path}`, {
      method: "POST",
      headers: { apikey: this.apiKey, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Nansen ${res.status} for ${path}: ${(await res.text()).slice(0, 200)}`);
    this.spent += credits; // Nansen only charges for 2xx responses.
    const json = (await res.json()) as T;
    await this.store.cacheSet(cacheKey, json, this.cacheTtlMs);
    return json;
  }

  async relatedWallets(wallet: Address, chain: NansenChain): Promise<NansenRelatedWallet[]> {
    const body = { wallet_address: wallet, chain, pagination: { page: 1, per_page: 100 } };
    const page = await this.post<NansenPage<NansenRelatedWallet>>(
      "/api/v1/profiler/address/related-wallets",
      body,
      NANSEN.credits.relatedWallets,
    );
    return page.data ?? [];
  }

  async counterparties(wallet: Address, chain: NansenChain, days = 365): Promise<NansenCounterparty[]> {
    const to = new Date();
    const from = new Date(to.getTime() - days * 86_400_000);
    const body = {
      address: wallet,
      chain,
      date: { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) },
      group_by: "wallet",
      pagination: { page: 1, per_page: 50 },
      order_by: [{ field: "total_volume_usd", direction: "DESC" }],
    };
    const page = await this.post<NansenPage<NansenCounterparty>>(
      "/api/v1/profiler/address/counterparties",
      body,
      NANSEN.credits.counterparties,
    );
    return page.data ?? [];
  }
}
