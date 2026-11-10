"""Shared fixtures and chain/LLM mock builders for AgentScore direct-mode tests."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from tests.gltest_windows_compat import install_windows_direct_compatibility

install_windows_direct_compatibility()

CONTRACT = Path(__file__).resolve().parents[1] / "contracts" / "agent_score.py"
RPC = r"https://sepolia\.base\.org.*"
JUDGE_PROMPT = r".*finalized ruling from Internet Court.*"


def addr(n: int) -> str:
    return "0x" + format(n, "040x")


def tx(n: int) -> str:
    return "0x" + format(n, "064x")


# --- ABI encoders matching what the contract decodes ------------------------------------


def enc_uint(value: int) -> str:
    return "0x" + format(value, "064x")


def enc_addr(address: str) -> str:
    return "0x" + "0" * 24 + address[2:].lower()


def enc_string(text: str | bytes) -> str:
    raw = text if isinstance(text, bytes) else text.encode("utf-8")
    padded = raw + b"\0" * ((32 - len(raw) % 32) % 32)
    return "0x" + format(32, "064x") + format(len(raw), "064x") + padded.hex()


REVERT = None  # marker for a reverted eth_call

# Order must match the contract: agreementIds, agreements(0), then CASE_GETTERS in order.
GETTERS = ["partyA", "partyB", "status", "verdict", "statement", "reasoning", "exporter", "importer", "shipmentStatement", "shipmentVerdictReason"]


def rpc_body(case_id: int, slot0: str | None, getters: dict[str, str | None]) -> str:
    results = [enc_uint(case_id), enc_addr(slot0) if slot0 else enc_uint(0)] + [getters.get(g, REVERT) for g in GETTERS]
    items = []
    for i, r in enumerate(results):
        if r is None:
            items.append({"jsonrpc": "2.0", "id": i + 1, "error": {"code": 3, "message": "execution reverted"}})
        else:
            items.append({"jsonrpc": "2.0", "id": i + 1, "result": r})
    return json.dumps(list(reversed(items)))  # out of order on purpose: the contract matches by id


def agreement(party_a: str, party_b: str, statement: str, reasoning: str, verdict: int = 1, status: int = 4) -> dict[str, str | None]:
    return {
        "partyA": enc_addr(party_a),
        "partyB": enc_addr(party_b),
        "status": enc_uint(status),
        "verdict": enc_uint(verdict),
        "statement": enc_string(statement),
        "reasoning": enc_string(reasoning),
    }


def trade_fx(exporter: str, importer: str, statement: str, reason: str) -> dict[str, str | None]:
    return {
        "exporter": enc_addr(exporter),
        "importer": enc_addr(importer),
        "status": enc_uint(3),
        "shipmentStatement": enc_string(statement),
        "shipmentVerdictReason": enc_string(reason),
    }


def mock_case(vm, case_id: int, getters: dict[str, str | None], slot0: str | None = None, status: int = 200) -> None:
    vm.mock_web(RPC, {"status": status, "body": rpc_body(case_id, slot0, getters), "method": "POST"})


def mock_judgment(vm, prevailing: str | None = None, deception: bool = False, non_delivery: bool = False, pattern: str = JUDGE_PROMPT, raw: dict | None = None) -> None:
    """Mocks the validators' answer. `prevailing` is only asked for registered (app-specific) cases."""
    answer = raw if raw is not None else {"deception": "YES" if deception else "NO", "non_delivery": "YES" if non_delivery else "NO"}
    if raw is None and prevailing is not None:
        answer["prevailing_role"] = prevailing
    vm.mock_llm(pattern, json.dumps(answer))


def mock_tx(vm, tx_hash: str, sender: str, receiver: str, value: int = 10**15, nonce: int = 5, block: int = 100, status: str = "ok") -> None:
    body = {
        "hash": tx_hash,
        "from": {"hash": sender},
        "to": {"hash": receiver},
        "value": str(value),
        "nonce": nonce,
        "block_number": block,
        "status": status,
        "result": "success" if status == "ok" else "Reverted",
        "token_transfers": None,
        "timestamp": "2026-11-09T12:00:00Z",
        "confirmations": 12345,  # varies between fetches; the contract must ignore it
    }
    vm.mock_web(rf".*/transactions/{tx_hash}$", {"status": 200, "body": json.dumps(body)})


def judge_one(contract, vm, case: str, case_id: int, getters, **judgment) -> None:
    vm.clear_mocks()
    # A genuine case 0 round-trips through the factory's agreements(0).
    mock_case(vm, case_id, getters, slot0=case if case_id == 0 else None)
    mock_judgment(vm, **judgment)
    contract.judge_cases([case])


@pytest.fixture
def score(direct_vm, direct_deploy, direct_alice):
    direct_vm.sender = direct_alice
    direct_vm.warp("2026-11-09T12:00:00Z")
    return direct_deploy(str(CONTRACT), sdk_version="v0.2.16")
