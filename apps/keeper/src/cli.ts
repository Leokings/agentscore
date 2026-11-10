// Keeps the AgentScore contract current: judges newly ruled Internet Court cases and submits
// newly discoverable same-owner links.
//
//   npm run once  --workspace @agentscore/keeper              # one pass
//   npm run once  --workspace @agentscore/keeper -- --dry-run # show what it would send
//   npm run start --workspace @agentscore/keeper              # every KEEPER_INTERVAL_MIN minutes
import { Store } from "@agentscore/indexer";
import { NansenClient } from "@agentscore/links";
import { loadSignerKey, StudioNetChain } from "@agentscore/prover";
import type { Address } from "@agentscore/shared";
import { runOnce } from "./run.js";

const args = process.argv.slice(2);
const once = args.includes("--once");
const dryRun = args.includes("--dry-run");
const intervalMin = Number(process.env.KEEPER_INTERVAL_MIN ?? 10);
const contract = process.env.AGENTSCORE_CONTRACT_ADDRESS as Address | undefined;
if (!contract) {
  console.error("AGENTSCORE_CONTRACT_ADDRESS is not set");
  process.exit(1);
}

const log = (msg: string) => console.log(`[${new Date().toISOString()}] ${msg}`);

async function pass(): Promise<void> {
  const store = await Store.open();
  try {
    const chain = new StudioNetChain(contract!, dryRun ? ("0x" + "1".repeat(64)) as `0x${string}` : loadSignerKey(log));
    const nansen = new NansenClient(store);
    if (!nansen.enabled) log("NANSEN_API_KEY not set: Base mainnet links are skipped this pass.");
    const r = await runOnce({ store, chain, nansen, log, dryRun, maxWrites: Number(process.env.KEEPER_MAX_WRITES ?? 20) });
    log(
      `pass done: ${r.judged.length} judged, ${r.alreadyOnChain.length} already on-chain, ${r.linksProven.length} links proven, ` +
        `${r.failed.length} failed, ${r.writes} writes${dryRun ? `, ${r.wouldWrite.length} would be written` : ""}`,
    );
    for (const w of r.wouldWrite) log(`  would ${w}`);
    for (const f of r.failed) log(`  failed ${f.item}: ${f.error}`);
  } finally {
    store.close();
  }
}

await pass();
if (!once && !dryRun) {
  log(`next pass in ${intervalMin} min`);
  setInterval(() => void pass().catch((e) => log(`pass crashed: ${(e as Error).message}`)), intervalMin * 60 * 1000);
}
