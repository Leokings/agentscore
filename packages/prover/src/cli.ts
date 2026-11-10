// Finds provable same-owner links and (optionally) submits them to the AgentScore contract.
//
//   npm run prove --workspace @agentscore/prover -- --court            # every Internet Court party
//   npm run prove --workspace @agentscore/prover -- 0xabc... 0xdef...  # specific wallets
//   add --submit to send the proofs to the contract on StudioNet
//
// Base mainnet links come from Nansen (needs NANSEN_API_KEY); Base Sepolia links from Blockscout.
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createAccount, createClient, generatePrivateKey } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { Store, syncInternetCourt } from "@agentscore/indexer";
import { NansenClient } from "@agentscore/links";
import { isAddress, normalizeAddress, type Address } from "@agentscore/shared";
import { buildProofs, firstFundingFromBlockscout, firstFundingFromNansen, type FirstFunding } from "./discover.js";
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

  const proofs = buildProofs(facts, wallets);
  console.log(`\n${proofs.length} provable link(s):`);
  for (const p of proofs) console.log(`  ${p.kind} ${p.subject} ↔ ${p.other}\n    ${p.explanation}\n    proof ${JSON.stringify(p.proof)}`);

  if (submit && proofs.length) {
    const contract = process.env.AGENTSCORE_CONTRACT_ADDRESS as Address | undefined;
    if (!contract) throw new Error("AGENTSCORE_CONTRACT_ADDRESS is not set");
    const key = signerKey();
    const reader = createClient({ chain: studionet });
    console.log(`\nSubmitting as ${createAccount(key).address} to ${contract}`);
    for (const p of proofs) {
      const existing = (await reader.readContract({ address: contract, functionName: "get_links", args: [p.subject], jsonSafeReturn: true })) as Record<string, string>;
      if (p.other in existing) {
        console.log(`  skip ${p.subject} ↔ ${p.other}: already proven`);
        continue;
      }
      const r = await submitProof(p, contract, key);
      console.log(`  ${r.stored ? "stored" : "NOT stored"} ${p.subject} ↔ ${p.other} (tx ${r.tx})`);
    }
  }
} finally {
  store.close();
}

/** StudioNet is gasless; the prover signs with its own test key, kept in the git-ignored .env. */
function signerKey(): `0x${string}` {
  const existing = process.env.AGENTSCORE_SIGNER_KEY;
  if (existing && /^0x[0-9a-fA-F]{64}$/.test(existing)) return existing as `0x${string}`;
  const key = generatePrivateKey();
  const envPath = resolve(import.meta.dirname, "../../../.env");
  const prefix = existsSync(envPath) && !readFileSync(envPath, "utf8").endsWith("\n") ? "\n" : "";
  appendFileSync(envPath, `${prefix}# StudioNet signer for the link prover (test network only)\nAGENTSCORE_SIGNER_KEY=${key}\n`);
  console.log(`Created a StudioNet signer key in .env (address ${createAccount(key).address}).`);
  return key;
}
