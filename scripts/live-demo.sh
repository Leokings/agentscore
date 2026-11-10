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

# --- Read-backs
echo "--- get_stats";               read_view get_stats
for case in $CASE15 $CASE16 $TRADE0 $TRADE1; do echo "--- get_case $case"; read_view get_case --args "$case"; done
for w in $CHILD $PARTY_B; do echo "--- get_links $w"; read_view get_links --args "$w"; done
for w in $PARTY_A $PARTY_B $OTHER $CHILD $PARENT; do echo "--- get_score $w"; read_view get_score --args "$w"; done
