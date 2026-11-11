#!/usr/bin/env bash
# Live demo of the AgentScore contract on the GenLayer network selected in the CLI (StudioNet).
# Uses only real Internet Court cases already finalized on Base Sepolia.
#   scripts/live-demo.sh            # deploy a fresh contract, then run every step
#   scripts/live-demo.sh <address>  # run the steps against an existing deployment
set -uo pipefail
cd "$(dirname "$0")/.."
export OUT_DIR="deployments/studionet/receipts"
mkdir -p "$OUT_DIR"
tx() { scripts/gl-tx.sh "$@"; }
read_view() { genlayer call "$C" "$@" 2>/dev/null | sed -n '/^{/,/^}/p;/^\[/,/^\]/p'; }

if [ "$#" -ge 1 ]; then
  C="$1"
else
  genlayer deploy --contract contracts/agent_score.py >"$OUT_DIR/00-deploy.txt" 2>&1
  DEPLOY_TX=$(grep -A1 "Deployment Transaction Hash" "$OUT_DIR/00-deploy.txt" | grep -oE "0x[0-9a-f]{64}")
  C=$(grep -oE "'Contract Address': '0x[0-9A-Fa-f]{40}'" "$OUT_DIR/00-deploy.txt" | grep -oE "0x[0-9A-Fa-f]{40}")
  genlayer receipt "$DEPLOY_TX" --status FINALIZED --retries 120 --interval 5000 >"$OUT_DIR/00-deploy.receipt.txt" 2>&1
  echo "{\"label\":\"00-deploy\",\"tx\":\"$DEPLOY_TX\",\"contract\":\"$C\",\"status\":\"$(grep -oE "status_name: '[A-Z]+'" "$OUT_DIR/00-deploy.receipt.txt" | tail -1 | grep -oE "[A-Z]{4,}")\",\"leader\":\"$(grep -oE "execution_result: '[A-Z]+'" "$OUT_DIR/00-deploy.receipt.txt" | head -1 | grep -oE "[A-Z]{4,}")\"}"
  echo "$C" >deployments/studionet/CONTRACT
fi

CASE15=0x32cb0d3e1671088caafe62e7cbce1b875876a035   # standard agreement, verdict TRUE
CASE16=0x4f0e52342241539f5b4d1cc25dc4c6531049e44c   # standard agreement, verdict TRUE
TRADE0=0x778e3528940849432619142a8d7ac172486353bf   # registered TradeFxSettlement case
TRADE1=0xab772bb1d873ed851b6f1150100f085b36a1ca02   # registered TradeFxSettlement case
CASE17=0xc9ae7e8e15a110357b052ed764dab864f5a36a6c   # registered with the factory, not ruled yet
MOCK_USDC=0x58c27c7c1ff5dbf480c956acf6b119508b6fba4f # a contract that is not an Internet Court case
PARTY_A=0xe9630ba0e3cc2d3bfc58fbe1bbde478f06e4ce87  # party A in cases 15/16, exporter in trade cases
PARTY_B=0xce413ffe2628b60cdaf4413d63d7838b8d4309ac  # party B in cases 15 and 16
# Real first-funding pair found by scripts/find-funding-links.ts: 0xba44 (party A of case 13)
# sent 0x278d (party B of case 13) its first funds, before 0x278d's own nonce-0 transaction.
CHILD=0x278d35035fb589195ed513507ce7e32021659250
PARENT=0xba444be47ac0fb4738c6fcb33d19bc03e854b4b5
CHILD_FUNDING_TX=0x0d59fe83671bf6cb6404cd21126ed282ece59a460a9be23eefe759146d82083c
CHILD_FIRST_TX=0x3bff97209c095b6fbe30263bfd70cc563ea69ccc955f572228655104f195b676
# 0x6e40 (party A of case 14) was first funded by 0x007a, a Base Sepolia faucet that had already
# sent 18,881 transactions; it also funded the other side of case 14. Not an owner.
FAUCET_CHILD=0x6e40ddb9d0f797400d896da2197f455fca0129f2
FAUCET=0x007ab5199b6c57f7aa51bc3d0604a43505501a0c
FAUCET_FUNDING_TX=0xfac6b5b2994da4275cc0653a5a485e493d4c98ef03a6d1a661537e80d209e035
FAUCET_CHILD_FIRST_TX=0xcc21f1bf596c3679f10e3dd97e96798cf816879812bb54f61a1e14bd27594543
# PARTY_B's own nonce-0 transaction sends funds to 0x05e7 (used for the forged claim below)
OTHER=0x05e7ec36e5d31347b7aa90c7122a6d6e24fbe1a5
PARTY_B_FIRST_TX=0xcb103c14e7867ed94ec1080c036946d6136514a3b6e361158f369b519a3ebfbc

# --- The mechanism on real data
tx 01-judge-case15 "$C" judge_cases "[\"$CASE15\"]"
tx 02-judge-case16 "$C" judge_cases "[\"$CASE16\"]"
tx 03-judge-trade-case0 "$C" judge_cases "[\"$TRADE0\"]"
tx 04-judge-trade-case1 "$C" judge_cases "[\"$TRADE1\"]"
tx 05-prove-link-first-funded "$C" prove_link "$CHILD" "$PARENT" first_funded_by "{\"funding_tx\":\"$CHILD_FUNDING_TX\",\"subject_first_tx\":\"$CHILD_FIRST_TX\"}"

# --- Expected failures (each must FINALIZE with the named [EXPECTED] error and store nothing)
tx 06-EXPECTED-replay-judged-case "$C" judge_cases "[\"$CASE15\"]"
tx 07-EXPECTED-not-an-internet-court-case "$C" judge_cases "[\"$MOCK_USDC\"]"
tx 08-EXPECTED-case-not-ruled "$C" judge_cases "[\"$CASE17\"]"
# Claims 0x05e7 funded PARTY_B, citing a transaction that actually went PARTY_B -> 0x05e7.
tx 09-EXPECTED-forged-funding-direction "$C" prove_link "$PARTY_B" "$OTHER" first_funded_by "{\"funding_tx\":\"$PARTY_B_FIRST_TX\",\"subject_first_tx\":\"$PARTY_B_FIRST_TX\"}"
tx 10-EXPECTED-replay-proven-link "$C" prove_link "$PARENT" "$CHILD" first_funded_by "{\"funding_tx\":\"$CHILD_FUNDING_TX\",\"other_first_tx\":\"$CHILD_FIRST_TX\"}"
# A payment proves nothing about ownership (anyone can pay anyone), so the kind does not exist.
tx 11-EXPECTED-payment-is-not-a-link "$C" prove_link "$PARTY_B" "$OTHER" paid "{\"payment_tx\":\"$PARTY_B_FIRST_TX\"}"
# A real faucet cannot be recorded as an owner, so it cannot link the strangers it funded.
tx 12-EXPECTED-faucet-is-not-an-owner "$C" prove_link "$FAUCET_CHILD" "$FAUCET" first_funded_by "{\"funding_tx\":\"$FAUCET_FUNDING_TX\",\"subject_first_tx\":\"$FAUCET_CHILD_FIRST_TX\"}"

# --- The two abuses, staged on Base Sepolia by scripts/stage-abuses.ts (one operator controls
# every wallet). Both cases were decided by default judgment, not by the jury.
CASE19=0xb7a08ff8e092023eb7169f42a554261c3b0ebc9a   # fake win: AGENT_X beat SOCK_S by default
CASE20=0xcc955bfe47fca91d2f0f9e45ca773bc8556d65cd   # loss: CLIENT_Z beat AGENT_Y by default
AGENT_X=0x36b26d2df45a2838e6fe0f8b3c97cd0033a124cc
SOCK_S=0x2f7d415a7ec68fe94c589c8ba6d4959e6ac899ae
AGENT_Y=0x9a88ebbba9e7f52acaf296ae7706f9b16affad69
CLIENT_Z=0x5a5160eec0435cc20309735715b44898a46b8032
SUCCESSOR_N=0x9c985f2536587966f087e2677c81e386d4ab797c
tx 13-judge-staged-fake-win-case19 "$C" judge_cases "[\"$CASE19\"]"
tx 14-judge-staged-loss-case20 "$C" judge_cases "[\"$CASE20\"]"
# AGENT_X gave SOCK_S its first funds; SOCK_S's first transaction was accepting case 19.
tx 15-prove-link-sock-funded-by-agent "$C" prove_link "$SOCK_S" "$AGENT_X" first_funded_by "{\"funding_tx\":\"0x0e4bb6cd8f7d691963a7bc9ed4a5258996c0c0b5357740698710c29ca0d5cdb0\",\"subject_first_tx\":\"0x736c13a977a2dab4614acb93421ce768d1ce1285bef7640b80433fe092ab8cc0\"}"
# After losing case 20, AGENT_Y gave a brand-new wallet its first funds.
tx 16-prove-link-successor-funded-by-loser "$C" prove_link "$SUCCESSOR_N" "$AGENT_Y" first_funded_by "{\"funding_tx\":\"0x1d20cd311a57712a2bac0f166e89769d1d3c42b8e70ef81ae0c2172aa82f0ebb\",\"subject_first_tx\":\"0xc27de800b994be165bd65db76b3cf040ae338cdd1b01e37c8fc7a49ba495b311\"}"

# --- A Base mainnet link found by Nansen (related-wallets First Funder of 0xb5fe, party B of
# case 17), verified by validators against mainnet.base.org.
NANSEN_CHILD=0xb5fe6011cee8974c24c630afdf3c15f5620925b7
NANSEN_FUNDER=0xf171c23607b892797eb5eb4e52fc668f924df0a3
tx 17-prove-mainnet-link-found-by-nansen "$C" prove_link "$NANSEN_CHILD" "$NANSEN_FUNDER" first_funded_by "{\"network\":\"base\",\"funding_tx\":\"0x69752dea622c52a0bf066ceb64316f9d03c618a65aaeaac9ea0f8d75a45b324d\",\"subject_first_tx\":\"0x258f0bc72f7a6ccc50244fd8739302b7418bd1711d6103deb532f6d38fa85848\"}"

# --- v8 link kinds, staged on Base Sepolia by scripts/stage-v8-links.ts. Proofs are read from its
# output so the hashes are never copied by hand.
V8=deployments/base-sepolia/staged-v8-links.json
v8() { node -e "const c=require('./$V8').proofs['$1'];process.stdout.write([c.subject,c.other,c.kind,JSON.stringify(c.proof)].join('\n'))"; }
v8tx() { local label="$1" name="$2"; mapfile -t P < <(v8 "$name"); tx "$label" "$C" prove_link "${P[0]}" "${P[1]}" "${P[2]}" "${P[3]}"; }
v8tx 18-prove-signal-shared-cashout shared-cashout-signal
v8tx 19-prove-signal-closed-loop closed-loop-signal
v8tx 20-prove-direct-deployment deployed-by
v8tx 21-prove-multisig-operator operated-by
v8tx 22-EXPECTED-dust-breaks-owner-link EXPECTED-dust-breaks-owner-link
v8tx 23-EXPECTED-dust-is-below-minimum EXPECTED-dust-is-below-minimum
v8tx 24-EXPECTED-call-is-not-a-deployment EXPECTED-call-is-not-a-deployment
v8tx 25-EXPECTED-loop-below-minimum EXPECTED-loop-below-minimum
v8tx 26-EXPECTED-cashout-to-infrastructure EXPECTED-cashout-to-infrastructure
V8_P=$(node -p "require('./$V8').wallets.v8P.toLowerCase()")
V8_Q=$(node -p "require('./$V8').wallets.v8Q.toLowerCase()")
V8_K=$(node -p "require('./$V8').wallets.contractK.toLowerCase()")
V8_SAFE=$(node -p "require('./$V8').wallets.safe.toLowerCase()")

# --- Read-backs
for w in $V8_P $V8_Q; do echo "--- get_signals $w"; read_view get_signals --args "$w"; done
for w in $V8_K $V8_SAFE; do echo "--- get_links $w"; read_view get_links --args "$w"; done
echo "--- get_stats";               read_view get_stats
for case in $CASE15 $CASE16 $TRADE0 $TRADE1 $CASE19 $CASE20; do echo "--- get_case $case"; read_view get_case --args "$case"; done
for w in $CHILD $PARTY_B $SOCK_S $SUCCESSOR_N $NANSEN_CHILD; do echo "--- get_links $w"; read_view get_links --args "$w"; done
for w in $PARTY_A $PARTY_B $OTHER $CHILD $PARENT $AGENT_X $SOCK_S $AGENT_Y $CLIENT_Z $SUCCESSOR_N $NANSEN_CHILD; do echo "--- get_score $w"; read_view get_score --args "$w"; done
