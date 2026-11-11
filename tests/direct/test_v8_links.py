"""v8 links: first money in, minimum amounts, deployers, multisig operators, and the signal tier."""

import json

import pytest

from tests.conftest import addr, agreement, judge_one, mock_tx, node, tx

AGENT, OWNER, STRANGER, CLIENT = addr(0xA6), addr(0x0E), addr(0x5757), addr(0xC1)
OTHER, SAVINGS, FACTORY, SAFE, RELAYER = addr(0x07), addr(0x5A), addr(0xFAC), addr(0x5AFE), addr(0x3E1)
MAINNET_MIN, SEPOLIA_MIN = 10**15, 10**13
EXEC_SUCCESS = "0x442e715f626346e8c54381002da614f62bee8d27386535b2521ec8540898556e"
EXEC_FAILURE = "0x23428b18acfb3ea64b08dc0c1d296ea9c09702c09083ca5272e64d115b687d23"


def first_funding_proof(direct_vm, child: str, funder: str, value: int = 10**15, block: int = 100, network: str = "base-sepolia", n: int = 0) -> dict:
    funding, first = tx(3000 + 2 * n), tx(3001 + 2 * n)
    mock_tx(direct_vm, funding, funder, child, value=value, block=block, network=network)
    mock_tx(direct_vm, first, child, CLIENT, value=0, nonce=0, block=block + 5, network=network)
    proof = {"funding_tx": funding, "subject_first_tx": first}
    if network != "base-sepolia":
        proof["network"] = network
    return proof


def judge(score, vm, n: int, party_a: str, party_b: str, winner: str, resolution: str = "jury", **findings):
    verdict = 1 if winner == party_a else 2
    getters = agreement(party_a, party_b, f"Deal {n} was delivered as agreed", f"Ruling {n}.", verdict=verdict, resolution=resolution)
    judge_one(score, vm, addr(0xCA5E00 + n), n, getters, **findings)


# --- First funding: first money in, and a minimum amount -----------------------------------


def test_dust_sent_before_the_real_funding_cannot_create_a_link(score, direct_vm):
    # A stranger sees the new address before its owner funds it and sends dust first.
    mock_tx(direct_vm, tx(1), STRANGER, AGENT, value=10**12, block=90)  # below the testnet minimum
    proof = first_funding_proof(direct_vm, AGENT, OWNER, block=100)
    # The owner's funding no longer starts from an empty wallet...
    with pytest.raises(Exception, match="not_first_money_in"):
        score.prove_link(AGENT, OWNER, "first_funded_by", json.dumps(proof))
    # ...and the dust itself is too small to count.
    with pytest.raises(Exception, match="funding_below_minimum"):
        score.prove_link(AGENT, STRANGER, "first_funded_by", json.dumps({**proof, "funding_tx": tx(1)}))
    assert score.get_links(AGENT) == {}


def test_a_large_payment_sent_first_is_the_residual_race(score, direct_vm):
    # Documented limit: an outsider who pays at least the minimum to an unused address before
    # its owner does becomes its first funder. It costs them the payment, which goes to the victim.
    proof = first_funding_proof(direct_vm, AGENT, STRANGER, value=SEPOLIA_MIN, block=100)
    assert score.prove_link(AGENT, STRANGER, "first_funded_by", json.dumps(proof)).startswith("other wallet sent")


def test_two_payments_in_the_same_block_are_not_a_clean_first_funding(score, direct_vm):
    mock_tx(direct_vm, tx(2), STRANGER, AGENT, value=10**15, block=100)
    proof = first_funding_proof(direct_vm, AGENT, OWNER, block=100)
    with pytest.raises(Exception, match="not_first_money_in"):
        score.prove_link(AGENT, OWNER, "first_funded_by", json.dumps(proof))


def test_minimum_amounts_per_network(score, direct_vm):
    small = first_funding_proof(direct_vm, AGENT, OWNER, value=MAINNET_MIN - 1, network="base", n=1)
    with pytest.raises(Exception, match="funding_below_minimum"):
        score.prove_link(AGENT, OWNER, "first_funded_by", json.dumps(small))
    ok = first_funding_proof(direct_vm, OTHER, OWNER, value=MAINNET_MIN, network="base", n=2)
    assert score.prove_link(OTHER, OWNER, "first_funded_by", json.dumps(ok)).endswith("(base)")
    testnet = first_funding_proof(direct_vm, AGENT, OWNER, value=SEPOLIA_MIN, n=3)
    assert score.prove_link(AGENT, OWNER, "first_funded_by", json.dumps(testnet)).endswith("(base-sepolia)")


def test_shared_first_funder_needs_first_money_in_for_both(score, direct_vm):
    a = first_funding_proof(direct_vm, AGENT, OWNER, n=4)
    b = first_funding_proof(direct_vm, OTHER, OWNER, n=5)
    mock_tx(direct_vm, tx(3), STRANGER, OTHER, value=10**15, block=50)  # OTHER had money before
    proof = {"funder": OWNER, "subject_funding_tx": a["funding_tx"], "subject_first_tx": a["subject_first_tx"], "other_funding_tx": b["funding_tx"], "other_first_tx": b["subject_first_tx"]}
    with pytest.raises(Exception, match="not_first_money_in"):
        score.prove_link(AGENT, OTHER, "shared_first_funder", json.dumps(proof))


def test_a_rate_limited_balance_read_is_an_outage(score, direct_vm):
    proof = first_funding_proof(direct_vm, AGENT, OWNER, n=6)
    node(direct_vm).rate_limited_methods = {"eth_getBalance"}
    with pytest.raises(Exception, match=r"\[TRANSIENT\] rpc_call_error"):
        score.prove_link(AGENT, OWNER, "first_funded_by", json.dumps(proof))


# --- Deployers -----------------------------------------------------------------------------


def test_a_direct_deployment_proves_ownership(score, direct_vm):
    mock_tx(direct_vm, tx(10), OWNER, None, value=0, nonce=3, creates=AGENT)
    assert score.prove_link(AGENT, OWNER, "deployed_by", json.dumps({"creation_tx": tx(10)})) == "other wallet deployed the subject's contract (base-sepolia)"
    assert OWNER in score.get_links(AGENT)


def test_a_factory_deployment_never_links_strangers(score, direct_vm):
    # Most smart accounts come from a shared factory: the transaction calls the factory, so it is
    # not a contract creation by an ordinary wallet.
    mock_tx(direct_vm, tx(11), OWNER, FACTORY, value=0)
    with pytest.raises(Exception, match="not_a_direct_deployment"):
        score.prove_link(AGENT, OWNER, "deployed_by", json.dumps({"creation_tx": tx(11)}))


def test_deployer_must_match_and_not_be_infrastructure(score, direct_vm):
    mock_tx(direct_vm, tx(12), STRANGER, None, value=0, creates=AGENT)
    with pytest.raises(Exception, match="link_not_proven"):
        score.prove_link(AGENT, OWNER, "deployed_by", json.dumps({"creation_tx": tx(12)}))
    mock_tx(direct_vm, tx(13), OWNER, None, value=0, nonce=5000, creates=OTHER)
    with pytest.raises(Exception, match="deployer_is_infrastructure"):
        score.prove_link(OTHER, OWNER, "deployed_by", json.dumps({"creation_tx": tx(13)}))
    mock_tx(direct_vm, tx(14), OWNER, None, value=0, creates=SAVINGS)
    with pytest.raises(Exception, match="not_a_direct_deployment"):
        score.prove_link(AGENT, OWNER, "deployed_by", json.dumps({"creation_tx": tx(14)}))


def test_shared_deployer(score, direct_vm):
    mock_tx(direct_vm, tx(15), OWNER, None, value=0, creates=AGENT)
    mock_tx(direct_vm, tx(16), OWNER, None, value=0, creates=OTHER)
    proof = {"subject_creation_tx": tx(15), "other_creation_tx": tx(16)}
    assert score.prove_link(AGENT, OTHER, "shared_deployer", json.dumps(proof)) == "both contracts were deployed by the same wallet (base-sepolia)"
    mock_tx(direct_vm, tx(17), STRANGER, None, value=0, creates=SAVINGS)
    with pytest.raises(Exception, match="link_not_proven"):
        score.prove_link(AGENT, SAVINGS, "shared_deployer", json.dumps({"subject_creation_tx": tx(15), "other_creation_tx": tx(17)}))


# --- Multisig operators --------------------------------------------------------------------


def safe_exec_input(v1_signers: list[str], ecdsa: int = 0) -> str:
    """ABI-encodes execTransaction(to, value, data="", operation, safeTxGas, baseGas, gasPrice,
    gasToken, refundReceiver, signatures) with v=1 entries for the given owners."""
    word = lambda n: format(n, "064x")  # noqa: E731
    sigs = b"".join(bytes(12) + bytes.fromhex(s[2:]) + bytes(32) + b"\x01" for s in v1_signers)
    sigs += b"".join(bytes(32) + bytes(32) + b"\x1b" for _ in range(ecdsa))
    head = [word(int(CLIENT, 16)), word(0), word(10 * 32), word(0), word(0), word(0), word(0), word(0), word(0), word(11 * 32)]
    data_part = word(0)  # empty `data`
    sig_len = len(sigs)
    sig_part = word(sig_len) + sigs.hex() + "00" * ((32 - sig_len % 32) % 32)
    return "0x6a761202" + "".join(head) + data_part + sig_part


def mock_safe_exec(vm, h: str, sender: str, safe: str, signers: list[str], topic: str = EXEC_SUCCESS, nonce: int = 4, ecdsa: int = 0):
    logs = [{"address": safe, "topics": [topic, "0x" + "ab" * 32]}]
    mock_tx(vm, h, sender, safe, value=0, nonce=nonce, data=safe_exec_input(signers, ecdsa), logs=logs)


def test_an_owner_running_a_multisig_transaction_is_proven(score, direct_vm):
    mock_safe_exec(direct_vm, tx(20), OWNER, SAFE, [OWNER])
    assert score.prove_link(SAFE, OWNER, "operated_by", json.dumps({"exec_tx": tx(20)})).startswith("one wallet ran a transaction")
    assert OWNER in score.get_links(SAFE)


def test_relaying_someone_elses_signatures_proves_nothing(score, direct_vm):
    # A stranger submits a fully signed multisig transaction (signatures can be public). The
    # Safe accepts it, but the stranger is not an owner: only v=1 approvals by the sender count.
    mock_safe_exec(direct_vm, tx(21), STRANGER, SAFE, [], ecdsa=2)
    with pytest.raises(Exception, match="not_a_safe_owner_execution"):
        score.prove_link(SAFE, STRANGER, "operated_by", json.dumps({"exec_tx": tx(21)}))
    # Naming another owner's approval does not help either.
    mock_safe_exec(direct_vm, tx(22), STRANGER, SAFE, [OWNER])
    with pytest.raises(Exception, match="not_a_safe_owner_execution"):
        score.prove_link(SAFE, STRANGER, "operated_by", json.dumps({"exec_tx": tx(22)}))


def test_a_failed_multisig_execution_or_a_relayer_service_does_not_count(score, direct_vm):
    mock_safe_exec(direct_vm, tx(23), OWNER, SAFE, [OWNER], topic=EXEC_FAILURE)
    with pytest.raises(Exception, match="not_a_safe_owner_execution"):
        score.prove_link(SAFE, OWNER, "operated_by", json.dumps({"exec_tx": tx(23)}))
    mock_safe_exec(direct_vm, tx(24), RELAYER, SAFE, [RELAYER], nonce=90_000)
    with pytest.raises(Exception, match="operator_is_infrastructure"):
        score.prove_link(SAFE, RELAYER, "operated_by", json.dumps({"exec_tx": tx(24)}))


def test_a_leader_cannot_forge_multisig_or_deployment_evidence(score, direct_vm):
    mock_safe_exec(direct_vm, tx(25), STRANGER, SAFE, [], ecdsa=1)
    mock_tx(direct_vm, tx(26), STRANGER, FACTORY, value=0)
    for kind, proof in (("operated_by", {"exec_tx": tx(25)}), ("deployed_by", {"creation_tx": tx(26)})):
        with pytest.raises(Exception):
            score.prove_link(SAFE, STRANGER, kind, json.dumps(proof))
    honest_exec = direct_vm._captured_validators[0][0]
    forged = {**honest_exec, "txs": {tx(25): {**honest_exec["txs"][tx(25)], "safe_signers": [STRANGER]}}}
    # The failed leader result is the reference; a leader claiming success with forged fields loses.
    assert direct_vm.run_validator(index=0, leader_result=forged) is False


# --- Signals: shared cash-out and closed loops ---------------------------------------------


def cashout_proof(vm, c_nonce: int = 7, a_value: int = 10**15, b_value: int = 10**15, a_block: int = 100, b_block: int = 200, c_block: int = 300) -> str:
    mock_tx(vm, tx(40), AGENT, SAVINGS, value=a_value, block=a_block)
    mock_tx(vm, tx(41), OTHER, SAVINGS, value=b_value, block=b_block)
    mock_tx(vm, tx(42), SAVINGS, CLIENT, value=1, nonce=c_nonce, block=c_block)
    return json.dumps({"subject_tx": tx(40), "other_tx": tx(41), "cashout_tx": tx(42)})


def test_a_shared_cashout_is_a_signal_not_a_proven_link(score, direct_vm):
    assert score.prove_link(AGENT, OTHER, "shared_cashout", cashout_proof(direct_vm)).startswith("both sent money")
    assert score.get_links(AGENT) == {}
    assert OTHER in score.get_signals(AGENT) and AGENT in score.get_signals(OTHER)


def test_cashout_rules(score, direct_vm):
    with pytest.raises(Exception, match="payment_below_minimum"):
        score.prove_link(AGENT, OTHER, "shared_cashout", cashout_proof(direct_vm, b_value=SEPOLIA_MIN - 1))
    with pytest.raises(Exception, match="cashout_payments_too_far_apart"):
        score.prove_link(AGENT, OTHER, "shared_cashout", cashout_proof(direct_vm, b_block=100 + 30 * 24 * 1800 + 1, c_block=10**8))
    with pytest.raises(Exception, match="cashout_wallet_is_infrastructure"):
        score.prove_link(AGENT, OTHER, "shared_cashout", cashout_proof(direct_vm, c_nonce=18_881))
    # The cash-out wallet's own transaction must come after both payments.
    with pytest.raises(Exception, match="link_not_proven"):
        score.prove_link(AGENT, OTHER, "shared_cashout", cashout_proof(direct_vm, c_block=150))


def loop_proof(vm, back_value: int = 9 * 10**14, back_block: int = 150, back_nonce: int = 3) -> str:
    mock_tx(vm, tx(50), AGENT, OTHER, value=10**15, block=100)
    mock_tx(vm, tx(51), OTHER, AGENT, value=back_value, nonce=back_nonce, block=back_block)
    return json.dumps({"out_tx": tx(50), "back_tx": tx(51)})


def test_closed_loop_rules(score, direct_vm):
    with pytest.raises(Exception, match="loop_too_small_or_slow"):
        score.prove_link(AGENT, OTHER, "closed_loop", loop_proof(direct_vm, back_value=5 * 10**14))
    with pytest.raises(Exception, match="loop_too_small_or_slow"):
        score.prove_link(AGENT, OTHER, "closed_loop", loop_proof(direct_vm, back_block=100 + 24 * 1800 + 1))
    with pytest.raises(Exception, match="loop_wallet_is_infrastructure"):
        score.prove_link(AGENT, OTHER, "closed_loop", loop_proof(direct_vm, back_nonce=5000))
    assert score.prove_link(AGENT, OTHER, "closed_loop", loop_proof(direct_vm)).startswith("money went to the other wallet")
    assert OTHER in score.get_signals(AGENT)


def test_a_signal_caps_the_limit_at_100_and_never_costs_points(score, direct_vm):
    # AGENT: four jury wins, grade A ($5,000 without escrow). OTHER lost a severe case.
    for n, client in enumerate([CLIENT, addr(0xC2), addr(0xC3), addr(0xC4)], start=60):
        judge(score, direct_vm, n, client, AGENT, winner=AGENT)
    judge(score, direct_vm, 64, addr(0xC5), OTHER, winner=addr(0xC5), deception=True)
    before = score.get_score(AGENT)
    assert (before["grade"], before["points"], before["approval_limit_usd"]) == ("A", 82, 5000)

    score.prove_link(AGENT, OTHER, "shared_cashout", cashout_proof(direct_vm))
    after = score.get_score(AGENT)
    # Same grade and points, no inherited loss, but jobs above $100 now need escrow.
    assert (after["grade"], after["points"], after["approval_limit_usd"]) == ("A", 82, 100)
    assert "POSSIBLE_SAME_OWNER" in after["flags"]
    assert after["counts"]["inherited_penalty"] == 0 and after["counts"]["signal_links"] == 1
    # A wallet already below the cap keeps its lower limit.
    assert score.get_score(OTHER)["approval_limit_usd"] == 0


def test_signals_never_mark_fake_wins(score, direct_vm):
    judge(score, direct_vm, 63, AGENT, OTHER, winner=AGENT)
    score.prove_link(AGENT, OTHER, "closed_loop", loop_proof(direct_vm))
    result = score.get_score(AGENT)
    assert (result["counts"]["wins"], result["counts"]["fake_wins"]) == (1, 0)


def test_a_signal_upgrades_to_a_proven_link_and_never_downgrades(score, direct_vm):
    score.prove_link(AGENT, OTHER, "closed_loop", loop_proof(direct_vm))
    with pytest.raises(Exception, match="link_already_proven"):
        score.prove_link(OTHER, AGENT, "shared_cashout", cashout_proof(direct_vm))
    mock_tx(direct_vm, tx(70), AGENT, None, value=0, creates=OTHER)
    score.prove_link(OTHER, AGENT, "deployed_by", json.dumps({"creation_tx": tx(70)}))
    assert AGENT in score.get_links(OTHER) and score.get_signals(OTHER) == {} and score.get_signals(AGENT) == {}
    with pytest.raises(Exception, match="link_already_proven"):
        score.prove_link(AGENT, OTHER, "closed_loop", loop_proof(direct_vm))
