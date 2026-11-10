"""Feeds real Base Sepolia RPC responses into the contract to check the ABI decoding.

Needs network access. Run with:  pytest -m live
"""

import json
import time
import urllib.error
import urllib.request

import pytest

from tests.conftest import GETTERS, RPC, SELECTORS as CONFTEST_SELECTORS, mock_judgment

pytestmark = pytest.mark.live

FACTORY = "0xd533cb0b52e85b3f506b6f0c28b8f6bc4e449dda"
SELECTORS = {name: selector for selector, name in CONFTEST_SELECTORS.items()}


def live_batch(case: str) -> str:
    calls = [(FACTORY, "943a5009" + "0" * 24 + case[2:]), (FACTORY, "bd14de96" + "0" * 64)] + [(case, SELECTORS[g]) for g in GETTERS]
    payload = [{"jsonrpc": "2.0", "id": i + 1, "method": "eth_call", "params": [{"to": to, "data": "0x" + data}, "latest"]} for i, (to, data) in enumerate(calls)]
    req = urllib.request.Request("https://sepolia.base.org", data=json.dumps(payload).encode(), headers={"Content-Type": "application/json", "User-Agent": "agentscore-tests"})
    # The public node allows 25 requests per second and counts every call in a batch.
    for attempt in range(5):
        time.sleep(1.5)
        try:
            with urllib.request.urlopen(req, timeout=30) as res:
                body = res.read().decode()
        except urllib.error.HTTPError as e:
            if e.code != 429:
                raise
            continue
        if "request limit" not in body:
            return body
    pytest.skip("public Base Sepolia RPC kept rate-limiting the test")


@pytest.mark.parametrize(
    "case,case_type,case_id,roles,first_party,resolution",
    [
        ("0x32cb0d3e1671088caafe62e7cbce1b875876a035", "Agreement", 15, ["partyA", "partyB"], "0xe9630ba0e3cc2d3bfc58fbe1bbde478f06e4ce87", "jury"),
        ("0x778e3528940849432619142a8d7ac172486353bf", "TradeFxSettlement", 0, ["exporter", "importer"], "0xe9630ba0e3cc2d3bfc58fbe1bbde478f06e4ce87", "jury"),
        # Staged case 19 (scripts/stage-abuses.ts): decided by default judgment, not by the jury.
        ("0xb7a08ff8e092023eb7169f42a554261c3b0ebc9a", "Agreement", 19, ["partyA", "partyB"], "0x36b26d2df45a2838e6fe0f8b3c97cd0033a124cc", "default"),
    ],
)
def test_reads_real_internet_court_cases(score, direct_vm, case, case_type, case_id, roles, first_party, resolution):
    direct_vm.mock_web(RPC, {"status": 200, "body": live_batch(case), "method": "POST"})
    mock_judgment(direct_vm, prevailing="NONE")
    score.judge_cases([case])
    record = score.get_case(case)
    assert record["case_type"] == case_type
    assert record["case_id"] == case_id
    assert [p["role"] for p in record["parties"]] == roles
    assert record["parties"][0]["address"] == first_party
    assert record["resolution"] == resolution
