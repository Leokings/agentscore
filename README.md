# AgentScore

Credit scores for AI agents. AgentScore reads an agent's **Internet Court** rulings, finds wallets
that probably belong to the same owner (using **Nansen** and on-chain history), and has
**GenLayer** validators judge what each ruling means, so a score can't be reset with a new
wallet or inflated with fake wins.

**Live:** [agentscore-seven.vercel.app](https://agentscore-seven.vercel.app) (website) ·
[`/api/v1`](https://agentscore-seven.vercel.app/api/v1/health) (REST API) ·
[`/api/mcp`](#mcp-server) (MCP) · [source](https://github.com/Leokings/agentscore)

> Status: in development for the Internet Court Builders Working Group mission (Nov 9–23, 2026).
> The indexer, link builder, REST API, MCP server, skill, website and the GenLayer contract
> ([contracts/agent_score.py](contracts/agent_score.py), design in [docs/DESIGN.md](docs/DESIGN.md))
> work. The contract (v7) is live on **GenLayer StudioNet** at
> `0xF1a3D4079b19968D31FC47326849906C9F03EB89`, where it has judged every ruled Internet Court
> case on Base Sepolia. Every transaction is recorded in
> [deployments/studionet/release-manifest.json](deployments/studionet/release-manifest.json).

## Live on StudioNet

| Step | Result |
|---|---|
| Judge real cases 15 and 16 (standard agreements) and trade cases 0 and 1 (registered) | FINALIZED, leader SUCCESS, validators agree |
| Prove a real first-funding link (`0xba44…` funded `0x278d…`, the two sides of case 13) | FINALIZED, leader SUCCESS |
| Replay a judged case | rejected: `case_already_judged` |
| Judge a contract that is not an Internet Court case | rejected: `case_not_registered` |
| Judge a case with no ruling yet | rejected: `case_not_ruled` |
| Forge a funding link by citing a transaction that went the other way | rejected: `link_not_proven` |
| Replay a proven link from the other side | rejected: `link_already_proven` |
| Claim ownership from a plain payment | rejected: `unknown_link_kind` |
| Record a real faucet (18,881 txs sent) as a wallet's owner | rejected: `funder_is_infrastructure` |
| Judge staged cases 19 and 20 (default judgments) and prove their two links | FINALIZED, leader SUCCESS; both recorded as `resolution: default` |
| Prove a **Base mainnet** link found by **Nansen** (`0xf171…` first funded `0xb5fe…`, party B of case 17) | FINALIZED, leader SUCCESS: validators verified it against `mainnet.base.org` |

Reproduce with `scripts/live-demo.sh` (deploys a fresh contract) or `scripts/live-demo.sh <address>`.

### The two abuses, staged on-chain

`scripts/stage-abuses.ts` creates two real Internet Court cases on Base Sepolia (#19 and #20) with
wallets one operator controls. Internet Court's jury relay was not delivering verdicts, so both
were decided through the Agreement contract's default-judgment path. The contract judged both
cases and proved the links between the wallets:

| Wallet | What happened | AgentScore |
|---|---|---|
| Agent X | Won case #19 against S, a wallet X itself first funded | Win counted as fake (`FAKE_WINS`): D (40) |
| Agent Y | Lost case #20 to client Z; validators found non-delivery | Material loss: D (30) |
| New wallet N | First funded by agent Y right after that loss | Inherits Y's loss (`INHERITED_LOSSES`): D (30), not a clean C |
| Client Z | Won case #20, but only because Y never answered | Uncontested win (`UNCONTESTED_WINS`): no points, still needs escrow (C, $0) |

### Only a jury verdict earns points

An Internet Court case ends one of three ways, and the contract reads which from the case's own
state: **jury** (both sides submitted evidence, the only way a case reaches the AI jury),
**default** (one side never answered) or **settlement** (the parties agreed). A default or a
settlement costs a colluding pair nothing, so a win that way earns no points and does not lift a
wallet out of the no-history escrow rule. Losses count however the case ended: nobody fakes a loss.

Every transaction and score is in the release manifest under `staged_abuses`.

## The GenLayer contract

| Method | Who | What it does |
|---|---|---|
| `judge_cases([case, …])` | anyone | Reads up to 5 finalized Internet Court cases from Base Sepolia and has validators classify what each ruling means for each party. Final once stored. |
| `prove_link(subject, other, kind, proof)` | anyone | Stores chain-verified proof that two wallets share an owner (`first_funded_by`, `shared_first_funder`: funding mined before the wallet's own nonce-0 transaction, so strangers can't create it). Works on Base mainnet or Base Sepolia, read from the public Base RPC nodes. Funders that had sent over 1,000 transactions (exchanges, faucets) are rejected. Permanent. |

### Keeping scores current

`apps/keeper` runs the whole loop on a timer. Each pass it syncs Internet Court, judges every
newly ruled case the contract hasn't judged, then discovers and submits new same-owner links among
the case parties (Nansen on Base mainnet, Blockscout on Base Sepolia). Something counts as stored
only when a read-back from the contract confirms it. Outages are retried after 30 minutes,
validator disagreements after 6 hours, and permanent contract errors (such as an unsupported case
type or a faucet funder) are never resent.

```bash
npm run once  --workspace @agentscore/keeper -- --dry-run   # show what it would send
npm run once  --workspace @agentscore/keeper               # one pass
npm run start --workspace @agentscore/keeper               # every KEEPER_INTERVAL_MIN minutes
```

### Where Nansen fits

Nansen finds the links; GenLayer proves them. `packages/prover` asks Nansen's related-wallets
endpoint for an agent's **First Funder on Base mainnet** (with the funding transaction) and its
transactions endpoint for the agent's earliest transactions, checks the pair against the Base RPC
node with the contract's own rules, and submits `prove_link`. Nansen's labels also drop exchange
funders before anything is sent.

Credits: a wallet's first funder and earliest transactions never change, so those answers are
cached for good and each wallet costs about 2 credits once. Every process sharing the database
(hourly keeper runs, API instances) also shares one daily budget (`NANSEN_DAILY_CREDITS`,
default 8), which fits the free plan's daily top-up to 10 credits.

```bash
npm run prove --workspace @agentscore/prover -- --court            # dry run over every Internet Court party
npm run prove --workspace @agentscore/prover -- 0xWALLET --submit  # submit provable links
```
| `get_score(wallet)` | view | Deterministic grade, approval limit, flags and counts from both registries. No LLM. |

Validators answer only narrow yes/no questions about each ruling and must agree exactly. Who
prevailed and how the case ended (AI jury, default judgment or settlement) come from the chain.
Ordinary code then derives the grade: only jury wins earn points, wins against proven same-owner
wallets cost points, and losses count from the wallet and every wallet proven linked to it.

```bash
pip install genlayer-test genvm-linter
genvm-lint check contracts/agent_score.py
pytest tests/direct -m "not live"   # 76 direct-mode tests
pytest tests/direct -m live          # decodes real Internet Court cases from Base Sepolia
```

## What's in the repo

| Path | What it is |
|---|---|
| `packages/shared` | Shared types and constants (verified Internet Court addresses) |
| `packages/indexer` | Internet Court indexer: backfills the factory's events from Blockscout, then polls Base Sepolia |
| `packages/links` | Wallet history (Blockscout + Nansen) and the deterministic link rules |
| `packages/prover` | Finds provable same-owner links (Nansen on Base mainnet, Blockscout on Base Sepolia), pre-checks them and submits `prove_link` |
| `apps/keeper` | Service that keeps the contract current: judges new rulings, submits new links |
| `apps/api` | REST API (Hono) |
| `apps/mcp` | MCP server exposing the API as tools |
| `apps/web` | Website (Next.js): score, court record, link graph |
| `skills/agentscore` | Agent skill telling agents when and how to check a counterparty |
| `docs/` | On-chain notes about Internet Court, and the contract design |

## Quick start

Requires Node 20+.

```bash
npm install
cp .env.example .env        # add NANSEN_API_KEY for mainnet links (optional)
npm run index               # index every Internet Court case into data/agentscore.db
npm run record -- 0xce413FFE2628b60cdaF4413d63d7838B8d4309AC
npm run web                 # website + API at http://localhost:3000 (API under /api/v1)
npm run api                 # standalone API at http://localhost:8787 (same routes under /v1)
```

## REST API

Base URL: `https://agentscore-seven.vercel.app/api` (or `http://localhost:3000/api` locally). The
website and the API are one Next.js app on Vercel, backed by a Turso (libSQL) database, so the
local and hosted versions run the same code.

| Endpoint | Returns |
|---|---|
| `GET /v1/agents/:wallet/score` | Grade, reasons, flags, court totals, link counts |
| `GET /v1/check?wallet=0x…&amount=500` | Whether a job of that size can go ahead without escrow |
| `GET /v1/agents/:wallet/court-record` | Every Internet Court case the wallet is a party to |
| `GET /v1/agents/:wallet/links` | Linked wallets with type, strength, direction and evidence |
| `GET /v1/cases` | All indexed Internet Court cases |

## MCP server

Hosted, nothing to install (Streamable HTTP):

```bash
claude mcp add --transport http agentscore https://agentscore-seven.vercel.app/api/mcp
```

Any other MCP client: add `https://agentscore-seven.vercel.app/api/mcp` as an HTTP server. Or run it
locally over stdio (defaults to the hosted API; set `AGENTSCORE_API_URL` to use another):

```json
{
  "mcpServers": {
    "agentscore": { "command": "npx", "args": ["tsx", "apps/mcp/src/server.ts"] }
  }
}
```

Tools: `get_agent_score`, `check_counterparty`, `get_court_record`, `get_agent_links`. Check an
endpoint the way a client would with `npx tsx scripts/check-mcp.ts [url]`.

## Link types

| Type | Meaning |
|---|---|
| `funded_by` / `funded` | One wallet sent the other its first funds |
| `shared_funder` | The same wallet first funded both (strong if within 24 hours) |
| `shared_cashout` | Both send funds to the same private wallet |
| `same_deployer` / `same_signer` | Same deployer or controlling signer |
| `linked_counterparty` | A court counterparty is linked to the agent: a possible fake win |
| `closed_loop` | Funds go around a short circle back to the agent |
| `successor_of` | The agent appeared as a linked wallet with ruled cases went quiet |

Exchanges, bridges, faucets and protocols are filtered out by label and by transaction volume, so
two agents that used the same faucet are not linked.

## Tests

```bash
npm test          # link rules (unit) + API (live Base Sepolia, needs network)
npm run typecheck
```

## License

MIT
