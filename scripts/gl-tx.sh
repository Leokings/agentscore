#!/usr/bin/env bash
# Sends one AgentScore write on the configured GenLayer network, waits for FINALIZED, and prints
# a one-line JSON summary (tx, status, leader result, votes, error). Full receipts go to $OUT_DIR.
#   scripts/gl-tx.sh <label> <contract> <method> [args...]
set -uo pipefail
label="$1"; contract="$2"; method="$3"; shift 3
out_dir="${OUT_DIR:-deployments/studionet/receipts}"
mkdir -p "$out_dir"
log="$out_dir/$label.write.txt"

if [ "$#" -gt 0 ]; then
  genlayer write "$contract" "$method" --args "$@" >"$log" 2>&1
else
  genlayer write "$contract" "$method" >"$log" 2>&1
fi
tx=$(grep -oE "0x[0-9a-f]{64}" "$log" | head -n1)
if [ -z "$tx" ]; then
  echo "{\"label\":\"$label\",\"error\":\"no transaction hash; see $log\"}"
  exit 1
fi

receipt="$out_dir/$label.receipt.txt"
genlayer receipt "$tx" --status FINALIZED --retries 120 --interval 5000 >"$receipt" 2>&1
status=$(grep -oE "status_name: '[A-Z_]+'" "$receipt" | tail -n1 | grep -oE "[A-Z_]{4,}")
leader=$(grep -oE "execution_result: '[A-Z]+'" "$receipt" | head -n1 | grep -oE "[A-Z]{4,}")
agree=$(grep -cE "'0x[0-9A-Fa-f]{40}': 'agree'" "$receipt")
disagree=$(grep -cE "'0x[0-9A-Fa-f]{40}': 'disagree'" "$receipt")
err=$(grep -oE "\[(EXPECTED|EXTERNAL|TRANSIENT|LLM_ERROR)\] [a-z0-9_]+" "$receipt" | head -n1)
echo "{\"label\":\"$label\",\"tx\":\"$tx\",\"status\":\"$status\",\"leader\":\"$leader\",\"agree\":$agree,\"disagree\":$disagree,\"error\":\"$err\"}"
