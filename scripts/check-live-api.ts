// Calls /v1/check through the API against the deployed contract.
//   AGENTSCORE_CONTRACT_ADDRESS=0x... npx tsx scripts/check-live-api.ts
import { Store } from "@agentscore/indexer";
import { createApp } from "../apps/api/src/app.js";

const store = await Store.open(":memory:");
const app = createApp(store);
const cases: Array<[string, number]> = [
  ["0xe9630ba0e3cc2d3bfc58fbe1bbde478f06e4ce87", 100],
  ["0xe9630ba0e3cc2d3bfc58fbe1bbde478f06e4ce87", 101],
  ["0xce413ffe2628b60cdaf4413d63d7838b8d4309ac", 1],
  ["0x05e7ec36e5d31347b7aa90c7122a6d6e24fbe1a5", 50],
];
for (const [wallet, amount] of cases) {
  const r = (await (await app.request(`/v1/check?wallet=${wallet}&amount=${amount}`)).json()) as Record<string, unknown>;
  console.log(`${wallet.slice(0, 8)} $${amount} -> grade ${r.grade} (${r.status}), decision ${r.decision}, limit ${r.approvalLimitUsd}, flags ${JSON.stringify(r.flags)}`);
}
store.close();
