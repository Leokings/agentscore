"""Runs the staged v8 link proofs (scripts/stage-v8-links.ts) through the contract against the real
Base Sepolia RPC node, before any deployment. Needs network access:  pytest -m live
"""

import json
import time
import urllib.error
import urllib.request
from pathlib import Path

import pytest

pytestmark = pytest.mark.live

STAGED = Path(__file__).resolve().parents[2] / "deployments" / "base-sepolia" / "staged-v8-links.json"


def real_base_node(data: dict) -> dict:
    """Forwards the contract's JSON-RPC batches to the public Base node, in the direct-mode shape."""
    body = data.get("body") or b""
    req = urllib.request.Request(data["url"], data=body if isinstance(body, bytes) else body.encode(), headers={"Content-Type": "application/json", "User-Agent": "agentscore-tests"})
    for _ in range(5):
        time.sleep(0.5)  # the public node allows 25 requests per second
        try:
            with urllib.request.urlopen(req, timeout=30) as res:
                text = res.read()
            if b"request limit" not in text:
                return {"ok": {"response": {"status": 200, "headers": {}, "body": text}}}
        except urllib.error.HTTPError as e:
            if e.code != 429:
                return {"ok": {"response": {"status": e.code, "headers": {}, "body": e.read()}}}
        time.sleep(2)
    pytest.skip("public Base Sepolia RPC kept rate-limiting the test")


def staged_cases():
    if not STAGED.exists():
        return []
    return list(json.loads(STAGED.read_text())["proofs"].items())


@pytest.mark.parametrize("name, case", staged_cases())
def test_staged_v8_proof_against_the_real_chain(score, direct_vm, name, case):
    direct_vm._live_web_handler = real_base_node
    proof = json.dumps(case["proof"])
    if name.startswith("EXPECTED-"):
        with pytest.raises(Exception, match=case["expect"]):
            score.prove_link(case["subject"], case["other"], case["kind"], proof)
    else:
        description = score.prove_link(case["subject"], case["other"], case["kind"], proof)
        signal = case["kind"] in ("shared_cashout", "closed_loop")
        stored = score.get_signals(case["subject"]) if signal else score.get_links(case["subject"])
        assert stored == {case["other"].lower(): description}
