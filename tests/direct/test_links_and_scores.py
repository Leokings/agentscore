"""Proving same-owner links and the deterministic grade, including the two abuses AgentScore blocks."""

import json

import pytest

from tests.conftest import addr, agreement, judge_one, mock_tx, tx

GOOD, CLIENT1, CLIENT2, CLIENT3, CLIENT4 = addr(0x600D), addr(0xC1), addr(0xC2), addr(0xC3), addr(0xC4)
FARMER, SOCK1, SOCK2, SOCK3 = addr(0xFA), addr(0x51), addr(0x52), addr(0x53)
BAD, VICTIM1, VICTIM2, FRESH = addr(0xBAD), addr(0x71), addr(0x72), addr(0xF5)
FUNDER, STRANGER = addr(0xF0), addr(0x5757)


def judge(score, vm, n: int, party_a: str, party_b: str, winner: str, **findings):
    """Judges a standard agreement; the on-chain verdict (TRUE = party A) decides the winner."""
    verdict = 1 if winner == party_a else 2
    getters = agreement(party_a, party_b, f"Deal number {n} was delivered as agreed", f"Ruling text for deal {n}.", verdict=verdict)
    judge_one(score, vm, addr(0xCA5E00 + n), n, getters, **findings)


def funding_proof(vm, n: int, child: str, parent: str, funding_block: int = 100, first_block: int = 101, nonce: int = 0, value: int = 10**15) -> str:
    """Mocks parent -> child funding and the child's first transaction; returns the proof JSON."""
    funding, first = tx(1000 + 2 * n), tx(1001 + 2 * n)
    mock_tx(vm, funding, parent, child, value=value, block=funding_block)
    mock_tx(vm, first, child, CLIENT1, nonce=nonce, block=first_block)
    return json.dumps({"funding_tx": funding, "subject_first_tx": first})


def prove_parent(score, vm, n: int, child: str, parent: str) -> str:
    return score.prove_link(child, parent, "first_funded_by", funding_proof(vm, n, child, parent))


# --- Link proofs ------------------------------------------------------------------------


def test_first_funding_link_is_stored_both_ways(score, direct_vm):
    assert prove_parent(score, direct_vm, 1, FRESH, BAD) == "other wallet sent the subject its first funds"
    assert score.get_links(FRESH) == {BAD: "other wallet sent the subject its first funds"}
    assert score.get_links(BAD) == {FRESH: "other wallet sent the subject its first funds"}


def test_parent_can_also_be_the_subject(score, direct_vm):
    # Same evidence, submitted with the parent as subject: the child's first tx goes under other_first_tx.
    funding, first = tx(50), tx(51)
    mock_tx(direct_vm, funding, BAD, FRESH, block=100)
    mock_tx(direct_vm, first, FRESH, CLIENT1, nonce=0, block=101)
    proof = json.dumps({"funding_tx": funding, "other_first_tx": first})
    assert score.prove_link(BAD, FRESH, "first_funded_by", proof) == "subject sent the other wallet its first funds"


def test_a_payment_is_not_proof_of_ownership(score, direct_vm):
    # A stranger can pay anyone; plain payments were removed as a link kind.
    mock_tx(direct_vm, tx(2), BAD, GOOD)
    with pytest.raises(Exception, match="unknown_link_kind"):
        score.prove_link(BAD, GOOD, "paid", json.dumps({"payment_tx": tx(2)}))
    assert score.get_links(GOOD) == {}


def test_dust_sent_after_a_wallet_started_cannot_smear_it(score, direct_vm):
    # BAD sends dust to GOOD after GOOD's first transaction: it is not GOOD's first funding.
    proof = funding_proof(direct_vm, 3, GOOD, BAD, funding_block=900, first_block=100, value=1)
    with pytest.raises(Exception, match="link_not_proven"):
        score.prove_link(GOOD, BAD, "first_funded_by", proof)
    assert score.get_links(GOOD) == {}


def test_first_tx_must_really_be_nonce_zero(score, direct_vm):
    proof = funding_proof(direct_vm, 4, FRESH, BAD, nonce=3)
    with pytest.raises(Exception, match="link_not_proven"):
        score.prove_link(FRESH, BAD, "first_funded_by", proof)


def test_funding_must_come_from_the_claimed_parent(score, direct_vm):
    proof = funding_proof(direct_vm, 5, FRESH, STRANGER)  # really funded by STRANGER
    with pytest.raises(Exception, match="link_not_proven"):
        score.prove_link(FRESH, BAD, "first_funded_by", proof)


def test_zero_value_funding_does_not_count(score, direct_vm):
    proof = funding_proof(direct_vm, 6, FRESH, BAD, value=0)
    with pytest.raises(Exception, match="link_not_proven"):
        score.prove_link(FRESH, BAD, "first_funded_by", proof)


def test_shared_first_funder_link(score, direct_vm):
    mock_tx(direct_vm, tx(10), FUNDER, FARMER, block=10)
    mock_tx(direct_vm, tx(11), FARMER, CLIENT1, nonce=0, block=11)
    mock_tx(direct_vm, tx(12), FUNDER, SOCK2, block=12)
    mock_tx(direct_vm, tx(13), SOCK2, CLIENT1, nonce=0, block=13)
    proof = json.dumps({"funder": FUNDER, "subject_funding_tx": tx(10), "subject_first_tx": tx(11), "other_funding_tx": tx(12), "other_first_tx": tx(13)})
    assert score.prove_link(FARMER, SOCK2, "shared_first_funder", proof) == "both were first funded by the same wallet"


def test_shared_funder_cannot_be_one_of_the_pair(score, direct_vm):
    mock_tx(direct_vm, tx(10), FARMER, SOCK2, block=10)
    mock_tx(direct_vm, tx(11), SOCK2, CLIENT1, nonce=0, block=11)
    proof = json.dumps({"funder": FARMER, "subject_funding_tx": tx(10), "subject_first_tx": tx(11), "other_funding_tx": tx(10), "other_first_tx": tx(11)})
    with pytest.raises(Exception, match="link_not_proven"):
        score.prove_link(SOCK2, FARMER, "shared_first_funder", proof)


def test_accepts_cli_style_calldata_proofs(score, direct_vm):
    # The GenLayer CLI decodes JSON arguments: tx hashes arrive as integers, addresses as Address.
    from genlayer.py.types import Address

    mock_tx(direct_vm, tx(10), FUNDER, FARMER, block=10)
    mock_tx(direct_vm, tx(11), FARMER, CLIENT1, nonce=0, block=11)
    mock_tx(direct_vm, tx(12), FUNDER, SOCK2, block=12)
    mock_tx(direct_vm, tx(13), SOCK2, CLIENT1, nonce=0, block=13)
    proof = {
        "funder": Address(FUNDER),
        "subject_funding_tx": int(tx(10), 16),
        "subject_first_tx": int(tx(11), 16),
        "other_funding_tx": int(tx(12), 16),
        "other_first_tx": int(tx(13), 16),
    }
    assert score.prove_link(Address(FARMER), Address(SOCK2), "shared_first_funder", proof) == "both were first funded by the same wallet"
    with pytest.raises(Exception, match="invalid_proof_json"):
        score.prove_link(FARMER, SOCK3, "first_funded_by", {"funding_tx": True})
    with pytest.raises(Exception, match="invalid_proof_json"):
        score.prove_link(FARMER, SOCK3, "first_funded_by", {})


def test_link_evidence_needs_exact_agreement(score, direct_vm):
    prove_parent(score, direct_vm, 7, FRESH, BAD)
    # Two evidence blocks were captured (funding tx, first tx), sorted by hash.
    honest = dict(direct_vm._captured_validators[0][0])
    assert direct_vm.run_validator(index=0) is True
    assert direct_vm.run_validator(index=0, leader_result={**honest, "block": honest["block"] - 50}) is False  # forged block
    assert direct_vm.run_validator(index=0, leader_result={**honest, "from": STRANGER}) is False  # forged sender
    assert direct_vm.run_validator(index=0, leader_result={**honest, "value": honest["value"] + 1}) is False  # forged value


def test_failed_or_missing_link_transactions(score, direct_vm):
    mock_tx(direct_vm, tx(20), BAD, FRESH, status="error")
    mock_tx(direct_vm, tx(21), FRESH, CLIENT1, nonce=0, block=101)
    with pytest.raises(Exception, match="link_tx_failed_or_pending"):
        score.prove_link(FRESH, BAD, "first_funded_by", json.dumps({"funding_tx": tx(20), "subject_first_tx": tx(21)}))
    direct_vm.mock_web(rf".*/transactions/{tx(22)}$", {"status": 404, "body": "{}"})
    with pytest.raises(Exception, match="link_tx_not_found"):
        score.prove_link(FRESH, BAD, "first_funded_by", json.dumps({"funding_tx": tx(22), "subject_first_tx": tx(21)}))


def test_link_replay_and_input_guards(score, direct_vm):
    proof = funding_proof(direct_vm, 8, FRESH, BAD)
    score.prove_link(FRESH, BAD, "first_funded_by", proof)
    with pytest.raises(Exception, match="link_already_proven"):
        score.prove_link(FRESH, BAD, "first_funded_by", proof)
    with pytest.raises(Exception, match="link_already_proven"):
        score.prove_link(BAD, FRESH, "first_funded_by", proof)  # the same pair from the other side
    with pytest.raises(Exception, match="self_link"):
        score.prove_link(FRESH, FRESH, "first_funded_by", proof)
    with pytest.raises(Exception, match="unknown_link_kind"):
        score.prove_link(FRESH, SOCK2, "vibes", proof)
    with pytest.raises(Exception, match="invalid_proof_json"):
        score.prove_link(FRESH, SOCK2, "first_funded_by", "not json")
    with pytest.raises(Exception, match="invalid_tx_hash"):
        score.prove_link(FRESH, SOCK2, "first_funded_by", '{"funding_tx": "0x1234"}')
    with pytest.raises(Exception, match="proof_too_large"):
        score.prove_link(FRESH, SOCK2, "first_funded_by", json.dumps({"funding_tx": tx(1), "pad": "x" * 2000}))


# --- Grades -----------------------------------------------------------------------------


def test_no_history_is_a_cautious_c(score):
    result = score.get_score(GOOD)
    assert (result["grade"], result["approval_limit_usd"], result["flags"]) == ("C", 100, ["NO_HISTORY"])


def test_genuine_wins_earn_an_a(score, direct_vm):
    for n, client in enumerate([CLIENT1, CLIENT2, CLIENT3, CLIENT4], start=1):
        judge(score, direct_vm, n, client, GOOD, winner=GOOD)
    result = score.get_score(GOOD)
    assert (result["grade"], result["points"], result["approval_limit_usd"]) == ("A", 90, 5000)


def test_fake_wins_against_own_wallets_are_discounted(score, direct_vm):
    for n, sock in enumerate([SOCK1, SOCK2, SOCK3], start=10):
        judge(score, direct_vm, n, sock, FARMER, winner=FARMER)
    assert score.get_score(FARMER)["grade"] == "A"  # looks perfect before anyone proves the links

    for i, sock in enumerate([SOCK1, SOCK2, SOCK3]):
        prove_parent(score, direct_vm, 20 + i, sock, FARMER)  # FARMER gave each sock its first gas

    result = score.get_score(FARMER)
    assert result["counts"]["wins"] == 0
    assert result["counts"]["fake_wins"] == 3
    assert (result["grade"], result["approval_limit_usd"]) == ("F", 0)
    assert "FAKE_WINS" in result["flags"]


def test_losses_follow_the_owner_to_a_fresh_wallet(score, direct_vm):
    judge(score, direct_vm, 20, VICTIM1, BAD, winner=VICTIM1, non_delivery=True)
    judge(score, direct_vm, 21, VICTIM2, BAD, winner=VICTIM2, non_delivery=True)
    assert score.get_score(BAD)["grade"] == "F"
    assert score.get_score(FRESH)["flags"] == ["NO_HISTORY"]  # a clean slate, until linked

    prove_parent(score, direct_vm, 30, FRESH, BAD)

    result = score.get_score(FRESH)
    assert result["counts"]["inherited_loss_weight"] == 4
    assert result["counts"]["inherited_cases"] == 2
    assert (result["grade"], result["approval_limit_usd"]) == ("F", 0)
    assert "INHERITED_LOSSES" in result["flags"]


def test_a_loss_is_not_double_counted_between_two_linked_parties(score, direct_vm):
    judge(score, direct_vm, 30, FARMER, SOCK1, winner=FARMER, non_delivery=True)  # SOCK1 loses to FARMER
    prove_parent(score, direct_vm, 31, SOCK1, FARMER)
    result = score.get_score(SOCK1)
    assert result["counts"]["loss_weight"] == 2
    assert result["counts"]["inherited_loss_weight"] == 0


def test_score_is_deterministic_and_order_independent(score, direct_vm):
    judge(score, direct_vm, 40, CLIENT1, GOOD, winner=GOOD)
    judge(score, direct_vm, 41, CLIENT2, GOOD, winner=CLIENT2, non_delivery=True)  # GOOD loses a MATERIAL case
    first = score.get_score(GOOD)
    assert first == score.get_score(GOOD)
    assert (first["points"], first["grade"]) == (50 + 10 - 15 * 2, "F")
