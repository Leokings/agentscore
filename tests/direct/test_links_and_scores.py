"""Proving same-owner links and the deterministic grade, including the two abuses AgentScore blocks."""

import json

import pytest

from tests.conftest import addr, agreement, judge_one, mock_tx, node, tx

GOOD, CLIENT1, CLIENT2, CLIENT3, CLIENT4 = addr(0x600D), addr(0xC1), addr(0xC2), addr(0xC3), addr(0xC4)
FARMER, SOCK1, SOCK2, SOCK3 = addr(0xFA), addr(0x51), addr(0x52), addr(0x53)
BAD, VICTIM1, VICTIM2, FRESH = addr(0xBAD), addr(0x71), addr(0x72), addr(0xF5)
FUNDER, STRANGER = addr(0xF0), addr(0x5757)


def judge(score, vm, n: int, party_a: str, party_b: str, winner: str, resolution: str = "jury", **findings):
    """Judges a standard agreement; the on-chain verdict (TRUE = party A) decides the winner."""
    verdict = 1 if winner == party_a else 2
    getters = agreement(party_a, party_b, f"Deal number {n} was delivered as agreed", f"Ruling text for deal {n}.", verdict=verdict, resolution=resolution)
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
    assert prove_parent(score, direct_vm, 1, FRESH, BAD) == "other wallet sent the subject its first funds (base-sepolia)"
    assert score.get_links(FRESH) == {BAD: "other wallet sent the subject its first funds (base-sepolia)"}
    assert score.get_links(BAD) == {FRESH: "other wallet sent the subject its first funds (base-sepolia)"}


def test_parent_can_also_be_the_subject(score, direct_vm):
    # Same evidence, submitted with the parent as subject: the child's first tx goes under other_first_tx.
    funding, first = tx(50), tx(51)
    mock_tx(direct_vm, funding, BAD, FRESH, block=100)
    mock_tx(direct_vm, first, FRESH, CLIENT1, nonce=0, block=101)
    proof = json.dumps({"funding_tx": funding, "other_first_tx": first})
    assert score.prove_link(BAD, FRESH, "first_funded_by", proof) == "subject sent the other wallet its first funds (base-sepolia)"


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
    assert score.prove_link(FARMER, SOCK2, "shared_first_funder", proof) == "both were first funded by the same wallet (base-sepolia)"


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
    assert score.prove_link(Address(FARMER), Address(SOCK2), "shared_first_funder", proof) == "both were first funded by the same wallet (base-sepolia)"
    with pytest.raises(Exception, match="invalid_proof_json"):
        score.prove_link(FARMER, SOCK3, "first_funded_by", {"funding_tx": True})
    with pytest.raises(Exception, match="invalid_proof_json"):
        score.prove_link(FARMER, SOCK3, "first_funded_by", {})


def test_link_evidence_needs_exact_agreement(score, direct_vm):
    prove_parent(score, direct_vm, 7, FRESH, BAD)
    # One evidence block fetches every transaction in the proof from the RPC node.
    # One evidence block fetches every transaction in the proof, plus the funded wallet's balance
    # just before and at the funding block.
    honest = direct_vm._captured_validators[0][0]
    funding = tx(1000 + 14)
    assert direct_vm.run_validator(index=0) is True
    assert set(honest["balances"]) == {f"{FRESH}@99", f"{FRESH}@100"}

    def forged(**changes):
        return {**honest, "txs": {**honest["txs"], funding: {**honest["txs"][funding], **changes}}}

    assert direct_vm.run_validator(index=0, leader_result=forged(block=honest["txs"][funding]["block"] - 50)) is False
    assert direct_vm.run_validator(index=0, leader_result=forged(**{"from": STRANGER})) is False
    assert direct_vm.run_validator(index=0, leader_result=forged(value=honest["txs"][funding]["value"] + 1)) is False
    assert direct_vm.run_validator(index=0, leader_result=forged(nonce=0)) is False
    # A leader claiming the wallet was empty before (to hide earlier money) is caught too.
    assert direct_vm.run_validator(index=0, leader_result={**honest, "balances": {**honest["balances"], f"{FRESH}@99": 1}}) is False


def test_failed_pending_or_missing_link_transactions(score, direct_vm):
    mock_tx(direct_vm, tx(20), BAD, FRESH, status="failed")
    mock_tx(direct_vm, tx(21), FRESH, CLIENT1, nonce=0, block=101)
    mock_tx(direct_vm, tx(23), BAD, FRESH, status="pending")
    with pytest.raises(Exception, match="link_tx_failed_or_pending"):
        score.prove_link(FRESH, BAD, "first_funded_by", json.dumps({"funding_tx": tx(20), "subject_first_tx": tx(21)}))
    with pytest.raises(Exception, match="link_tx_failed_or_pending"):
        score.prove_link(FRESH, BAD, "first_funded_by", json.dumps({"funding_tx": tx(23), "subject_first_tx": tx(21)}))
    with pytest.raises(Exception, match="link_tx_not_found"):  # tx(22) was never mined
        score.prove_link(FRESH, BAD, "first_funded_by", json.dumps({"funding_tx": tx(22), "subject_first_tx": tx(21)}))


@pytest.mark.parametrize("status,code", [(503, "TRANSIENT"), (429, "TRANSIENT"), (403, "EXTERNAL")])
def test_rpc_outages_fail_closed_for_links(score, direct_vm, status, code):
    from tests.conftest import node

    proof = funding_proof(direct_vm, 9, FRESH, BAD)
    node(direct_vm).http_status = status
    with pytest.raises(Exception, match=code):
        score.prove_link(FRESH, BAD, "first_funded_by", proof)
    assert score.get_links(FRESH) == {}


# --- Exchanges, faucets and mainnet ------------------------------------------------------


def test_an_exchange_or_faucet_cannot_link_wallets(score, direct_vm):
    # The funder had already sent 50,000 transactions when it funded both wallets: infrastructure.
    mock_tx(direct_vm, tx(60), FUNDER, FARMER, nonce=50_000, block=10)
    mock_tx(direct_vm, tx(61), FARMER, CLIENT1, nonce=0, block=11)
    mock_tx(direct_vm, tx(62), FUNDER, SOCK2, nonce=50_001, block=12)
    mock_tx(direct_vm, tx(63), SOCK2, CLIENT1, nonce=0, block=13)
    proof = json.dumps({"funder": FUNDER, "subject_funding_tx": tx(60), "subject_first_tx": tx(61), "other_funding_tx": tx(62), "other_first_tx": tx(63)})
    with pytest.raises(Exception, match="funder_is_infrastructure"):
        score.prove_link(FARMER, SOCK2, "shared_first_funder", proof)
    # The same rule stops an exchange from being recorded as a wallet's parent.
    with pytest.raises(Exception, match="funder_is_infrastructure"):
        score.prove_link(FARMER, FUNDER, "first_funded_by", json.dumps({"funding_tx": tx(60), "subject_first_tx": tx(61)}))


def test_funder_threshold_is_inclusive_of_small_operators(score, direct_vm):
    proof = funding_proof(direct_vm, 10, FRESH, BAD)  # funder nonce 5
    node_tx = tx(1000 + 20)
    from tests.conftest import node

    node(direct_vm).txs["base-sepolia"][node_tx]["nonce"] = hex(1000)  # exactly at the limit: still an owner
    assert "first funds" in score.prove_link(FRESH, BAD, "first_funded_by", proof)


def test_links_can_be_proven_on_base_mainnet(score, direct_vm):
    mock_tx(direct_vm, tx(70), BAD, FRESH, block=20_000_000, network="base")
    mock_tx(direct_vm, tx(71), FRESH, CLIENT1, nonce=0, block=20_000_001, network="base")
    proof = json.dumps({"network": "base", "funding_tx": tx(70), "subject_first_tx": tx(71)})
    assert score.prove_link(FRESH, BAD, "first_funded_by", proof) == "other wallet sent the subject its first funds (base)"


def test_a_proof_only_counts_on_its_own_network(score, direct_vm):
    # Mined on Base Sepolia, claimed as mainnet: the mainnet node has never seen it.
    mock_tx(direct_vm, tx(72), BAD, FRESH, block=100)
    mock_tx(direct_vm, tx(73), FRESH, CLIENT1, nonce=0, block=101)
    with pytest.raises(Exception, match="link_tx_not_found"):
        score.prove_link(FRESH, BAD, "first_funded_by", json.dumps({"network": "base", "funding_tx": tx(72), "subject_first_tx": tx(73)}))
    with pytest.raises(Exception, match="unknown_network"):
        score.prove_link(FRESH, BAD, "first_funded_by", json.dumps({"network": "solana", "funding_tx": tx(72), "subject_first_tx": tx(73)}))


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
    assert (result["grade"], result["approval_limit_usd"], result["flags"]) == ("C", 0, ["NO_HISTORY"])


def test_genuine_wins_earn_an_a(score, direct_vm):
    for n, client in enumerate([CLIENT1, CLIENT2, CLIENT3, CLIENT4], start=1):
        judge(score, direct_vm, n, client, GOOD, winner=GOOD)
    result = score.get_score(GOOD)
    assert (result["grade"], result["points"], result["approval_limit_usd"]) == ("A", 82, 5000)


def test_fake_wins_against_own_wallets_are_discounted(score, direct_vm):
    for n, sock in enumerate([SOCK1, SOCK2, SOCK3], start=10):
        judge(score, direct_vm, n, sock, FARMER, winner=FARMER)
    assert score.get_score(FARMER)["grade"] == "B"  # looks strong before anyone proves the links

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
    assert result["counts"]["inherited_penalty"] == 40
    assert result["counts"]["inherited_cases"] == 2
    assert (result["grade"], result["approval_limit_usd"]) == ("F", 0)
    assert "INHERITED_LOSSES" in result["flags"]


def test_a_loss_is_not_double_counted_between_two_linked_parties(score, direct_vm):
    judge(score, direct_vm, 30, FARMER, SOCK1, winner=FARMER, non_delivery=True)  # SOCK1 loses to FARMER
    prove_parent(score, direct_vm, 31, SOCK1, FARMER)
    result = score.get_score(SOCK1)
    assert result["counts"]["loss_penalty"] == 20
    assert result["counts"]["inherited_penalty"] == 0


def test_score_is_deterministic_and_order_independent(score, direct_vm):
    judge(score, direct_vm, 40, CLIENT1, GOOD, winner=GOOD)
    judge(score, direct_vm, 41, CLIENT2, GOOD, winner=CLIENT2, non_delivery=True)  # GOOD loses a MATERIAL case
    first = score.get_score(GOOD)
    assert first == score.get_score(GOOD)
    assert (first["points"], first["grade"]) == (50 + 8 - 20, "D")


# --- Wins nobody contested ----------------------------------------------------------------


def test_uncontested_wins_earn_nothing_and_keep_escrow(score, direct_vm):
    # Three wins from settlements and defaults with wallets nobody has linked to GOOD: free to stage.
    judge(score, direct_vm, 50, CLIENT1, GOOD, winner=GOOD, resolution="settlement")
    judge(score, direct_vm, 51, CLIENT2, GOOD, winner=GOOD, resolution="default")
    judge(score, direct_vm, 52, CLIENT3, GOOD, winner=GOOD, resolution="settlement")
    result = score.get_score(GOOD)
    assert result["counts"]["wins"] == 0
    assert result["counts"]["uncontested_wins"] == 3
    assert result["counts"]["jury_cases"] == 0
    # Still treated as a wallet with no trustworthy history: a cautious C that needs escrow.
    assert (result["grade"], result["points"], result["approval_limit_usd"]) == ("C", 50, 0)
    assert result["flags"] == ["UNCONTESTED_WINS", "NO_HISTORY"]


def test_only_jury_wins_add_points(score, direct_vm):
    judge(score, direct_vm, 53, CLIENT1, GOOD, winner=GOOD)  # jury
    judge(score, direct_vm, 54, CLIENT2, GOOD, winner=GOOD, resolution="default")
    result = score.get_score(GOOD)
    assert (result["counts"]["wins"], result["counts"]["uncontested_wins"]) == (1, 1)
    assert (result["grade"], result["points"], result["approval_limit_usd"]) == ("C", 58, 100)


@pytest.mark.parametrize("resolution", ["default", "settlement"])
def test_losses_count_however_the_case_ended(score, direct_vm, resolution):
    judge(score, direct_vm, 55, CLIENT1, BAD, winner=CLIENT1, resolution=resolution, non_delivery=True)
    result = score.get_score(BAD)
    # Without a jury there are no findings: the loss counts, as minor (validators are not asked).
    assert result["counts"]["loss_penalty"] == 8
    assert "NO_HISTORY" not in result["flags"]
    assert (result["grade"], result["approval_limit_usd"]) == ("D", 0)


def test_a_default_win_against_a_linked_wallet_is_still_a_fake_win(score, direct_vm):
    # The staged case #19: FARMER wins by default against SOCK1, a wallet FARMER first funded.
    judge(score, direct_vm, 56, FARMER, SOCK1, winner=FARMER, resolution="default")
    prove_parent(score, direct_vm, 57, SOCK1, FARMER)
    result = score.get_score(FARMER)
    assert (result["counts"]["fake_wins"], result["counts"]["uncontested_wins"]) == (1, 0)
    assert (result["grade"], result["points"]) == ("D", 40)
    assert result["flags"] == ["FAKE_WINS"]


@pytest.mark.parametrize("method", ["eth_getTransactionByHash", "eth_getTransactionReceipt"])
def test_a_rate_limited_link_lookup_is_an_outage_not_a_missing_tx(score, direct_vm, method):
    proof = funding_proof(direct_vm, 60, SOCK1, FARMER)
    node(direct_vm).rate_limited_methods = {method}
    with pytest.raises(Exception, match=r"\[TRANSIENT\] rpc_call_error"):
        score.prove_link(SOCK1, FARMER, "first_funded_by", proof)
