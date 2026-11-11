// Finds provable same-owner links and (optionally) submits them to the AgentScore contract.
//
//   npm run prove --workspace @agentscore/prover -- --court            # every Internet Court party
//   npm run prove --workspace @agentscore/prover -- 0xabc... 0xdef...  # specific wallets
//   add --submit to send the proofs to the contract on StudioNet
//   add --outside-funders to include funders that are not Internet Court parties
//
// Base mainnet links come from Nansen (needs NANSEN_API_KEY); Base Sepolia links from Blockscout.
import { createAccount } from "genlayer-js";
import { Store, syncInternetCourt } from "@agentscore/indexer";
import { NansenClient } from "@agentscore/links";
import { isAddress, normalizeAddress, type Address } from "@agentscore/shared";
import { linkStored, StudioNetChain } from "./chain.js";
import { buildProofs, firstFundingFromBlockscout, firstFundingFromNansen, type FirstFunding } from "./discover.js";
import { loadSignerKey } from "./signer.js";
import { submitProof } from "./submit.js";

const args = process.argv.slice(2);
const submit = args.includes("--submit");
const court = args.includes("--court");
const wallets = new Set<Address>(args.filter(isAddress).map(normalizeAddress));

const store = await Store.open();
try {
  if (court) {
    await syncInternetCourt(store);
    for (const c of await store.allCases()) for (const p of c.parties) wallets.add(p.address);
  }
  if (wallets.size === 0) {
    console.error("Usage: prove [--court] [wallet ...] [--submit]");
    process.exit(1);
  }

  const nansen = new NansenClient(store);
  if (!nansen.enabled) console.log("NANSEN_API_KEY not set: skipping Base mainnet (Nansen) discovery.\n");

  const facts: FirstFunding[] = [];
  for (const w of wallets) {
    const results = [await firstFundingFromBlockscout(w), ...(nansen.enabled ? [await firstFundingFromNansen(nansen, w)] : [])];
    for (const r of results) {
      if ("error" in r) {
        console.log(`· ${w}: ${r.error}`);
        continue;
      }
      facts.push(r);
      const verdict = r.check.ok ? "provable" : `not provable (${r.check.reason})`;
      console.log(`· ${w}: first funded by ${r.funder}${r.funderLabel ? ` "${r.funderLabel}"` : ""} on ${r.network} via ${r.source}: ${verdict}`);
    }
  }
  if (nansen.enabled) console.log(`\nNansen credits used: ${nansen.creditsSpent}`);

  // A link counts when the funder is one of the wallets checked or any Internet Court party, so a
  // fresh wallet funded by a party with a court record is caught even when checked on its own.
  const known = new Set<Address>(wallets);
  for (const c of await store.allCases()) for (const p of c.parties) known.add(p.address);
  // --outside-funders also links a wallet to a funder with no court record yet. It changes no score
  // today, but ties the two records together if that funder ever ends up in court.
  if (args.includes("--outside-funders")) for (const f of facts) if (f.check.ok) known.add(f.funder);
  const proofs = buildProofs(facts, known);
  console.log(`\n${proofs.length} provable link(s):`);
  for (const p of proofs) console.log(`  ${p.kind} ${p.subject} ↔ ${p.other}\n    ${p.explanation}\n    proof ${JSON.stringify(p.proof)}`);

  if (submit && proofs.length) {
    const contract = process.env.AGENTSCORE_CONTRACT_ADDRESS as Address | undefined;
    if (!contract) throw new Error("AGENTSCORE_CONTRACT_ADDRESS is not set");
    const key = loadSignerKey();
    const chain = new StudioNetChain(contract, key);
    console.log(`\nSubmitting as ${createAccount(key).address} to ${contract}`);
    for (const p of proofs) {
      if (await linkStored(chain, p)) {
        console.log(`  skip ${p.subject} ↔ ${p.other}: already proven`);
        continue;
      }
      const r = await submitProof(p, contract, key);
      console.log(`  ${r.stored ? "stored" : `NOT stored${r.error ? ` (${r.error})` : ""}`} ${p.subject} ↔ ${p.other} (tx ${r.tx})`);
    }
  }
} finally {
  store.close();
}
