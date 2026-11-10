# Internet Court: verified on-chain facts (for the AgentScore indexer)

Checked 2026-11-09 against Base Sepolia (chain id 84532) with direct RPC calls and the Blockscout API.

## Contracts

| What | Address | Verified how |
|---|---|---|
| InternetCourtFactory (v2) | `0xd533cB0B52E85b3F506b6f0c28b8f6bc4E449Dda` | Bytecode present (17,453 bytes); source verified on Blockscout as `InternetCourtFactory` |
| Factory owner | `0xe9630ba0e3cc2d3BFC58fbE1Bbde478f06E4CE87` | Constructor args + `OwnershipTransferred` event |
| Bridge receiver (delivers GenLayer verdicts) | `0xc3e6ae892a704c875bf74df46ed873308db15d82` | Constructor args |
| MockUSDC (escrow token, public `mint`) | `0x58C27C7C1Ff5DBF480c956acf6b119508b6FBa4f` | Bytecode present |

Factory deployed at block `38576182`. Total cases as of block ~56.64M: **19** (`nextAgreementId() = 19`).

## Factory events (verified ABI, all four seen in real logs)

```solidity
event AgreementCreated(uint256 indexed id, address agreementAddress, address partyA, address partyB);
event CaseRegistered(uint256 indexed id, address indexed caseAddress);
event DisputeRequested(address indexed agreementAddress, uint256 timestamp);
event VerdictReceived(address indexed agreementAddress, uint8 verdict);
```

Every case, whatever its type, passes through the factory, so **one event stream covers all of Internet Court**. No polling of individual cases is needed to find out about new cases, disputes or verdicts.

## Useful factory views

`nextAgreementId()`, `agreements(uint256) -> address`, `agreementIds(address) -> uint256`, `deployedAgreements(address) -> bool`, `deploymentBlock()`, `bridgeReceiver()`, `owner()`.

## Two kinds of cases

1. **Standard agreements** (created via `createAgreement`, event `AgreementCreated`). 5 so far (ids 13–17).
   - Parties come straight from the event (`partyA`, `partyB`).
   - Getters confirmed by `eth_call`: `partyA()`, `partyB()`, `status()`, `verdict()`, `reasoning()`, `statement()`, `escrowAmount()`.
   - `enum Status { CREATED, ACTIVE, DISPUTED, RESOLVING, RESOLVED, CANCELLED }`
   - `enum Verdict { UNDETERMINED, TRUE_, FALSE_ }`: the verdict is about the **statement** (true or false), not directly "A wins / B wins". The Heurist copy of the skill calls these PARTY_A / PARTY_B; the verified source calls them TRUE_ / FALSE_.
   - Example with a real ruling: case 15 `0x32cb0d3E1671088CaAfE62E7cBCe1B875876A035`, status RESOLVED, verdict TRUE_, reasoning "Freelancer delivered all 47 endpoints on time. Bug reports filed after deadline."

2. **Registered external cases** (a custom contract calls `registerCase()`, event `CaseRegistered`). 14 so far (ids 0–12, 18).
   - These are app-specific contracts (e.g. `TradeFxSettlement`) with **their own ABI**. They have no `partyA()` / `verdict()` getters.
   - The `VerdictReceived` code is **app-specific** (values 1–6 seen), so its meaning differs per contract type.
   - Parties must be read per contract type. Example: `TradeFxSettlement` uses `exporter()` / `importer()` (confirmed on case 0 `0x778E…53bF`), and the ruling text is in `shipmentVerdictReason()`.
   - Case 18 (`0x1A5499…2568`) was registered today with a dispute pending; its source is unverified.

## Reading the data

- **Backfill:** Blockscout API `GET https://base-sepolia.blockscout.com/api/v2/addresses/<factory>/logs` (paginated, decoded). The whole history (50 logs) fits in one page today.
- **Live polling:** the public RPC `https://sepolia.base.org` caps `eth_getLogs` at **200 blocks per call** (confirmed). Poll the factory in ≤200-block windows, or use a provider such as Alchemy or Infura for bigger ranges.

## What this means for AgentScore

- An agent's court record = every case where its wallet is a party (from `AgreementCreated`, or from per-type adapters for registered cases) + dispute and verdict events + the case's own reasoning text.
- Who "won" needs interpreting: standard cases rule on whether a statement is true, and registered cases use custom codes. **Reading the statement and reasoning to decide what each ruling means for each party is a natural job for the GenLayer scoring contract.**
- Real data is sparse (19 cases, mostly test cases by the factory owner). The demo should create its own cases through `createAgreement` with MockUSDC.

## Still unverified

- The full verified source of `Agreement.sol` beyond `proposeOutcome` (the remaining functions were not read verbatim).
- Source and ABI for the unverified case contracts (ids 2–12, 18 apart from the `TradeFxSettlement` ones).
- Mainnet: no mainnet deployment found.
