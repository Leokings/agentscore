// Finds provable first-funding links among Internet Court parties on Base Sepolia:
// a native-value transfer F -> W mined at or before W's own nonce-0 transaction.
// Prints ready-to-submit prove_link proofs.   npx tsx scripts/find-funding-links.ts
import { blockscoutGet, Store } from "@agentscore/indexer";
import type { Address } from "@agentscore/shared";

interface Tx {
  hash: string;
  nonce: number;
  block_number: number;
  value: string;
  status: string;
  from: { hash: string };
  to: { hash: string } | null;
}

async function all(path: string, params: Record<string, string>, maxPages = 6): Promise<Tx[]> {
  const out: Tx[] = [];
  let next: Record<string, string | number> | undefined;
  for (let i = 0; i < maxPages; i++) {
    const body = await blockscoutGet<{ items: Tx[]; next_page_params: Record<string, string | number> | null }>(path, { ...params, ...(next ?? {}) });
    out.push(...body.items);
    if (!body.next_page_params) break;
    next = body.next_page_params;
  }
  return out;
}

const store = await Store.open();
const parties = new Set<Address>();
for (const c of await store.allCases()) for (const p of c.parties) parties.add(p.address);
console.log(`${parties.size} Internet Court parties`);

const found: object[] = [];
for (const w of parties) {
  const outgoing = await all(`/addresses/${w}/transactions`, { filter: "from" });
  const first = outgoing.find((t) => t.nonce === 0 && t.status === "ok");
  if (!first) continue;
  const incoming = await all(`/addresses/${w}/transactions`, { filter: "to" });
  const funding = incoming
    .filter((t) => t.status === "ok" && BigInt(t.value || "0") > 0n && t.block_number <= first.block_number)
    .sort((a, b) => a.block_number - b.block_number)[0];
  if (!funding) continue;
  const funder = funding.from.hash.toLowerCase() as Address;
  found.push({
    wallet: w,
    funder,
    funder_is_court_party: parties.has(funder),
    proof: { funding_tx: funding.hash, subject_first_tx: first.hash },
  });
}
console.log(JSON.stringify(found, null, 2));
store.close();
