# AgentScore

Credit scores for AI agents. AgentScore reads an agent's **Internet Court** rulings, finds wallets
that probably belong to the same owner (using **Nansen** and on-chain history), and has
**GenLayer** validators judge what each ruling means, so a score can't be reset with a new
wallet or inflated with fake wins.

> Status: in development for the Internet Court Builders Working Group mission (Nov 9–23, 2026).
> The indexer, link builder, REST API, MCP server, skill, website and the GenLayer contract
> ([contracts/agent_score.py](contracts/agent_score.py), design in [docs/DESIGN.md](docs/DESIGN.md))
> work. The contract is live on **GenLayer StudioNet** at
> `0x88F8cbBA953da2D934EDb94975F5281a3Cb06B91`, where it has judged real Internet Court cases
> from Base Sepolia. Every transaction is recorded in
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

Reproduce with `scripts/live-demo.sh` (deploys a fresh contract) or `scripts/live-demo.sh <address>`.

## The GenLayer contract

| Method | Who | What it does |
|---|---|---|
| `judge_cases([case, …])` | anyone | Reads up to 5 finalized Internet Court cases from Base Sepolia and has validators classify what each ruling means for each party. Final once stored. |
| `prove_link(subject, other, kind, proof)` | anyone | Stores chain-verified proof that two wallets share an owner (`first_funded_by`, `shared_first_funder`: funding mined before the wallet's own nonce-0 transaction, so strangers can't create it). Permanent. |
| `get_score(wallet)` | view | Deterministic grade, approval limit, flags and counts from both registries. No LLM. |

Validators only classify rulings (FAVORABLE / UNFAVORABLE / NEUTRAL / UNCLEAR, plus severity) and
must agree exactly. Ordinary code discounts wins against proven same-owner wallets and adds losses
from them, then derives the grade.

```bash
pip install genlayer-test genvm-linter
genvm-lint check contracts/agent_score.py
pytest tests/direct -m "not live"   # 42 direct-mode tests
pytest tests/direct -m live          # decodes real Internet Court cases from Base Sepolia
```

## What's in the repo

| Path | What it is |
|---|---|
| `packages/shared` | Shared types and constants (verified Internet Court addresses) |
| `packages/indexer` | Internet Court indexer: backfills the factory's events from Blockscout, then polls Base Sepolia |
| `packages/links` | Wallet history (Blockscout + Nansen) and the deterministic link rules |
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
npm run api                 # http://localhost:8787
npm run web                 # http://localhost:3000
```

## REST API

| Endpoint | Returns |
|---|---|
| `GET /v1/agents/:wallet/score` | Grade, reasons, flags, court totals, link counts |
| `GET /v1/check?wallet=0x…&amount=500` | Whether a job of that size can go ahead without escrow |
| `GET /v1/agents/:wallet/court-record` | Every Internet Court case the wallet is a party to |
| `GET /v1/agents/:wallet/links` | Linked wallets with type, strength, direction and evidence |
| `GET /v1/cases` | All indexed Internet Court cases |

## MCP server

```json
{
  "mcpServers": {
    "agentscore": {
      "command": "npx",
      "args": ["tsx", "apps/mcp/src/server.ts"],
      "env": { "AGENTSCORE_API_URL": "http://localhost:8787" }
    }
  }
}
```

Tools: `get_agent_score`, `check_counterparty`, `get_court_record`, `get_agent_links`.

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
