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


FACTORY = "0xd533cb0b52e85b3f506b6f0c28b8f6bc4e449dda"
SELECTORS = {
    "943a5009": "agreementIds",
    "bd14de96": "agreements",
    "10e1d8ca": "partyA",
    "29040113": "partyB",
    "200d2ed2": "status",
    "6aba253c": "verdict",
    "e42cb9f3": "statement",
    "512b69fe": "reasoning",
    "4bbbe0cc": "exporter",
    "62932301": "importer",
    "34120d79": "shipmentStatement",
    "503ae34e": "shipmentVerdictReason",
}


class FakeBaseNode:
    """A tiny JSON-RPC node for Base Sepolia and Base mainnet, answering the calls the contract makes:
    eth_call (Internet Court factory + case getters), eth_getTransactionByHash, eth_getTransactionReceipt.
    It reads the request body, so one batch can ask for any mix of transactions."""

    def __init__(self) -> None:
        self.case_id = 0
        self.slot0: str | None = None
        self.getters: dict[str, str | None] = {}
        self.txs: dict[str, dict[str, dict]] = {"base-sepolia": {}, "base": {}}
        self.http_status = 200

    def handle(self, data: dict) -> dict:
        url = data.get("url", "")
        if "base.org" not in url:
            raise AssertionError(f"unexpected request to {url}")
        network = "base" if "mainnet.base.org" in url else "base-sepolia"
        body = data.get("body") or b"[]"
        requests = json.loads(body.decode() if isinstance(body, (bytes, bytearray)) else body)
        if self.http_status != 200:
            return self._response(self.http_status, "{}")
        answers = [self._answer(network, r) for r in requests]
        return self._response(200, json.dumps(list(reversed(answers))))  # out of order on purpose

    @staticmethod
    def _response(status: int, body: str) -> dict:
        return {"ok": {"response": {"status": status, "headers": {}, "body": body.encode()}}}

    def _answer(self, network: str, req: dict) -> dict:
        rid, method, params = req["id"], req["method"], req.get("params", [])
        if method == "eth_call":
            to, data = params[0]["to"].lower(), params[0]["data"][2:]
            name = SELECTORS.get(data[:8])
            if to == FACTORY and name == "agreementIds":
                result = enc_uint(self.case_id)
            elif to == FACTORY and name == "agreements":
                result = enc_addr(self.slot0) if self.slot0 else enc_uint(0)
            else:
                result = self.getters.get(name or "", REVERT)
            if result is None:
                return {"jsonrpc": "2.0", "id": rid, "error": {"code": 3, "message": "execution reverted"}}
            return {"jsonrpc": "2.0", "id": rid, "result": result}
        tx = self.txs[network].get(params[0].lower())
        if method == "eth_getTransactionByHash":
            if tx is None:
                return {"jsonrpc": "2.0", "id": rid, "result": None}
            fields = {k: v for k, v in tx.items() if k != "receipt_status"}
            return {"jsonrpc": "2.0", "id": rid, "result": {**fields, "gasPrice": "0x5", "input": "0x"}}
        if method == "eth_getTransactionReceipt":
            if tx is None or tx["receipt_status"] is None:
                return {"jsonrpc": "2.0", "id": rid, "result": None}
            return {"jsonrpc": "2.0", "id": rid, "result": {"status": tx["receipt_status"], "transactionHash": params[0]}}
        return {"jsonrpc": "2.0", "id": rid, "error": {"code": -32601, "message": "method not found"}}


def node(vm) -> FakeBaseNode:
    return vm._live_web_handler.__self__


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
    """Points the fake node's Internet Court state at one case (any case address reads it)."""
    n = node(vm)
    n.case_id, n.slot0, n.getters, n.http_status = case_id, slot0, getters, status


def mock_judgment(vm, prevailing: str | None = None, deception: bool = False, non_delivery: bool = False, pattern: str = JUDGE_PROMPT, raw: dict | None = None) -> None:
    """Mocks the validators' answer. `prevailing` is only asked for registered (app-specific) cases."""
    answer = raw if raw is not None else {"deception": "YES" if deception else "NO", "non_delivery": "YES" if non_delivery else "NO"}
    if raw is None and prevailing is not None:
        answer["prevailing_role"] = prevailing
    vm.mock_llm(pattern, json.dumps(answer))


def mock_tx(vm, tx_hash: str, sender: str, receiver: str, value: int = 10**15, nonce: int = 5, block: int = 100, status: str = "ok", network: str = "base-sepolia") -> None:
    """Adds a mined transaction to the fake node. status: ok | failed | pending."""
    node(vm).txs[network][tx_hash.lower()] = {
        "hash": tx_hash,
        "from": sender,
        "to": receiver,
        "value": hex(value),
        "nonce": hex(nonce),
        "blockNumber": hex(block),
        "receipt_status": {"ok": "0x1", "failed": "0x0", "pending": None}[status],
    }


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
    # Requests with no registered mock fall through to the fake node (registered mocks win).
    direct_vm._live_web_handler = FakeBaseNode().handle
    return direct_deploy(str(CONTRACT), sdk_version="v0.2.16")
