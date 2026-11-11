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

export interface NansenTransaction {
  chain: string;
  method: string;
  transaction_hash: string;
  block_timestamp: string;
  volume_usd?: number | null;
}

interface NansenPage<T> {
  data: T[];
  pagination?: { page: number; per_page: number; is_last_page: boolean };
}

export class NansenBudgetError extends Error {}

const DAY_MS = 24 * 60 * 60 * 1000;
/** For facts that can never change once they exist (a wallet's first funder, its earliest txs). */
const FOREVER_MS = 100 * 365 * DAY_MS;
/** An empty answer may change once the wallet starts transacting: ask again after a week. */
const EMPTY_RECHECK_MS = 7 * DAY_MS;

interface CacheRule<T> {
  /** Stable cache key: never includes today's date, so a cached answer is reused across days. */
  key: string;
  ttlMs: (result: T) => number;
  /** Older cache key for the same request, reused instead of paying for the call again. */
  legacyKey?: string;
}

/**
 * Minimal Nansen API v1 client (docs.nansen.ai/api/profiler).
 *
 * The free plan is 100 one-time credits and then a top-up to 10 per day, so credits are guarded
 * three ways: answers that cannot change are cached for good; a per-process cap
 * (NANSEN_MAX_CREDITS_PER_RUN); and a daily budget shared by every process through the database
 * (NANSEN_DAILY_CREDITS, counted per UTC day), so hourly keeper runs and API instances together
 * never spend more than that in a day.
 */
export class NansenClient {
  private spent = 0;

  constructor(
    private readonly store: Store,
    private readonly apiKey = process.env.NANSEN_API_KEY ?? "",
    private readonly maxCredits = Number(process.env.NANSEN_MAX_CREDITS_PER_RUN ?? 40),
    private readonly dailyCredits = Number(process.env.NANSEN_DAILY_CREDITS ?? 8),
    private readonly now: () => number = Date.now,
  ) {}

  get enabled(): boolean {
    return this.apiKey.length > 0;
  }

  get creditsSpent(): number {
    return this.spent;
  }

  private dayKey(): string {
    return `nansen:credits:${new Date(this.now()).toISOString().slice(0, 10)}`;
  }

  /** Credits spent today by every process sharing this database. */
  async spentToday(): Promise<number> {
    return Number((await this.store.getMeta(this.dayKey())) ?? 0);
  }

  private async post<T>(path: string, body: object, credits: number, cache: CacheRule<T>): Promise<T> {
    const cached = await this.store.cacheGet<T>(cache.key);
    if (cached !== undefined) return cached;
    if (cache.legacyKey) {
      const old = await this.store.cacheGet<T>(cache.legacyKey);
      if (old !== undefined) {
        await this.store.cacheSet(cache.key, old, cache.ttlMs(old));
        return old;
      }
    }
    if (!this.enabled) throw new Error("NANSEN_API_KEY is not set");
    if (this.spent + credits > this.maxCredits) {
      throw new NansenBudgetError(`Nansen credit cap for this run reached (${this.spent}/${this.maxCredits})`);
    }
    // Nansen already refused today (its own per-key daily limit): don't ask again until tomorrow.
    if (await this.store.getMeta(`${this.dayKey()}:refused`)) {
      throw new NansenBudgetError("Nansen refused further calls today (the key's daily limit)");
    }
    const today = await this.spentToday();
    if (today + credits > this.dailyCredits) {
      throw new NansenBudgetError(`Nansen daily credit budget reached (${today}/${this.dailyCredits} today)`);
    }
    const res = await fetch(`${NANSEN.baseUrl}${path}`, {
      method: "POST",
      headers: { apikey: this.apiKey, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = (await res.text()).slice(0, 200);
      if (res.status === 429 && /daily credit limit/i.test(text)) {
        await this.store.setMeta(`${this.dayKey()}:refused`, "1");
        throw new NansenBudgetError(`Nansen refused: ${text}`);
      }
      throw new Error(`Nansen ${res.status} for ${path}: ${text}`);
    }
    // Nansen only charges for 2xx responses.
    this.spent += credits;
    await this.store.setMeta(this.dayKey(), String((await this.spentToday()) + credits));
    const json = (await res.json()) as T;
    await this.store.cacheSet(cache.key, json, cache.ttlMs(json));
    return json;
  }

  async relatedWallets(wallet: Address, chain: NansenChain): Promise<NansenRelatedWallet[]> {
    const path = "/api/v1/profiler/address/related-wallets";
    const body = { wallet_address: wallet, chain, pagination: { page: 1, per_page: 100 } };
    const page = await this.post<NansenPage<NansenRelatedWallet>>(path, body, NANSEN.credits.relatedWallets, {
      key: `nansen:related:${chain}:${wallet}`,
      legacyKey: `nansen:${path}:${JSON.stringify(body)}`,
      // Once a First Funder is known it never changes; other relations are re-read weekly.
      ttlMs: (r) => ((r.data ?? []).some((w) => /first funder/i.test(w.relation)) ? FOREVER_MS : EMPTY_RECHECK_MS),
    });
    return page.data ?? [];
  }

  /** The wallet's earliest transactions, oldest first (1 credit). */
  async earliestTransactions(wallet: Address, chain: NansenChain, perPage = 10): Promise<NansenTransaction[]> {
    const path = "/api/v1/profiler/address/transactions";
    const body = {
      address: wallet,
      chain,
      date: { from: "2023-06-01", to: new Date(this.now()).toISOString().slice(0, 10) },
      hide_spam_token: true,
      pagination: { page: 1, per_page: perPage },
      order_by: [{ field: "block_timestamp", direction: "ASC" }],
    };
    const page = await this.post<NansenPage<NansenTransaction>>(path, body, NANSEN.credits.transactions, {
      key: `nansen:earliest:${chain}:${wallet}:${perPage}`,
      legacyKey: `nansen:${path}:${JSON.stringify(body)}`,
      // A wallet's earliest transactions are history: they never change once there are any.
      ttlMs: (r) => ((r.data ?? []).length > 0 ? FOREVER_MS : EMPTY_RECHECK_MS),
    });
    return page.data ?? [];
  }

  async counterparties(wallet: Address, chain: NansenChain, days = 365): Promise<NansenCounterparty[]> {
    const path = "/api/v1/profiler/address/counterparties";
    const to = new Date(this.now());
    const from = new Date(to.getTime() - days * DAY_MS);
    const body = {
      address: wallet,
      chain,
      date: { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) },
      group_by: "wallet",
      pagination: { page: 1, per_page: 50 },
      order_by: [{ field: "total_volume_usd", direction: "DESC" }],
    };
    const page = await this.post<NansenPage<NansenCounterparty>>(path, body, NANSEN.credits.counterparties, {
      key: `nansen:counterparties:${chain}:${wallet}:${days}`,
      legacyKey: `nansen:${path}:${JSON.stringify(body)}`,
      // Counterparties keep changing, but a week-old view is fine for signals (5 credits a call).
      ttlMs: () => EMPTY_RECHECK_MS,
    });
    return page.data ?? [];
  }
}
