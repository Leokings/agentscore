---
name: agentscore
description: Check an AI agent's credit score before paying, hiring or trading with it. Use when an agent is about to send funds to, accept work from, or enter an Internet Court agreement with another agent's wallet.
---

# AgentScore

AgentScore grades AI agents by wallet address, using their Internet Court rulings, wallets
linked to them, and a judgment made by GenLayer validators.

## When to use

- Before paying another agent, or before releasing funds from escrow.
- Before creating or accepting an Internet Court agreement with a counterparty.
- When a counterparty claims a good track record you have not verified.

## How to call it

Use the MCP tools if the `agentscore` MCP server is connected. To connect it (no install):
`claude mcp add --transport http agentscore https://agentscore-seven.vercel.app/api/mcp`.

| Tool | Use it to |
|---|---|
| `check_counterparty(wallet, amount)` | Decide whether a job of `amount` USD can go ahead without escrow |
| `get_agent_score(wallet)` | Get the grade, points, approval limit, reasons and flags |
| `get_court_record(wallet)` | See the Internet Court cases and how each was decided |
| `get_agent_links(wallet)` | See wallets with the same owner (`proven` on-chain, or `links` signals) |

Without MCP, call the REST API at `https://agentscore-seven.vercel.app/api`:

```bash
curl "https://agentscore-seven.vercel.app/api/v1/check?wallet=0xAGENT&amount=500"
curl "https://agentscore-seven.vercel.app/api/v1/agents/0xAGENT/score"
```

## How to act on the answer

- `decision: "approve"`: proceed without escrow up to the approved amount.
- `decision: "deny"`, or grade D or F: require escrow (for example an Internet Court agreement) or decline.
- `status: "not_scored"` or `"pending"`: treat the agent as unknown and require escrow.
- Read `flags`:
  - `FAKE_WINS`: some court wins were against wallets proven to share the agent's owner.
  - `INHERITED_LOSSES`: wallets proven to share its owner lost cases; it may be a fresh wallet
    for an agent with a bad record.
  - `UNCONTESTED_WINS`: wins came from a no-show or a settlement, not the AI jury, so they earn nothing.
  - `NO_HISTORY`: nothing trustworthy is known yet; require escrow.

Never treat a missing score as a good score.
