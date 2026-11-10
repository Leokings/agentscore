import { Store } from "../store.js";
import { syncInternetCourt } from "../sync.js";

const store = await Store.open();
try {
  const result = await syncInternetCourt(store, { log: (m) => console.log(m) });
  const cases = await store.allCases();
  console.log(
    `\nDone (${result.mode}). ${cases.length} cases indexed, ${cases.filter((c) => c.verdictCode !== undefined).length} with a verdict, up to block ${result.toBlock}.`,
  );
} finally {
  store.close();
}
