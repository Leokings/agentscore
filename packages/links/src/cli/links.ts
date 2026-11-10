import { Store } from "@agentscore/indexer";
import { isAddress, normalizeAddress } from "@agentscore/shared";
import { gatherGraph } from "../gather.js";
import { NansenClient } from "../nansen.js";
import { buildLinks } from "../rules.js";

const wallet = process.argv[2];
if (!wallet || !isAddress(wallet)) {
  console.error("Usage: npm run links --workspace @agentscore/links -- <wallet address>");
  process.exit(1);
}

const store = await Store.open();
try {
  const nansen = new NansenClient(store);
  const graph = await gatherGraph(store, normalizeAddress(wallet), { nansen, log: (m) => console.error(m) });
  const links = buildLinks(graph);
  console.log(JSON.stringify({ wallet: graph.subject, nodes: Object.keys(graph.nodes).length, links, nansenCredits: nansen.creditsSpent }, null, 2));
} finally {
  store.close();
}
