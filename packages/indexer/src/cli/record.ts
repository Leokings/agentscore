import { isAddress, normalizeAddress } from "@agentscore/shared";
import { Store } from "../store.js";
import { courtRecord } from "../sync.js";

const wallet = process.argv[2];
if (!wallet || !isAddress(wallet)) {
  console.error("Usage: npm run record -- <wallet address>");
  process.exit(1);
}

const store = await Store.open();
try {
  const record = await courtRecord(store, normalizeAddress(wallet));
  console.log(JSON.stringify(record, null, 2));
} finally {
  store.close();
}
