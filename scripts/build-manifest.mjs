#!/usr/bin/env node
// Builds deployments/studionet/release-manifest.json from the live-demo log and saved receipts.
//   node scripts/build-manifest.mjs
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const dir = "deployments/studionet";
const receipts = `${dir}/receipts`;
const log = readFileSync(`${dir}/live-demo.log`, "utf8");
const source = readFileSync("contracts/agent_score.py", "utf8");
const sh = (cmd) => {
  try {
    return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
};

/** Pulls what matters out of a CLI receipt dump (it is JS-object text, not JSON). */
function readReceipt(file) {
  if (!existsSync(file)) return {};
  const t = readFileSync(file, "utf8");
  const all = (re) => [...t.matchAll(re)].map((m) => m[1]);
  const votes = {};
  for (const m of t.matchAll(/'(0x[0-9A-Fa-f]{40})': '(agree|disagree|idle|timeout|deterministic_violation)'/g)) votes[m[1]] = m[2];
  return {
    status: all(/status_name: '([A-Z_]+)'/g).at(-1) ?? null,
    consensus_result: all(/result_name: '([A-Z_]+)'/g).at(-1) ?? null,
    leader_execution: all(/execution_result: '([A-Z]+)'/g)[0] ?? null,
    leader_error: t.match(/\[(?:EXPECTED|EXTERNAL|TRANSIENT|LLM_ERROR)\] [a-z0-9_]+/)?.[0] ?? null,
    votes,
  };
}

const steps = log
  .split("\n")
  .filter((l) => l.startsWith('{"label"'))
  .map((l) => JSON.parse(l))
  .map((s) => {
    const r = readReceipt(`${receipts}/${s.label}.receipt.txt`);
    const expectedFailure = s.label.includes("EXPECTED");
    const proof = r.status === "FINALIZED" && (expectedFailure ? r.leader_execution === "ERROR" && !!r.leader_error : r.leader_execution === "SUCCESS");
    return { label: s.label, tx: s.tx, expected_failure: expectedFailure, ...r, counts_as_proof: proof };
  });

// Read-backs: the "--- <call>" headers followed by the CLI's printed object.
const readbacks = {};
let current = null;
for (const line of log.split("\n")) {
  if (line.startsWith("--- ")) {
    current = line.slice(4).trim();
    readbacks[current] = "";
  } else if (current && !line.startsWith('{"label"')) {
    readbacks[current] += line + "\n";
  }
}
for (const k of Object.keys(readbacks)) readbacks[k] = readbacks[k].trim();

const deploy = steps.find((s) => s.label === "00-deploy") ?? {};
const contract = readFileSync(`${dir}/CONTRACT`, "utf8").trim();
const manifest = {
  project: "AgentScore",
  network: { name: "studionet", chain_id: 61999, rpc: "https://studio.genlayer.com/api", explorer: "https://genlayer-explorer.vercel.app" },
  contract: {
    address: contract,
    file: "contracts/agent_score.py",
    runner: source.match(/py-genlayer:([0-9a-z]+)/)?.[1] ?? null,
    sha256: createHash("sha256").update(source).digest("hex"),
    git_blob: sh("git hash-object contracts/agent_score.py"),
    git_commit: sh("git rev-parse HEAD"),
    git_clean_for_contract: sh("git status --porcelain contracts/agent_score.py") === "",
    constructor_args: [],
    deploy_tx: deploy.tx ?? null,
    deployed_source_identical: null, // filled in below
  },
  deployer: sh("genlayer account 2>&1 | grep -oE \"address: '0x[0-9a-fA-F]{40}'\" | grep -oE '0x[0-9a-fA-F]{40}'"),
  toolchain: {
    node: process.version,
    genlayer_cli: sh("genlayer --version"),
    genlayer_js: JSON.parse(readFileSync("node_modules/genlayer-js/package.json", "utf8")).version,
    genvm_linter: sh("python -m pip show genvm-linter")?.match(/Version: (\S+)/)?.[1] ?? null,
    genlayer_test: sh("python -m pip show genlayer-test")?.match(/Version: (\S+)/)?.[1] ?? null,
  },
  probe: {
    file: "contracts/probe/web_probe.py",
    address: "0xbfCc46A498b882bcF9eFc45d9a7291f147d9C079",
    deploy_tx: "0x7d8fae59269169d9fb5470fa6c4d708464ae4d3ad480b063d200d83c94ffa36d",
    probe_tx: "0xb6648ac0aafcfc7492bdf6769a88f523eccfcea172e641e64ca5565a8c16e350",
    result: "Both FINALIZED with leader SUCCESS. GenVM reached the Base Sepolia RPC (POST eth_call returned agreements(0)) and Blockscout (GET transaction).",
  },
  superseded_deployments: [
    {
      address: "0x4a12008D8EaebE3c17B7C3aa69B4ef8D585169BC",
      deploy_tx: "0xf5e3083f6fa87f4cf3bcb7fb6c1d0a2a63ccebde9618312c47551f02a1e436d2",
      attempt_tx: "0x718d3c8ef05e19a1d1968abcc171692fbd6a13f3455368eb6f6120bb837e57d7",
      why: "judge_cases rejected the CLI's Address-typed arguments ([EXPECTED] invalid_address). Fixed by accepting calldata Address values.",
    },
    {
      address: "0x1112e434dAB571d6BEEB36BDEdAF615aAE33D49A",
      deploy_tx: "0x3f7a4c709e7c5afc052f230df14f4620adad63c44afcc71e87498d8cd4549960",
      attempt_tx: "0x8112b64972d78b2eae7f5358075103c33589724929210080371fcc2c1bf8ccc3",
      why: "Case 15 finalized as MAJORITY_DISAGREE and stored nothing: per-party outcome + 3-level severity was too loose for different models to match exactly. Fixed by taking the winner from the on-chain verdict and asking validators two yes/no findings.",
    },
    {
      address: "0x5d212eEd9134eF1799486377fDb16B96b46AFF0a",
      deploy_tx: "0x90cd66d7fa7ae3da1e4d59548f505017ef801e63d7ceaf33467705dd71c3de7e",
      attempt_tx: "0x27d8a90807893cb68a51553ab09695d7d619d58d4f965b6d81161e3e4a2ac57c",
      why: "Operator error: the link proof was passed double-encoded, so the contract rejected it ([EXPECTED] invalid_proof_json). The CLI also turns 64-hex strings into integers, so prove_link now accepts the CLI's decoded dict as well. Cases 15, 16 and trade cases 0 and 1 had been judged successfully on this deployment (3/3 agree each).",
    },
    {
      address: "0xFC9f3DFce2f9B5B3A7Ed24Fbc26c1987cD41E649",
      deploy_tx: "0xb8c2c52657002b2337f77845ce36f4cb919bc653e5112d6d4fe0cb9ab53c29f5",
      evidence: "deployments/studionet/superseded/v4/",
      why: "Full demo ran (all 11 steps FINALIZED, 3/3 agree), but the read-back exposed a design flaw: 0x05e7 inherited 0xce41's losses only because 0xce41 had paid it, and anyone can pay anyone, so a 'paid' link let a bad wallet smear an honest one. The 'paid' kind was removed; only first-funding proofs anchored to the wallet's nonce-0 transaction remain. Step 09 on v4 also hit link_already_proven instead of the intended forgery check, because the pair had just been linked (operator ordering mistake).",
    },
  ],
  steps,
  readbacks,
  not_proven: [
    "Internet Court cases used here are the existing testnet cases on Base Sepolia, created by other parties; none of them is a deliberate fake-win or fresh-wallet scenario. Those two abuses are demonstrated in direct-mode tests, not on-chain.",
    "StudioNet is a test network; scores move no funds.",
  ],
};

// Deployed source must be byte-identical to the file.
try {
  const { createClient } = await import("genlayer-js");
  const { studionet } = await import("genlayer-js/chains");
  const code = await createClient({ chain: studionet }).getContractCode(contract);
  manifest.contract.deployed_source_identical = code === source;
  manifest.contract.deployed_sha256 = createHash("sha256").update(code).digest("hex");
} catch (e) {
  manifest.contract.deployed_source_identical = `check failed: ${e.message}`;
}

writeFileSync(`${dir}/release-manifest.json`, JSON.stringify(manifest, null, 2) + "\n");
const bad = steps.filter((s) => !s.counts_as_proof);
console.log(`${steps.length} steps, ${steps.length - bad.length} count as proof${bad.length ? `; not proof: ${bad.map((s) => s.label).join(", ")}` : ""}`);
console.log(`deployed source identical: ${manifest.contract.deployed_source_identical}`);
