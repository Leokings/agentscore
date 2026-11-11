#!/usr/bin/env tsx
/**
 * Stages the v8 link kinds on Base Sepolia with wallets one operator controls, and writes the
 * proofs the live demo submits (deployments/base-sepolia/staged-v8-links.json):
 *
 *   signals    shared_cashout (P and Q both pay C, then C transacts), closed_loop (Q -> C -> Q)
 *   proven     deployed_by (P deploys contract K), operated_by (P runs a transaction on its Safe)
 *   rejected   dust sent before a wallet's real funding (not_first_money_in, funding_below_minimum),
 *              a contract call cited as a deployment (not_a_direct_deployment), a below-minimum
 *              loop (payment_below_minimum), and a cash-out wallet with >1,000 transactions
 *              (cashout_wallet_is_infrastructure: a busy Base Sepolia bot, found live)
 *
 * Resumable like scripts/stage-abuses.ts: finished steps are recorded and never resent.
 *   npx tsx --env-file-if-exists=.env scripts/stage-v8-links.ts
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  concat,
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  encodeFunctionData,
  formatEther,
  http,
  pad,
  parseAbi,
  parseEther,
  zeroAddress,
  type Address,
  type Hash,
  type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

const RPC = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
const STATE_FILE = "deployments/base-sepolia/staged-v8-links.json";
const KEYS_FILE = "data/demo-wallets.json";
// Safe 1.4.1, deployed at the same addresses on every supported chain (checked on Base Sepolia).
const SAFE_FACTORY = "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67" as const;
const SAFE_L2_SINGLETON = "0x29fcB43b46531BcA003ddC8FCB67FFE91900C762" as const;
// Init code for a tiny contract whose runtime returns 42: enough to be "a contract P deployed".
const TINY_CONTRACT = "0x600a600c600039600a6000f3602a60005260206000f3" as const;

const safeAbi = parseAbi([
  "function setup(address[] _owners, uint256 _threshold, address to, bytes data, address fallbackHandler, address paymentToken, uint256 payment, address paymentReceiver)",
  "function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures) returns (bool)",
  "function createProxyWithNonce(address _singleton, bytes initializer, uint256 saltNonce) returns (address proxy)",
  "event ProxyCreation(address indexed proxy, address singleton)",
]);

type Role = "v8P" | "v8Q" | "v8C" | "v8D";
const ROLES: Role[] = ["v8P", "v8Q", "v8C", "v8D"];

interface State {
  network: "base-sepolia";
  operator: Address;
  wallets: Partial<Record<Role | "contractK" | "safe" | "busyWallet", Address>>;
  steps: Record<string, { tx: Hash; block: number }>;
  pending: Record<string, Hash>;
  proofs: Record<string, { subject: Address; other: Address; kind: string; proof: Record<string, string>; expect: string }>;
}

const load = <T>(file: string, fallback: T): T => (existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as T) : fallback);
function save(file: string, data: unknown) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

const operatorKey = process.env.AGENTSCORE_SIGNER_KEY as Hex | undefined;
if (!operatorKey) throw new Error("AGENTSCORE_SIGNER_KEY missing from .env");
const operator = privateKeyToAccount(operatorKey);

const keys = load<Record<string, Hex>>(KEYS_FILE, {});
for (const r of ROLES) keys[r] ??= generatePrivateKey();
save(KEYS_FILE, keys);
const acct = Object.fromEntries(ROLES.map((r) => [r, privateKeyToAccount(keys[r]!)])) as Record<Role, ReturnType<typeof privateKeyToAccount>>;

const state = load<State>(STATE_FILE, { network: "base-sepolia", operator: operator.address, wallets: {}, steps: {}, pending: {}, proofs: {} });
for (const r of ROLES) state.wallets[r] = acct[r].address;
save(STATE_FILE, state);

const transport = http(RPC, { retryCount: 6, retryDelay: 1500 });
const pub = createPublicClient({ chain: baseSepolia, transport });
const wallet = (a: ReturnType<typeof privateKeyToAccount>) => createWalletClient({ account: a, chain: baseSepolia, transport });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function step(name: string, send: () => Promise<Hash>, after?: (r: Awaited<ReturnType<typeof pub.waitForTransactionReceipt>>) => void) {
  if (state.steps[name]) return console.log(`✓ ${name} (done earlier, tx ${state.steps[name].tx})`);
  let hash = state.pending[name];
  if (!hash) {
    hash = await send();
    state.pending[name] = hash;
    save(STATE_FILE, state);
  }
  const r = await pub.waitForTransactionReceipt({ hash, timeout: 180_000 });
  if (r.status !== "success") throw new Error(`${name}: ${hash} reverted`);
  after?.(r);
  state.steps[name] = { tx: hash, block: Number(r.blockNumber) };
  delete state.pending[name];
  save(STATE_FILE, state);
  console.log(`✓ ${name}  tx ${hash}  block ${r.blockNumber}`);
}

const pay = (from: ReturnType<typeof privateKeyToAccount>, to: Address, wei: bigint) => () => wallet(from).sendTransaction({ to, value: wei });
const t = (name: string) => state.steps[name]!.tx;
const ETH = (s: string) => parseEther(s);

/** A Base Sepolia wallet that has sent over 1,000 transactions and is still active (a bot). */
async function findBusyWallet(): Promise<Address> {
  for (let back = 0; back < 30; back++) {
    const block = await pub.getBlock({ blockTag: "latest", includeTransactions: true });
    for (const tx of block.transactions) {
      if (typeof tx === "string" || tx.type === "deposit" || !tx.to) continue;
      if (tx.nonce > 5000) return tx.from;
    }
    await sleep(2000);
  }
  throw new Error("no busy wallet found in recent blocks");
}

/** The busy wallet's first transaction sent after `afterBlock` (it is a bot, so this comes soon). */
async function nextTxFrom(from: Address, afterBlock: number): Promise<Hash> {
  for (let i = 0; i < 90; i++) {
    const head = Number(await pub.getBlockNumber());
    for (let b = Math.max(afterBlock + 1, head - 5); b <= head; b++) {
      const block = await pub.getBlock({ blockNumber: BigInt(b), includeTransactions: true });
      const hit = block.transactions.find((tx) => typeof tx !== "string" && tx.from.toLowerCase() === from.toLowerCase());
      if (hit && typeof hit !== "string") return hit.hash;
    }
    await sleep(4000);
  }
  throw new Error(`no transaction from ${from} after block ${afterBlock}`);
}

async function main() {
  console.log(`operator ${operator.address}: ${formatEther(await pub.getBalance({ address: operator.address }))} ETH`);
  const { v8P: P, v8Q: Q, v8C: C, v8D: D } = acct;

  // 1. Funding (the operator gives each wallet its first money).
  await step("fund:P", pay(operator, P.address, ETH("0.0001")));
  await step("fund:Q", pay(operator, Q.address, ETH("0.00005")));
  await step("fund:C", pay(operator, C.address, ETH("0.000005")));

  // 2. Shared cash-out (signal): P and Q both pay C, then C sends a transaction of its own.
  await step("cashout:P->C", pay(P, C.address, ETH("0.00001")));
  await step("cashout:Q->C", pay(Q, C.address, ETH("0.00001")));
  await step("cashout:C-tx", pay(C, operator.address, 0n));

  // 3. Closed loop (signal): Q pays C, C sends 90% back. (Each demo case uses its own pair of
  // wallets: once two wallets share a link, a second proof for them stops at link_already_proven.)
  await step("loop:Q->C", pay(Q, C.address, ETH("0.00002")));
  await step("loop:C->Q", pay(C, Q.address, ETH("0.000018")));

  // 4. Direct deployment (proven): P deploys a contract K. Then P calls K: a call is not a deployment.
  await step("deploy:K", () => wallet(P).sendTransaction({ data: TINY_CONTRACT }), (r) => (state.wallets.contractK = r.contractAddress!));
  await step("call:K", () => wallet(P).sendTransaction({ to: state.wallets.contractK!, data: "0x" }));

  // 5. Multisig (proven): P creates a 1-of-1 Safe and runs a transaction on it as its owner.
  const initializer = encodeFunctionData({ abi: safeAbi, functionName: "setup", args: [[P.address], 1n, zeroAddress, "0x", zeroAddress, zeroAddress, 0n, zeroAddress] });
  await step(
    "safe:create",
    () => wallet(P).writeContract({ address: SAFE_FACTORY, abi: safeAbi, functionName: "createProxyWithNonce", args: [SAFE_L2_SINGLETON, initializer, BigInt(Date.now())] }),
    (r) => {
      for (const log of r.logs) {
        try {
          const ev = decodeEventLog({ abi: safeAbi, data: log.data, topics: log.topics });
          if (ev.eventName === "ProxyCreation") state.wallets.safe = ev.args.proxy;
        } catch {}
      }
      if (!state.wallets.safe) throw new Error("no ProxyCreation event");
    },
  );
  // Signature type v=1: "approved by the address in r", accepted because the owner sends it.
  const ownerApproval = concat([pad(P.address, { size: 32 }), pad("0x00", { size: 32 }), "0x01"]);
  await step("safe:exec", () =>
    wallet(P).writeContract({
      address: state.wallets.safe!,
      abi: safeAbi,
      functionName: "execTransaction",
      args: [P.address, 0n, "0x", 0, 0n, 0n, 0n, zeroAddress, zeroAddress, ownerApproval],
    }),
  );

  // 6. Dust before funding (rejected): the operator sends D dust first, then P funds D, then D starts.
  await step("dust:operator->D", pay(operator, D.address, 10n ** 9n));
  await step("fund:P->D", pay(P, D.address, ETH("0.00002")));
  await step("D:first-tx", pay(D, P.address, 0n));

  // 7. A loop below the minimum (rejected): D pays P dust, P returns it.
  await step("smallloop:D->P", pay(D, P.address, 10n ** 12n));
  await step("smallloop:P->D", pay(P, D.address, 10n ** 12n));

  // 8. Cash-out to infrastructure (rejected): P and D both pay a busy bot wallet, which then transacts.
  state.wallets.busyWallet ??= await findBusyWallet();
  save(STATE_FILE, state);
  await step("infra:P->bot", pay(P, state.wallets.busyWallet, ETH("0.00001")));
  await step("infra:D->bot", pay(D, state.wallets.busyWallet, ETH("0.00001")));
  if (!state.steps["infra:bot-tx"]) {
    const hash = await nextTxFrom(state.wallets.busyWallet, state.steps["infra:D->bot"]!.block);
    const r = await pub.getTransactionReceipt({ hash });
    state.steps["infra:bot-tx"] = { tx: hash, block: Number(r.blockNumber) };
    save(STATE_FILE, state);
    console.log(`✓ infra:bot-tx  tx ${hash} (sent by the bot itself)`);
  }

  // Proofs for the live demo.
  const w = state.wallets as Record<string, Address>;
  state.proofs = {
    "shared-cashout-signal": { subject: w.v8P!, other: w.v8Q!, kind: "shared_cashout", proof: { subject_tx: t("cashout:P->C"), other_tx: t("cashout:Q->C"), cashout_tx: t("cashout:C-tx") }, expect: "stored as a signal" },
    "closed-loop-signal": { subject: w.v8Q!, other: w.v8C!, kind: "closed_loop", proof: { out_tx: t("loop:Q->C"), back_tx: t("loop:C->Q") }, expect: "stored as a signal" },
    "deployed-by": { subject: w.contractK!, other: w.v8P!, kind: "deployed_by", proof: { creation_tx: t("deploy:K") }, expect: "stored as proven" },
    "operated-by": { subject: w.safe!, other: w.v8P!, kind: "operated_by", proof: { exec_tx: t("safe:exec") }, expect: "stored as proven" },
    "EXPECTED-dust-breaks-owner-link": { subject: w.v8D!, other: w.v8P!, kind: "first_funded_by", proof: { funding_tx: t("fund:P->D"), subject_first_tx: t("D:first-tx") }, expect: "not_first_money_in" },
    "EXPECTED-dust-is-below-minimum": { subject: w.v8D!, other: operator.address, kind: "first_funded_by", proof: { funding_tx: t("dust:operator->D"), subject_first_tx: t("D:first-tx") }, expect: "funding_below_minimum" },
    "EXPECTED-call-is-not-a-deployment": { subject: w.contractK!, other: w.v8Q!, kind: "deployed_by", proof: { creation_tx: t("call:K") }, expect: "not_a_direct_deployment" },
    "EXPECTED-loop-below-minimum": { subject: w.v8D!, other: w.v8P!, kind: "closed_loop", proof: { out_tx: t("smallloop:D->P"), back_tx: t("smallloop:P->D") }, expect: "payment_below_minimum" },
    "EXPECTED-cashout-to-infrastructure": { subject: w.v8P!, other: w.v8D!, kind: "shared_cashout", proof: { subject_tx: t("infra:P->bot"), other_tx: t("infra:D->bot"), cashout_tx: t("infra:bot-tx") }, expect: "cashout_wallet_is_infrastructure" },
  };
  save(STATE_FILE, state);
  console.log(`proofs written to ${STATE_FILE}`);
  console.log(`operator balance now ${formatEther(await pub.getBalance({ address: operator.address }))} ETH`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
