# AgentScore v8: safer links, and three more link kinds

Status: **proposal, waiting for approval (2026-11-11)**. Builds on v7
(`0xF1a3D4079b19968D31FC47326849906C9F03EB89`, [DESIGN.md](DESIGN.md)). Follows the design
checkpoint in `Genlayer/GENLAYER_PORTAL_SUBMISSION_GUIDE.md` section 8: nothing below is built
until this is approved.

## 1. Why

A same-owner link makes a wallet inherit the other wallet's losses. So a link kind is only safe
if an **outsider cannot create it**: otherwise a bad wallet can "smear" an honest agent by linking
itself to it. v7 counts only first-funding links for that reason, and it has two problems:

1. **A gap in first funding.** v7 accepts *any* payment that arrived before the wallet's first
   transaction. If an agent publishes a new address before using it, anyone can send it dust
   first and prove "first funded by me".
2. **Three link kinds the product promised are only off-chain signals:** shared cash-out, same
   deployer or signer, and closed loops. Each of them can be created, at least partly, by the
   other side.

v8 fixes the gap and brings all three on-chain, each with the strongest check the chain allows,
and with an effect on the score that matches how sure the evidence is.

## 2. Two principles

**Evidence the agent signed is proof; evidence an outsider can buy is a signal.**

| Tier | What qualifies | Effect on the score |
|---|---|---|
| **Proven** | The evidence needs a signature from the agent's own wallet, or happened before the wallet existed for anyone else (its very first money) | As in v7: inherits the linked wallet's losses; wins against it are fake wins |
| **Signal** | An outsider could create it, but only by spending real money | Flag `POSSIBLE_SAME_OWNER`; approval limit drops to $0 (escrow) **unless the agent has at least one jury win that counts**. No points lost, no inherited losses |

So the worst a successful smear can do with a signal is make payers use escrow with an agent
that has no jury record yet, which protects them anyway, and the agent clears it with one real
jury win.

**Faking must cost money.** Every payment used as evidence must be at least a minimum amount:

| Network | Minimum | Why |
|---|---|---|
| Base mainnet | 0.001 ETH (a few dollars) | A real cost per smear, paid *to the victim* |
| Base Sepolia | 0.00001 ETH | Test ETH has no value: this only filters zero-value noise |

## 3. Link kinds in v8

All checks read the cited transactions, receipts and historical balances from the public Base
RPC nodes at pinned block numbers, so every validator sees the same answer. Checked live on
2026-11-11: both nodes return balances at blocks from 2023 and 2025.

### Proven

**A. `first_funded_by` and `shared_first_funder` (fixed).** In addition to v7's checks (funding
mined at or before the wallet's nonce-0 transaction, funder sent ≤ 1,000 transactions):
- the funding is at least the network minimum, and
- **it was the wallet's first money in:** the wallet's balance was 0 at the block before the
  funding and equal to the funding amount at the funding's block.

Dust sent first now makes *both* links fail (the owner's funding no longer starts from 0, and
the dust is below the minimum), so dust cannot create a link. What remains: an outsider who sees
an unused address *before its owner funds it* and sends at least the minimum first. That is a
race the attacker pays the victim to run, and owners normally fund a wallet the moment they
create it.

Checked against every link proven so far: all four funding transactions were the wallet's first
money in (balance 0 before) and above the minimums (0.1, 0.00003, 0.00002 and 0.0015 ETH), so no
existing link or grade changes.

**B. `deployed_by` and `shared_deployer` (new).** The agent's wallet is a contract created
directly by an ordinary wallet: a creation transaction (`to` empty) whose receipt's
`contractAddress` is the agent's wallet, signed by the deployer. Only the deployer's key can
produce that. Deployments through a factory contract (most smart accounts) do not qualify, so a
shared factory never links strangers. A deployer that had sent over 1,000 transactions is
infrastructure, as for funders. `shared_deployer`: two wallets created by the same ordinary
wallet.

**C. `operated_by` (new, built last).** An ordinary wallet sent a successful `execTransaction`
to a multisig (Safe) agent wallet: it acts for that multisig, and only its own key can send that
transaction. Being *listed* as an owner proves nothing (anyone can list anyone), so listings are
ignored. Relayer services are excluded by the same 1,000-transaction rule.

### Signals

**D. `shared_cashout` (new).** The agent and the other wallet each sent at least the minimum to
the same third wallet C, within 30 days of each other. C must not be infrastructure: the proof
cites a transaction **sent by C** after both payments with a nonce ≤ 1,000 (so C had sent at most
1,000 transactions by then). Smearing needs the attacker to pay at least the minimum into the
victim's own savings wallet.

**E. `closed_loop` (new).** The agent sent at least the minimum to X, and X sent at least 80% of
it back within about a day (43,200 blocks). X had sent ≤ 1,000 transactions (read from its
return transaction's nonce). The first leg needs the agent's own signature, so an outsider cannot
start one. A refund after a real job looks the same, which is why this stays a signal.

## 4. Contract changes

- `prove_link(subject, other, kind, proof)` accepts the new kinds. Proofs carry transaction
  hashes as today; the contract adds historical `eth_getBalance` reads for kind A and receipt
  `contractAddress` / creation checks for kind B.
- New storage `wallet_signals` beside `wallet_links`, so signals never feed inheritance or fake
  wins.
- `get_score`: adds flag `POSSIBLE_SAME_OWNER`, count `signal_links`, and the escrow rule from
  section 2. Points are computed exactly as in v7.
- `get_links` returns proven links; new view `get_signals` returns signal links.
- Unchanged: case judging, jury/default/settlement handling, the scoring table, error codes.
- New `[EXPECTED]` errors: `funding_below_minimum`, `not_first_money_in`, `not_a_direct_deployment`,
  `cashout_wallet_is_infrastructure`, `loop_too_small_or_slow`.

## 5. Consensus

Every check is a deterministic RPC read at a pinned block, compared with exact equality, as in
v6/v7: no LLM is involved in links. Each proof needs at most about 10 calls in one batch, within
the public node's 25 requests per second. Rate-limited calls are already treated as `[TRANSIENT]`
(v7). Historical-balance reads are the one new dependency; if a node stops serving old state, a
proof fails closed with `[EXTERNAL]` and nothing is stored.

## 6. What v8 deliberately does not do

- **Fade old signals.** A view has no trustworthy clock, so "older than 180 days" cannot be
  computed deterministically. Signals stay until the agent earns a jury win.
- **"Most of its money went to C" rules.** Validators can only check the transactions a proof
  cites, not scan a wallet's whole history.
- **Nansen labels inside the contract.** An API key cannot live in a public contract. Nansen
  stays the discovery layer; the contract re-checks everything on-chain.

## 7. Off-chain changes

- Prover: turns the link builder's existing cash-out, loop and deployer findings into proofs and
  pre-checks them with the contract's rules; the keeper submits them.
- API, MCP report and website: show signal links with what they do ("escrow until a jury win"),
  separately from proven links.

## 8. Tests and live demo

Direct-mode tests for every new rule, including: dust before funding (both links fail), a funding
that was not the first money in, below-minimum amounts on each network, a factory deployment, a
listed-but-never-executing signer, a cash-out wallet with over 1,000 transactions, a slow or small
loop, replays, a forged leader result for each new kind, and RPC failures (non-200, rate limit,
missing historical state).

Live demo on a fresh v8 deployment: the 18 v7 steps again, plus staged on Base Sepolia (about
0.0002 test ETH of the 0.00066 left): a shared cash-out signal, a closed-loop signal, a direct
deployment link, and expected failures for dust-before-funding, a below-minimum payment and an
infrastructure cash-out wallet. The `operated_by` demo (deploying a Safe) is last and optional.

## 9. Distinctiveness

Same contract, a deeper version of its own mechanism. Close matches remain different: Sybil
scorers (e.g. Gitcoin Passport) score humans from stamps, and on-chain credit scores (e.g. Cred
Protocol, Spectral) score lending history. AgentScore's core stays the same: court rulings
interpreted by GenLayer validators, plus ownership links anyone can prove but nobody can cheaply
fake.

## 10. Effort and order

About one to two days: (1) the first-funding fix and the two tiers, (2) shared deployer, cash-out
and loops, (3) `operated_by` if time allows. Then redeploy, re-judge all cases with the keeper,
re-run the live demo, update the manifest, API and website.

## Decisions needed

1. Approve the two tiers and their effects (section 2).
2. Approve the minimums: 0.001 ETH on Base mainnet, 0.00001 ETH on Base Sepolia.
3. Include `operated_by` (multisig) now, or leave it for later.
