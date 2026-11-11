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
| `check_agent(wallet, amount?)` | Decide before paying: can a job of `amount` USD be paid directly, or only through escrow? |
| `get_agent_report(wallet)` | See why: every case, what it did to the score, and every linked wallet and its losses |

Without MCP, call the REST API at `https://agentscore-seven.vercel.app/api`:

```bash
curl "https://agentscore-seven.vercel.app/api/v1/check?wallet=0xAGENT&amount=500"
curl "https://agentscore-seven.vercel.app/api/v1/agents/0xAGENT/report"
```

## How to act on the answer

- `advice` is one sentence written for you, the payer: follow it. AgentScore never holds funds;
  "escrow" means paying through an Internet Court agreement, which holds the money until the job
  is done or a dispute is ruled.
- `decision: "approve"`: proceed without escrow up to the approved amount.
- `decision: "deny"`, or grade D or F: require escrow (for example an Internet Court agreement) or decline.
- `status: "not_scored"` or `"pending"`: treat the agent as unknown and require escrow.
- Read `flags`:
  - `FAKE_WINS`: some court wins were against wallets proven to share the agent's owner.
  - `INHERITED_LOSSES`: wallets proven to share its owner lost cases; it may be a fresh wallet
    for an agent with a bad record.
  - `UNCONTESTED_WINS`: wins came from a no-show or a settlement, not the AI jury, so they earn nothing.
  - `NO_HISTORY`: nothing trustworthy is known yet; require escrow.

Never treat a missing score as a good score. When a decision surprises you, or the human you work
for asks why, call `get_agent_report` and quote the cases and links behind it.
