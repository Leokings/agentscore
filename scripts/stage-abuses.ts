#!/usr/bin/env tsx
/**
 * Stages the two abuses AgentScore defends against, as real Internet Court cases on Base Sepolia:
 *
 *   Fake win:    agent X opens a case against S, a wallet X itself funded, and wins it by default.
 *                AgentScore should prove S <- X and refuse to count the win.
 *   Fresh wallet: agent Y loses a case to an independent client Z, then funds a brand-new wallet N.
 *                AgentScore should prove N <- Y and carry Y's loss over to N.
 *
 * Internet Court's jury relay has not delivered a verdict since block ~39.07M (case 18's dispute
 * from 2026-11-09 is still pending), so both cases are resolved through the Agreement contract's
 * own default-judgment path: one side disputes and submits evidence, the other stays silent, and
 * after the evidence window anyone can call resolveByDefault().
 *
 * Every top-level wallet (X, Y, Z) is first funded through its own one-off hop wallet, so the only
 * one-hop funding links between court parties are the two the demo is about.
 *
 * Resumable: each finished step is recorded in deployments/base-sepolia/staged-abuses.json, and a
 * sent-but-unconfirmed transaction is looked up again instead of being resent. Private keys for the
 * demo wallets live in data/demo-wallets.json (gitignored). The operator wallet is the
 * AGENTSCORE_SIGNER_KEY from .env.
 *
 *   npx tsx --env-file-if-exists=.env scripts/stage-abuses.ts
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  formatEther,
  http,
  parseAbi,
  parseEther,
  zeroAddress,
  type Address,
  type Hash,
  type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

const FACTORY = "0xd533cB0B52E85b3F506b6f0c28b8f6bc4E449Dda" as const;
const RPC = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
const STATE_FILE = "deployments/base-sepolia/staged-abuses.json";
const KEYS_FILE = "data/demo-wallets.json";
const EVIDENCE_WINDOW_S = 30n;
const CONSTRAINTS = "AgentScore staged abuse demo: every party is controlled by one operator.";

const factoryAbi = parseAbi([
  "function createAgreement(address partyB, string _statement, string _guidelines, string _evidenceDefs, uint256 _evidenceDeadlineSeconds, address _usdcToken, uint256 _escrowAmount, uint256 _joinDeadline, uint256 _maxEvidenceLength, string _constraints) returns (address)",
  "event AgreementCreated(uint256 indexed id, address agreementAddress, address partyA, address partyB)",
]);
const agreementAbi = parseAbi([
  "function acceptAgreement()",
  "function raiseDispute()",
  "function submitEvidence(string evidence)",
  "function resolveByDefault()",
  "function status() view returns (uint8)",
  "function verdict() view returns (uint8)",
  "function reasoning() view returns (string)",
  "function disputeTimestamp() view returns (uint256)",
]);

type Role = "hubX" | "hubY" | "hubZ" | "agentX" | "sockS" | "agentY" | "clientZ" | "successorN";
const ROLES: Role[] = ["hubX", "hubY", "hubZ", "agentX", "sockS", "agentY", "clientZ", "successorN"];

interface State {
  network: "base-sepolia";
  factory: Address;
  operator: Address;
  wallets: Partial<Record<Role, Address>>;
  cases: Record<string, { id: number; address: Address }>;
  steps: Record<string, { tx: Hash; block: number }>;
  pending: Record<string, Hash>;
}

function load<T>(file: string, fallback: T): T {
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as T) : fallback;
}
function save(file: string, data: unknown) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

const operatorKey = process.env.AGENTSCORE_SIGNER_KEY as Hex | undefined;
if (!operatorKey) throw new Error("AGENTSCORE_SIGNER_KEY missing from .env");
const operator = privateKeyToAccount(operatorKey);

const keys = load<Partial<Record<Role, Hex>>>(KEYS_FILE, {});
for (const r of ROLES) keys[r] ??= generatePrivateKey();
save(KEYS_FILE, keys);
const acct = Object.fromEntries(ROLES.map((r) => [r, privateKeyToAccount(keys[r]!)])) as Record<Role, ReturnType<typeof privateKeyToAccount>>;

const state = load<State>(STATE_FILE, { network: "base-sepolia", factory: FACTORY, operator: operator.address, wallets: {}, cases: {}, steps: {}, pending: {} });
for (const r of ROLES) state.wallets[r] = acct[r].address;
save(STATE_FILE, state);

const pub = createPublicClient({ chain: baseSepolia, transport: http(RPC, { retryCount: 5, retryDelay: 1500 }) });
const walletFor = (a: ReturnType<typeof privateKeyToAccount>) => createWalletClient({ account: a, chain: baseSepolia, transport: http(RPC, { retryCount: 5, retryDelay: 1500 }) });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function receipt(hash: Hash) {
  for (let i = 0; ; i++) {
    try {
      return await pub.waitForTransactionReceipt({ hash, timeout: 120_000 });
    } catch (e) {
      if (i >= 4) throw e;
      await sleep(3000);
    }
  }
}

/** Runs a step once. `send` returns the tx hash; it is recorded before waiting so a crash never resends. */
async function step(name: string, send: () => Promise<Hash>, after?: (r: Awaited<ReturnType<typeof receipt>>) => void) {
  if (state.steps[name]) return console.log(`✓ ${name} (already done, tx ${state.steps[name].tx})`);
  let hash = state.pending[name];
  if (!hash) {
    hash = await send();
    state.pending[name] = hash;
    save(STATE_FILE, state);
  }
  const r = await receipt(hash);
  if (r.status !== "success") throw new Error(`${name}: transaction ${hash} reverted`);
  after?.(r);
  state.steps[name] = { tx: hash, block: Number(r.blockNumber) };
  delete state.pending[name];
  save(STATE_FILE, state);
  console.log(`✓ ${name}  tx ${hash}  block ${r.blockNumber}`);
}

const pay = (from: ReturnType<typeof privateKeyToAccount>, to: Address, eth: string) => () =>
  walletFor(from).sendTransaction({ to, value: parseEther(eth) });

const call = (from: ReturnType<typeof privateKeyToAccount>, address: Address, functionName: "acceptAgreement" | "raiseDispute" | "resolveByDefault") => () =>
  walletFor(from).writeContract({ address, abi: agreementAbi, functionName });

async function createCase(key: string, from: ReturnType<typeof privateKeyToAccount>, partyB: Address, statement: string, guidelines: string, evidenceDefs: string) {
  await step(
    `${key}:create`,
    () =>
      walletFor(from).writeContract({
        address: FACTORY,
        abi: factoryAbi,
        functionName: "createAgreement",
        args: [partyB, statement, guidelines, evidenceDefs, EVIDENCE_WINDOW_S, zeroAddress, 0n, 0n, 0n, CONSTRAINTS],
      }),
    (r) => {
      for (const log of r.logs) {
        if (log.address.toLowerCase() !== FACTORY.toLowerCase()) continue;
        try {
          const ev = decodeEventLog({ abi: factoryAbi, data: log.data, topics: log.topics });
          if (ev.eventName === "AgreementCreated") state.cases[key] = { id: Number(ev.args.id), address: ev.args.agreementAddress };
        } catch {}
      }
      if (!state.cases[key]) throw new Error(`${key}: no AgreementCreated event in the receipt`);
    },
  );
  return state.cases[key]!.address;
}

/** Waits until the chain's clock is past the case's evidence window. */
async function waitOutEvidenceWindow(address: Address) {
  const disputedAt = await pub.readContract({ address, abi: agreementAbi, functionName: "disputeTimestamp" });
  for (;;) {
    const block = await pub.getBlock();
    if (block.timestamp > disputedAt + EVIDENCE_WINDOW_S) return;
    await sleep(5000);
  }
}

async function main() {
  const bal = await pub.getBalance({ address: operator.address });
  console.log(`operator ${operator.address}: ${formatEther(bal)} ETH on Base Sepolia`);

  // 1. Funding. Hubs give X, Y and Z their first funds so none of them shares a one-hop funder.
  await step("fund:hubX", pay(operator, acct.hubX.address, "0.00012"));
  await step("fund:hubY", pay(operator, acct.hubY.address, "0.00012"));
  await step("fund:hubZ", pay(operator, acct.hubZ.address, "0.00010"));
  await step("fund:agentX", pay(acct.hubX, acct.agentX.address, "0.0001"));
  await step("fund:agentY", pay(acct.hubY, acct.agentY.address, "0.0001"));
  await step("fund:clientZ", pay(acct.hubZ, acct.clientZ.address, "0.00008"));
  // The fake-win sock puppet: X gives S its first funds before S ever transacts.
  await step("fund:sockS", pay(acct.agentX, acct.sockS.address, "0.00003"));

  // 2. Fake win: X claims a delivery, S (X's own wallet) never answers the dispute, X wins by default.
  const fake = await createCase(
    "fakeWin",
    acct.agentX,
    acct.sockS.address,
    `Agent ${acct.agentX.address} delivered a complete wallet-risk report for job F-1 to ${acct.sockS.address} by 2026-11-10 18:00 UTC, as agreed.`,
    "TRUE if the full report was delivered by the deadline. FALSE if it was late, incomplete or never delivered.",
    "Party A: delivery receipt (timestamp and file hash). Party B: anything showing the report was late or incomplete.",
  );
  await step("fakeWin:accept", call(acct.sockS, fake, "acceptAgreement"));
  await step("fakeWin:dispute", call(acct.agentX, fake, "raiseDispute"));
  await step("fakeWin:evidence", () =>
    walletFor(acct.agentX).writeContract({ address: fake, abi: agreementAbi, functionName: "submitEvidence", args: ["Report delivered 2026-11-10 16:42 UTC, sha256 9f2c1e7a0b. Client never replied."] }),
  );
  await waitOutEvidenceWindow(fake);
  await step("fakeWin:resolve", call(acct.agentX, fake, "resolveByDefault"));

  // 3. A real-looking loss: Y claims a delivery, client Z disputes with evidence, Y stays silent.
  const loss = await createCase(
    "loss",
    acct.agentY,
    acct.clientZ.address,
    `Agent ${acct.agentY.address} delivered the full 10,000-row labelled dataset for job L-1 to ${acct.clientZ.address} by 2026-11-10 18:00 UTC, as agreed.`,
    "TRUE if all 10,000 labelled rows were delivered by the deadline. FALSE if rows were missing, duplicated or late.",
    "Party A: delivery receipt and row count. Party B: audit of what was actually delivered.",
  );
  await step("loss:accept", call(acct.clientZ, loss, "acceptAgreement"));
  await step("loss:dispute", call(acct.clientZ, loss, "raiseDispute"));
  await step("loss:evidence", () =>
    walletFor(acct.clientZ).writeContract({ address: loss, abi: agreementAbi, functionName: "submitEvidence", args: ["Audit: 6,140 rows delivered, 1,980 of them duplicates; agent stopped responding after payment."] }),
  );
  await waitOutEvidenceWindow(loss);
  await step("loss:resolve", call(acct.clientZ, loss, "resolveByDefault"));

  // 4. Fresh wallet: after the loss, Y funds a brand-new wallet N, which then starts transacting.
  await step("fund:successorN", pay(acct.agentY, acct.successorN.address, "0.00002"));
  await step("successorN:firstTx", pay(acct.successorN, acct.successorN.address, "0"));

  // 5. Read back what Internet Court recorded.
  const VERDICT = ["UNDETERMINED", "TRUE", "FALSE"];
  for (const [key, c] of Object.entries(state.cases)) {
    const [status, verdict, reasoning] = await Promise.all([
      pub.readContract({ address: c.address, abi: agreementAbi, functionName: "status" }),
      pub.readContract({ address: c.address, abi: agreementAbi, functionName: "verdict" }),
      pub.readContract({ address: c.address, abi: agreementAbi, functionName: "reasoning" }),
    ]);
    console.log(`case #${c.id} (${key}) ${c.address}: status ${status === 4 ? "RESOLVED" : status}, verdict ${VERDICT[verdict]}, "${reasoning}"`);
  }
  console.log(`operator balance now ${formatEther(await pub.getBalance({ address: operator.address }))} ETH`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
