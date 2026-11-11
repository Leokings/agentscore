# AgentScore scoring contract: design for approval

Status: **approved 2026-11-09; v7 deployed on StudioNet 2026-11-10 at
`0xF1a3D4079b19968D31FC47326849906C9F03EB89`** (see `deployments/studionet/release-manifest.json`). Contract:
[`contracts/agent_score.py`](../contracts/agent_score.py). This follows the checkpoints in
`Genlayer/GENLAYER_PORTAL_SUBMISSION_GUIDE.md` (section 8).

Next: **v8 proposal** (safer first-funding links; same deployer, shared cash-out and closed loops
on-chain, in two tiers): [DESIGN-v8.md](DESIGN-v8.md), waiting for approval.

## Changes made during the build

These change the approved design. Sections below are kept as approved for reference.

1. **Links are a permanent registry, not a `score_agent` argument.** In the approved version, whoever
   called `score_agent` supplied the links, so an agent could score itself with an empty link list and
   hide its fake wins. Now anyone can call `prove_link(subject, other, kind, proof)`. Proven links are
   stored for good, and `get_score` is a plain view over both registries. Leaving evidence out no
   longer helps anyone, because evidence only ever accumulates.
2. **Two provable link kinds, chosen so they can't be used to smear someone.** A third kind, `paid`
   (the subject sent the other wallet funds), was removed after the first full live run: anyone can
   pay anyone, so a wallet with a bad record could pay an honest agent and pass its losses on to it.
   Payments also don't show ownership; clients routinely pay the freelancers they later sue.
   - `first_funded_by`: a native-value transfer to the wallet mined at or before that wallet's own
     nonce-0 transaction. A wallet can't send before it has gas, so this is its first funding, and dust
     sent later by a stranger can never satisfy it.
   - `shared_first_funder`: the same check for both wallets against one funder.
3. **Removed from points:** closed loops and shared cash-out wallets. The other side of either can
   create the link (for example by sending dust to the subject's cash-out wallet), so they would allow
   smearing. They stay as off-chain flags in the API.
4. **Losses follow the whole proven cluster**, not only "successor" wallets. A wallet's grade includes
   unfavorable rulings of every wallet proven linked to it (one hop), except cases the subject itself
   was in, which are already counted.
5. **Case evidence comes from one batched `eth_call`** to the public Base Sepolia RPC
   (`agreementIds`, `agreements(0)` and the case getters). Case 0 must round-trip through
   `agreements(0)`, because `agreementIds` returns 0 for unknown contracts too.
6. **Narrower judgment (after the first live run).** On StudioNet, five different models could not
   match exactly on "outcome + severity per party", so the first real case finalized as
   MAJORITY_DISAGREE and stored nothing. Now:
   - For standard agreements, the winner comes from the chain: the statement is Party A's claim,
     so TRUE means Party A prevailed and FALSE means Party B did. No model is asked.
   - Validators answer two yes/no questions about the losing side: `deception` (lied, fabricated
     or altered evidence, acted fraudulently) and `non_delivery` (did not perform its core
     obligation at all). Code derives severity: deception → SEVERE, non-delivery → MATERIAL,
     otherwise MINOR.
   - Only registered app-specific cases also ask `prevailing_role` (one of the roles, NONE or UNCLEAR).
7. **CLI-friendly calldata.** The GenLayer CLI sends `0x…` strings as `Address` values, decodes JSON
   arguments, and turns 64-hex strings into integers. The contract accepts those forms.
8. **v6: Nansen-found mainnet links, exchange/faucet guard, new scoring (2026-11-10).**
   - Link proofs carry a `network`: `base-sepolia` (default) or `base` (mainnet). Transactions and
     receipts are read in one batch from the public Base RPC nodes, not from Blockscout (Base
     mainnet's Blockscout blocks automated requests).
   - Nansen's role: its related-wallets endpoint names an agent's First Funder on Base mainnet and
     the funding transaction, and its transactions endpoint gives the agent's earliest
     transactions. `packages/prover` turns that into a proof, checks it against the RPC node with
     the contract's exact rules, and submits it. The contract re-verifies on-chain.
   - Exchange/faucet guard: a funder whose funding transaction has a nonce above 1,000 had already
     sent over 1,000 transactions, so it is infrastructure and cannot link wallets
     (`funder_is_infrastructure`). The nonce is part of the transaction itself, so every validator
     sees the same number. A real example: both sides of Internet Court case 14 were funded by a
     faucet that had sent 18,881 transactions; v5 would have accepted a link between them.
   - Scoring (chosen by the user): start 50; +8 per genuine win (up to 5); losses −8 minor,
     −20 material, −40 severe (own or inherited); −10 per fake win; A ≥ 80, B ≥ 65, C ≥ 50,
     D ≥ 30, F below. No history: shown as C with an approval limit of $0 (escrow required).
9. **v7: only jury verdicts earn points, and RPC refusals are outages (2026-11-10).**
   - Internet Court decides a case one of three ways, and the contract now records which, from the
     case's own state rather than its text: **jury** (both sides submitted evidence, the only way
     Agreement.sol sends a case to the AI jury), **default** (a dispute with evidence from at most
     one side, settled by `resolveByDefault()`), or **settlement** (no dispute; both parties agreed).
     Registered cases are always jury cases.
   - A default or a settlement costs a colluding pair nothing, so a win that way adds no points
     (`uncontested_wins`, flag `UNCONTESTED_WINS`). Losses count however the case ended: nobody
     fakes a loss. A win against a proven linked wallet is still a fake win and still costs 10.
   - Uncontested wins alone do not lift a wallet out of the no-history rule: without a jury
     ruling, a loss or a caught fake win it stays a C that needs escrow. Otherwise one free
     default win would buy a $100 limit.
   - Validators are told how the case ended ("No jury: decided by default judgment…") instead of
     always "The AI jury ruled…".
   - Why now: Internet Court's jury relay has delivered no verdict since block ~39.07M, so every
     new case is a default or a settlement; the staged cases #19 and #20 were defaults.
   - Bug fixed: the public Base RPC allows 25 requests per second and counts every call in a
     batch. v6 read a refused call as "missing", so a rate-limited `partyA` became a permanent
     `unsupported_case_type` and a rate-limited link lookup a permanent `link_tx_not_found`. Now
     only a real revert (code 3) means missing; any other per-call error is `[TRANSIENT]
     rpc_call_error`, which the keeper retries after 30 minutes.
10. **Defaults taken where you had not decided:** scoring table as in section 4 (minus the closed-loop
   penalty), target network StudioNet, Nansen-only links shown as flags without affecting points.

## 1. Mechanism in one line

**A ruling counts once per owner, not once per wallet.** The contract keeps a growing registry of
Internet Court rulings judged by validators. Wins against wallets owned by the same person never
raise a grade, and losses follow the owner to any new wallet.

```text
Internet Court case (finalized on Base Sepolia)
  -> validators classify what the ruling means for each party   (bounded semantic judgment)
  -> stored once in the registry; reused by every later score    (evolving registry)
  -> score_agent(wallet, link graph)
       -> verify link evidence against the chain                 (fail closed)
       -> discount wins against linked wallets                   (deterministic)
       -> inherit losses from linked predecessor wallets         (deterministic)
       -> grade + approval limit from a fixed table              (deterministic)
```

## 2. What GenLayer judges, and what it does not

The LLM never chooses a grade. It answers one narrow question per case and party:

> Reading this case's statement, the jury's verdict and its reasoning, was the ruling
> **FAVORABLE**, **UNFAVORABLE** or **NEUTRAL** for the party in role R? If it is not clear, answer **UNCLEAR**.
> How serious was the issue: **MINOR**, **MATERIAL** or **SEVERE**?

This needs semantic judgment because Internet Court verdicts are not "A wins / B wins":
- Standard agreements rule whether a **statement** is TRUE or FALSE. Who that favors depends on what the statement claims and which side made it.
- Registered cases (e.g. `TradeFxSettlement`) use **app-specific verdict codes** (1–6 seen on-chain) with free-text reasons.
- Severity ("late by an hour" vs "never delivered, kept the escrow") only exists in the reasoning text.

Everything else is ordinary code: link rules, counting, weights, the grade table, approval limits,
permissions and lifecycle.

## 3. Contract interface (proposed)

| Method | Who | What it does |
|---|---|---|
| `judge_cases(case_addresses: list[str])` | anyone | For up to 5 cases not yet judged: checks each case is registered in the Internet Court factory, fetches its statement, verdict and reasoning, and stores the validators' classification per party. Final once stored. |
| `score_agent(wallet: str, links_json: str)` | anyone | Validates the link payload, verifies link evidence, reads stored classifications for the wallet and its linked wallets, derives the grade, stores it. Re-scoring replaces the previous score (the last 5 are kept). |
| `get_score(wallet)` | view | Grade, approval limit, reason codes, flags, inputs hash, block/time. |
| `get_case(case_address)` | view | Stored classification for a case. |

All inputs are frozen in calldata, so anyone can trigger either method and the result does not
depend on who called it.

## 4. Deterministic scoring (v1 table, open for your edits)

From the registry, for the subject wallet:

- `wins`: FAVORABLE rulings against counterparties **not** linked to the subject
- `fake_wins`: FAVORABLE rulings against counterparties linked to the subject (`linked_counterparty`)
- `loss_weight`: UNFAVORABLE rulings, weighted MINOR 1, MATERIAL 2, SEVERE 4
- `inherited_loss_weight`: the same for wallets the subject is a `successor_of`, or strongly linked to by ownership
- `UNCLEAR` and `NEUTRAL` add nothing (fail closed: unclear evidence never helps)

```text
points = 50
       + 10 * min(wins, 4)
       - 15 * (loss_weight + inherited_loss_weight)
       - 10 * fake_wins
       - 10 if any closed_loop link
grade:  A >= 80, B >= 65, C >= 50, D >= 35, otherwise F
no ruled cases and no links: grade C, flag NO_HISTORY
approval limit without escrow: A 5,000 · B 1,000 · C 100 · D 0 · F 0 (USD)
```

## 5. Consensus rules

- One nondeterministic block per case. Leader and validators each fetch the evidence and classify
  independently. The validator requires **exact equality** of the canonical result for every party
  (outcome and severity), not just the headline.
- Output is restricted to the allowlists above. Unknown roles or labels are dropped, and missing values become UNCLEAR.
- Fetch failures, non-200 responses, empty or oversized evidence, or a case that is not registered
  in the factory raise an error, so nothing is stored (fail closed).
- Storage is copied into local variables before the nondeterministic blocks; closures never touch `self`.
- Bounds: 5 cases per call, 8 parties per case, 30 links per score, 4,000 characters of evidence per case.

## 6. Evidence sources (needs a probe before building)

| Evidence | Preferred source | Fallback |
|---|---|---|
| Case is a real Internet Court case | `eth_call` to the factory's `deployedAgreements` / `agreementIds` via public Base Sepolia RPC | Blockscout API factory logs |
| Statement, verdict, reasoning, parties | `eth_call` on the case contract | Blockscout API |
| Link evidence (first funding, transfers) | Blockscout `GET /api/v2/transactions/{hash}`: check `from`, `to`, `value` | none (unverifiable links are dropped) |

`eth_call` is a JSON-RPC **POST**. Before building, a probe contract on the target network must confirm
GenVM can POST to `https://sepolia.base.org` and get FINALIZED + SUCCESS. If it cannot, case evidence
comes from Blockscout's GET API instead.

**Link verification:** every link the score relies on must carry transaction hashes, and validators
check each one against Blockscout. A forged link (wrong sender, receiver or a made-up hash) fails the
whole `score_agent` call. Links without verifiable transactions (e.g. Nansen-only mainnet links)
are accepted only as flags and **do not change points**. This keeps the grade independent of trust
in AgentScore's own server.

## 7. Live demo plan (testnet)

1. Create real Internet Court cases on Base Sepolia through the factory with MockUSDC, using demo agent wallets:
   - a good agent with two genuine wins,
   - a farmer agent that "wins" three cases against its own sibling wallets,
   - a bad agent that loses two cases, goes quiet, then funds a fresh wallet.
2. `judge_cases` on all of them, then `score_agent` on each.
3. Expected: good agent B or better; farmer's fake wins discounted (flag `FAKE_WINS`); fresh wallet inherits the losses (flag `SUCCESSOR`).
4. Expected failures, labelled as such: a forged link transaction hash, a case address not registered with the factory, an oversized link payload.

## 8. Distinctiveness check against your previous contracts

| Contract | What it judges | Persistent state across calls | Difference from AgentScore |
|---|---|---|---|
| TrustGate | Evidence questions for one transaction → ALLOW / REVIEW / BLOCK | No (stateless proofs) | Judges one transaction at a time; AgentScore judges *finalized court rulings* once, keeps them, and propagates them across wallets |
| AgentTrials | Sealed agent answers against five checks | Per trial | Grades an answer, not a track record; no cross-wallet effects |
| PromiseBond | Whether a public promise was kept | Per bond | One promise, one verdict; no registry or link graph |
| SLA Breach Resolver | One SLA breach question | Per SLA | Single-question primitive |
| DelegationBudgetTree | Scope containment in a delegation tree | Tree of allocations | Propagates budget and revocation down a tree; AgentScore propagates court outcomes across an ownership graph |

**New invariant:** a ruling raises a grade only when the counterparty is not linked to the agent, and
a loss lowers the grade of every wallet strongly linked to the loser. It consumes another system's
finalized state (Internet Court on Base) as its main input, which none of the above do.

The closest risk is TrustGate (both answer "can I trust this agent?"). The difference is the shape:
an evolving registry plus graph propagation, against a stateless per-transaction check.

## 9. Decisions needed from you

1. **Scoring table** in section 4: accept as v1, or change weights and limits?
2. **Network:** StudioNet (faster, what your earlier projects used) or the Bradbury testnet?
3. **Link verification:** OK that Nansen-only (mainnet) links become flags without changing points?
4. **Go-ahead** to build the probe contract, then the scoring contract with direct-mode tests.
