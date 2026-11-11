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
// Only name a commit when the working copy of the contract is committed; otherwise the last
// commit that touched it holds a different (older) source than the one deployed.
const contractClean = sh("git status --porcelain contracts/agent_score.py") === "";
const contractCommit = contractClean ? sh("git log -1 --format=%H -- contracts/agent_score.py") || null : null;
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
    // The last commit that changed the contract, not HEAD, so later commits (like the one that
    // records this manifest) keep pointing at the source that was deployed.
    git_commit: contractCommit,
    git_blob_at_commit: contractCommit ? sh(`git rev-parse ${contractCommit}:contracts/agent_score.py`) : null,
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
    {
      address: "0x88F8cbBA953da2D934EDb94975F5281a3Cb06B91",
      deploy_tx: "0x88b48e1d0cd4e7f82e4a5bdb50c2f4c6bb796c4bed61fe4d9a7aae97a5a146f1",
      git_commit: "8f11d7d55ee1cddf6dd3fe5d197091bcbbe429ad",
      evidence: "deployments/studionet/superseded/v5/ (full demo, 12/12 steps proof, own release manifest)",
      why: "Worked as designed, replaced to (1) prove links on Base mainnet as well as Base Sepolia, reading transactions from the public Base RPC nodes instead of Blockscout, so Nansen-discovered mainnet funding can be verified; (2) add the exchange/faucet guard: v5 would have accepted a 'shared first funder' link between two strangers funded by the same faucet (a real case: both sides of Internet Court case 14 were funded by a faucet that had sent 18,881 transactions); (3) apply the user's new scoring table and require escrow for wallets with no history.",
    },
    {
      address: "0x07bf2207852FE8F47DDeE26C4f4F0B206D259e74",
      deploy_tx: "0xd51eca9436d7c6c19f79a638c40e3864d243273c16cdd79214e8409c796a73ee",
      git_commit: "3d1fd935d1055654edf475de710fa81fa0a2c7b2",
      evidence: "deployments/studionet/superseded/v6/ (13/13 demo steps proof, keeper passes, staged abuses and their scores, own release manifest)",
      why: "Worked as designed, replaced because (1) it counted default judgments and settlements as jury rulings: Internet Court's jury relay had stopped delivering verdicts, so every new case was decided without a jury, and two colluding wallets with no provable link could have minted wins for free; (2) it read a rate-limited RPC call (the public Base node allows 25 requests per second and counts every call in a batch) as a missing field, which could store a permanent unsupported_case_type or link_tx_not_found instead of retrying.",
    },
    {
      address: "0xF1a3D4079b19968D31FC47326849906C9F03EB89",
      deploy_tx: "0x6dc40dd9305820a8ce84c3cd52913a1c8fcc50355f4d768bec88c59c492210b3",
      git_commit: "5b3983587cc1767ddedcd3d200461826581af564",
      evidence: "deployments/studionet/superseded/v7/ (18/18 demo steps proof, keeper pass judging all 16 ruled cases, own release manifest)",
      why: "Worked as designed, replaced to (1) close a first-funding gap: v7 accepted any payment that arrived before a wallet's first transaction, so a stranger who saw an unused address could send dust first and prove 'first funded by me'; v8 also requires the funding to be the wallet's first money in (historical balance 0 before) and above a minimum amount; (2) put the remaining link kinds on-chain in two tiers: proven (direct deployer, shared deployer, multisig operator) and signals that only cap the escrow-free limit at $100 (shared cash-out, closed loop).",
    },
    {
      address: "0x07b633032CF870deca9829b85F3177cd7Fcca4A3",
      deploy_tx: "0x689c06e1b096017477adc7dc6f6e3db982b0ec71e13c1a26304e435c0dabbb18",
      git_commit: null,
      evidence: "deployments/studionet/superseded/v8-first-attempt/ (26 steps; all v8 link steps as intended)",
      why: "First v8 deployment, never committed separately: its source is the v8.1 file without the no-jury branch in judge_cases. Every new link step worked live (4 links stored, 5 attacks rejected with the intended errors), but staged case 20, decided by default judgment, finalized as MAJORITY_DISAGREE: validators were asked whether the loser failed to deliver with only Internet Court's stock default-judgment text to go on, and split. v8.1 never sends a case without a jury to validators; a loss in it is MINOR by rule.",
    },
  ],
  steps,
  readbacks,
  not_proven: [
    "Cases 0-18 are existing testnet cases on Base Sepolia created by other parties. Cases 19 and 20 were staged by this project (see staged_abuses) and every party in them is controlled by one operator; they were decided by Internet Court's default-judgment path, not by its AI jury, because the jury relay was not delivering verdicts.",
    "The Base mainnet link (step 17) was found by Nansen and verified by validators against mainnet.base.org, but its funder has no Internet Court record, so it changes no score today.",
    "No new case has been decided by Internet Court's AI jury since its relay stopped (last verdict at block ~39.07M): cases 15, 16 and the trade cases are older jury rulings; 19 and 20 are default judgments.",
    "StudioNet is a test network; scores move no funds.",
  ],
};

// Transactions sent by the keeper (apps/keeper), from its pass logs.
const keeperDir = `${dir}/keeper`;
manifest.keeper = [];
if (existsSync(keeperDir)) {
  const { readdirSync } = await import("node:fs");
  for (const f of readdirSync(keeperDir).filter((n) => n.endsWith(".log")).sort()) {
    for (const line of readFileSync(`${keeperDir}/${f}`, "utf8").split("\n")) {
      const judged = line.match(/judged case #(\d+) (0x[0-9a-f]{40}) \(tx (0x[0-9a-f]{64})\)/);
      const proved = line.match(/proved (\S+) (0x[0-9a-f]{40}) ↔ (0x[0-9a-f]{40}) \(tx (0x[0-9a-f]{64})\)/);
      // The prover CLI's submit lines: "stored <subject> ↔ <other> (tx 0x…)".
      const cliStored = line.match(/^\s*stored (0x[0-9a-f]{40}) ↔ (0x[0-9a-f]{40}) \(tx (0x[0-9a-f]{64})\)/);
      if (cliStored) manifest.keeper.push({ log: f, action: "prove_link", kind: "first_funded_by", subject: cliStored[1], other: cliStored[2], tx: cliStored[3], stored: true, via: "prover cli" });
      const failed = line.match(/(case #\d+ 0x[0-9a-f]{40}|link 0x[0-9a-f]{40} ↔ 0x[0-9a-f]{40}) not (?:judged|stored): (.*)$/);
      if (judged) manifest.keeper.push({ log: f, action: "judge_cases", case_id: Number(judged[1]), case: judged[2], tx: judged[3], stored: true });
      if (proved) manifest.keeper.push({ log: f, action: "prove_link", kind: proved[1], subject: proved[2], other: proved[3], tx: proved[4], stored: true });
      if (failed) manifest.keeper.push({ log: f, action: "failed", item: failed[1], error: failed[2] });
    }
  }
  manifest.keeper_notes =
    "Case #9 was reported failed in first-pass.log because the StudioNet RPC returned an HTML error page while the keeper polled for the receipt; a later read-back showed the case was judged on-chain anyway. The keeper now reads back after network errors.";
}

// The staged fake-win and fresh-wallet cases on Base Sepolia (scripts/stage-abuses.ts) and the
// scores the contract gave the wallets involved.
const stagedFile = "deployments/base-sepolia/staged-abuses.json";
if (existsSync(stagedFile)) {
  const staged = JSON.parse(readFileSync(stagedFile, "utf8"));
  // Scores come from the live demo's get_score read-backs.
  const scores = {};
  for (const [role, wallet] of Object.entries(staged.wallets)) {
    const block = readbacks[`get_score ${wallet.toLowerCase()}`];
    if (!block) continue;
    const field = (name) => block.match(new RegExp(`${name}: '?([A-Za-z0-9_]+)'?`))?.[1] ?? null;
    scores[role] = {
      wallet,
      grade: field("grade"),
      points: Number(field("points")),
      approval_limit_usd: Number(field("approval_limit_usd")),
      flags: [...(block.match(/flags: \[([^\]]*)\]/)?.[1].matchAll(/'([A-Z_]+)'/g) ?? [])].map((m) => m[1]),
      wins: Number(field("wins")),
      uncontested_wins: Number(field("uncontested_wins")),
      fake_wins: Number(field("fake_wins")),
      inherited_cases: Number(field("inherited_cases")),
    };
  }
  manifest.staged_abuses = {
    script: "scripts/stage-abuses.ts",
    network: staged.network,
    operator: staged.operator,
    wallets: staged.wallets,
    cases: staged.cases,
    base_sepolia_txs: staged.steps,
    resolution:
      "Internet Court's jury relay had not delivered a verdict since block ~39.07M (case 18's dispute of 2026-11-09 was still pending), so both cases were resolved through Agreement.resolveByDefault(): one side disputed and submitted evidence, the other stayed silent.",
    expected: {
      agentX: "won case 19 against sockS, a wallet agentX itself first funded: the win must count as fake (FAKE_WINS), not as a win",
      agentY: "lost case 20 to clientZ: one loss",
      successorN: "first funded by agentY after that loss, no cases of its own: must inherit agentY's loss (INHERITED_LOSSES) instead of scoring as a clean new wallet",
      clientZ: "won case 20 by default judgment against an unlinked wallet: an uncontested win (UNCONTESTED_WINS), so no points and escrow still required (NO_HISTORY)",
    },
    scores,
  };
}

// The v8 link kinds staged on Base Sepolia (scripts/stage-v8-links.ts): the proofs the live demo
// submits as steps 18-26 and what each was expected to do.
const stagedV8File = "deployments/base-sepolia/staged-v8-links.json";
if (existsSync(stagedV8File)) {
  const v8 = JSON.parse(readFileSync(stagedV8File, "utf8"));
  manifest.staged_v8_links = {
    script: "scripts/stage-v8-links.ts",
    network: v8.network,
    operator: v8.operator,
    wallets: v8.wallets,
    base_sepolia_txs: v8.steps,
    proofs: v8.proofs,
    note: "Every wallet is controlled by one operator. The busy wallet is an unrelated Base Sepolia bot that had sent over 100,000 transactions, used as an example of infrastructure.",
  };
}

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
