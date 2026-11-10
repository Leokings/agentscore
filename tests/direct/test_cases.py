"""Judging Internet Court cases: evidence checks, the narrow semantic judgment and its consensus rule."""

import pytest

from tests.conftest import RATE_LIMITED, addr, agreement, enc_string, judge_one, mock_case, mock_judgment, trade_fx

A, B = addr(0xA1), addr(0xB2)
CASE = addr(0xC001)
STATEMENT = "The freelancer delivered the API integration on time and meeting all specifications"
REASONING = "Freelancer delivered all 47 endpoints on time. Bug reports filed after deadline."


def outcomes(record):
    return [(p["role"], p["outcome"], p["severity"]) for p in record["parties"]]


def test_true_verdict_means_party_a_prevailed(score, direct_vm):
    judge_one(score, direct_vm, CASE, 15, agreement(A, B, STATEMENT, REASONING, verdict=1))
    record = score.get_case(CASE)
    assert (record["case_id"], record["case_type"]) == (15, "Agreement")
    assert outcomes(record) == [("partyA", "FAVORABLE", "NONE"), ("partyB", "UNFAVORABLE", "MINOR")]
    assert [p["address"] for p in record["parties"]] == [A, B]
    assert score.get_score(A)["counts"]["wins"] == 1
    assert score.get_score(B)["counts"]["loss_penalty"] == 8
    assert score.get_stats() == {"judged_cases": 1}


def test_false_verdict_means_party_b_prevailed(score, direct_vm):
    judge_one(score, direct_vm, CASE, 15, agreement(A, B, STATEMENT, "Half the endpoints were never delivered.", verdict=2), non_delivery=True)
    assert outcomes(score.get_case(CASE)) == [("partyA", "UNFAVORABLE", "MATERIAL"), ("partyB", "FAVORABLE", "NONE")]


def test_deception_is_severe(score, direct_vm):
    judge_one(score, direct_vm, CASE, 15, agreement(A, B, STATEMENT, "The delivery screenshots were fabricated.", verdict=2), deception=True, non_delivery=True)
    assert outcomes(score.get_case(CASE))[0] == ("partyA", "UNFAVORABLE", "SEVERE")


def test_the_llm_cannot_override_the_chain_verdict(score, direct_vm):
    # Even if the model names the other party as the winner, the on-chain verdict decides.
    judge_one(score, direct_vm, CASE, 15, agreement(A, B, STATEMENT, REASONING, verdict=1), prevailing="partyB")
    assert outcomes(score.get_case(CASE))[0] == ("partyA", "FAVORABLE", "NONE")


def test_validator_requires_every_finding_to_match(score, direct_vm):
    judge_one(score, direct_vm, CASE, 15, agreement(A, B, STATEMENT, REASONING, verdict=2), non_delivery=True)
    honest = {"prevailing": "partyB", "deception": False, "non_delivery": True}
    assert direct_vm.run_validator() is True
    assert direct_vm.run_validator(leader_result=honest) is True
    # Same winner, forged severity finding: rejected.
    assert direct_vm.run_validator(leader_result={**honest, "non_delivery": False}) is False
    assert direct_vm.run_validator(leader_result={**honest, "deception": True}) is False
    # A leader claiming the other party prevailed: rejected.
    assert direct_vm.run_validator(leader_result={**honest, "prevailing": "partyA"}) is False
    # Extra invented field: rejected.
    assert direct_vm.run_validator(leader_result={**honest, "bonus": 1}) is False


def test_tolerates_answer_formatting_but_not_unknown_values(score, direct_vm):
    # Case and boolean variations are normalised so different models can agree...
    judge_one(score, direct_vm, CASE, 0, trade_fx(A, B, "Shipment left customs on time.", "Customs exit was after the deadline."), raw={"Prevailing_Role": "IMPORTER", "Deception": False, "NON_DELIVERY": "no"})
    assert outcomes(score.get_case(CASE)) == [("exporter", "UNFAVORABLE", "MINOR"), ("importer", "FAVORABLE", "NONE")]


def test_registered_case_with_an_unknown_winner_is_unclear(score, direct_vm):
    judge_one(score, direct_vm, CASE, 0, trade_fx(A, B, "Shipment left customs on time.", "Unclear."), raw={"prevailing_role": "the buyer", "deception": "maybe"})
    record = score.get_case(CASE)
    assert record["case_type"] == "TradeFxSettlement"
    assert outcomes(record) == [("exporter", "UNCLEAR", "NONE"), ("importer", "UNCLEAR", "NONE")]
    assert "UNCLEAR_RULINGS" in score.get_score(A)["flags"]


def test_registered_case_where_neither_prevailed_is_neutral(score, direct_vm):
    judge_one(score, direct_vm, CASE, 0, trade_fx(A, B, "Shipment left customs on time.", "Both parties share the delay."), prevailing="NONE")
    assert outcomes(score.get_case(CASE)) == [("exporter", "NEUTRAL", "NONE"), ("importer", "NEUTRAL", "NONE")]


def test_a_judged_case_is_final(score, direct_vm):
    judge_one(score, direct_vm, CASE, 15, agreement(A, B, STATEMENT, REASONING))
    with pytest.raises(Exception, match="case_already_judged"):
        score.judge_cases([CASE])


def test_rejects_a_contract_not_registered_with_internet_court(score, direct_vm):
    mock_case(direct_vm, 0, agreement(A, B, STATEMENT, REASONING), slot0=addr(0xDEAD))
    mock_judgment(direct_vm)
    with pytest.raises(Exception, match="case_not_registered"):
        score.judge_cases([CASE])
    with pytest.raises(Exception, match="case_not_judged"):
        score.get_case(CASE)


def test_case_zero_is_accepted_only_when_it_round_trips(score, direct_vm):
    # agreementIds() returns 0 both for case 0 and for unknown contracts, so 0 must match agreements(0).
    mock_case(direct_vm, 0, agreement(A, B, STATEMENT, REASONING))
    with pytest.raises(Exception, match="case_not_registered"):
        score.judge_cases([CASE])
    judge_one(score, direct_vm, CASE, 0, agreement(A, B, STATEMENT, REASONING))
    assert score.get_case(CASE)["case_id"] == 0


@pytest.mark.parametrize("status,verdict", [(1, 0), (2, 0), (3, 0), (4, 0), (5, 1)])
def test_rejects_cases_without_a_final_ruling(score, direct_vm, status, verdict):
    mock_case(direct_vm, 15, agreement(A, B, STATEMENT, REASONING, verdict=verdict, status=status))
    with pytest.raises(Exception, match="case_not_ruled"):
        score.judge_cases([CASE])


def test_rejects_unknown_case_contracts(score, direct_vm):
    mock_case(direct_vm, 15, {})
    with pytest.raises(Exception, match="unsupported_case_type"):
        score.judge_cases([CASE])


def test_case_evidence_needs_exact_agreement(score, direct_vm):
    judge_one(score, direct_vm, CASE, 15, agreement(A, B, STATEMENT, REASONING, verdict=1))
    evidence_block = 0  # captured blocks for this call: [0] chain evidence, [1] judgment
    assert direct_vm.run_validator(index=evidence_block) is True
    honest = dict(direct_vm._captured_validators[evidence_block][0])
    # A leader that flips the on-chain winner, or swaps a party address, is rejected.
    assert direct_vm.run_validator(index=evidence_block, leader_result={**honest, "prevailing_role": "partyB"}) is False
    assert direct_vm.run_validator(index=evidence_block, leader_result={**honest, "parties": [{"role": "partyA", "address": addr(0xEE)}, honest["parties"][1]]}) is False


def test_evidence_failures_agree_only_on_the_same_error(score, direct_vm):
    judge_one(score, direct_vm, CASE, 15, agreement(A, B, STATEMENT, REASONING, verdict=1))
    # The validator now sees an unruled case: it agrees with a leader reporting that exact error...
    direct_vm.clear_mocks()
    mock_case(direct_vm, 15, agreement(A, B, STATEMENT, REASONING, verdict=0, status=1))
    assert direct_vm.run_validator(index=0, leader_error=Exception("[EXPECTED] case_not_ruled")) is True
    # ...but not with a different deterministic error, and not with a leader that claimed success.
    assert direct_vm.run_validator(index=0, leader_error=Exception("[EXPECTED] case_not_registered")) is False
    assert direct_vm.run_validator(index=0) is False
    # Both sides hitting an outage agree, so the transaction fails instead of storing anything.
    direct_vm.clear_mocks()
    mock_case(direct_vm, 15, agreement(A, B, STATEMENT, REASONING), status=503)
    assert direct_vm.run_validator(index=0, leader_error=Exception("[TRANSIENT] rpc_status_503")) is True


def test_rejects_oversized_evidence(score, direct_vm):
    mock_case(direct_vm, 15, agreement(A, B, "x" * 3000, "y" * 1500))
    with pytest.raises(Exception, match="case_evidence_too_large"):
        score.judge_cases([CASE])


def test_rejects_empty_evidence(score, direct_vm):
    mock_case(direct_vm, 15, agreement(A, B, "", "   "))
    with pytest.raises(Exception, match="case_evidence_empty"):
        score.judge_cases([CASE])


def test_rejects_invalid_utf8(score, direct_vm):
    getters = agreement(A, B, STATEMENT, REASONING)
    getters["reasoning"] = enc_string(b"\xff\xfe broken")
    mock_case(direct_vm, 15, getters)
    with pytest.raises(Exception, match="evidence_invalid_utf8"):
        score.judge_cases([CASE])


@pytest.mark.parametrize("status,code", [(503, "TRANSIENT"), (429, "TRANSIENT"), (403, "EXTERNAL")])
def test_rpc_failures_fail_closed(score, direct_vm, status, code):
    mock_case(direct_vm, 15, agreement(A, B, STATEMENT, REASONING), status=status)
    with pytest.raises(Exception, match=code):
        score.judge_cases([CASE])
    assert score.get_stats() == {"judged_cases": 0}


def test_rejects_identical_parties(score, direct_vm):
    mock_case(direct_vm, 15, agreement(A, A, STATEMENT, REASONING))
    with pytest.raises(Exception, match="invalid_case_parties"):
        score.judge_cases([CASE])


@pytest.mark.parametrize("cases,code", [([], "case_count_out_of_bounds"), ([addr(i + 1) for i in range(6)], "case_count_out_of_bounds"), ([CASE, CASE], "duplicate_case"), (["0x123"], "invalid_address")])
def test_input_bounds(score, cases, code):
    with pytest.raises(Exception, match=code):
        score.judge_cases(cases)


def test_accepts_calldata_address_values(score, direct_vm):
    # The GenLayer CLI sends 0x-strings as Address values rather than str.
    from genlayer.py.types import Address

    judge_one(score, direct_vm, Address(CASE), 15, agreement(A, B, STATEMENT, REASONING))
    assert score.get_case(Address(CASE))["case_id"] == 15
    assert score.get_score(Address(A))["counts"]["wins"] == 1


def test_anyone_can_trigger_judgment(score, direct_vm, direct_bob):
    direct_vm.sender = direct_bob
    judge_one(score, direct_vm, CASE, 15, agreement(A, B, STATEMENT, REASONING))
    assert score.get_stats() == {"judged_cases": 1}


# --- How the case was decided (jury, default judgment, settlement) ------------------------


@pytest.mark.parametrize(
    "resolution, prompt_says",
    [
        ("jury", r".*The AI jury ruled Party A's statement TRUE.*"),
        ("default", r".*No jury: decided by default judgment.*"),
        ("settlement", r".*No jury: the parties settled.*"),
    ],
)
def test_records_how_the_case_was_decided_and_tells_validators(score, direct_vm, resolution, prompt_says):
    direct_vm.clear_mocks()
    mock_case(direct_vm, 15, agreement(A, B, STATEMENT, REASONING, verdict=1, resolution=resolution))
    # The judgment mock only matches a prompt that describes the path honestly.
    mock_judgment(direct_vm, pattern=r"(?s).*finalized ruling from Internet Court" + prompt_says)
    score.judge_cases([CASE])
    record = score.get_case(CASE)
    assert record["resolution"] == resolution
    assert outcomes(record) == [("partyA", "FAVORABLE", "NONE"), ("partyB", "UNFAVORABLE", "MINOR")]


def test_registered_cases_count_as_jury_rulings(score, direct_vm):
    judge_one(score, direct_vm, CASE, 0, trade_fx(A, B, "Goods shipped as agreed", "Exporter shipped on time."), prevailing="exporter")
    assert score.get_case(CASE)["resolution"] == "jury"


@pytest.mark.parametrize("field, value", [("evidenceASubmitted", None), ("evidenceBSubmitted", "0x" + "0" * 63 + "2"), ("disputeTimestamp", None)])
def test_unreadable_resolution_fields_fail_closed(score, direct_vm, field, value):
    getters = {**agreement(A, B, STATEMENT, REASONING, verdict=1), field: value}
    mock_case(direct_vm, 15, getters)
    mock_judgment(direct_vm)
    with pytest.raises(Exception, match="case_fields_unreadable"):
        score.judge_cases([CASE])


def test_a_leader_cannot_upgrade_a_default_into_a_jury_ruling(score, direct_vm):
    judge_one(score, direct_vm, CASE, 15, agreement(A, B, STATEMENT, REASONING, verdict=1, resolution="default"))
    honest = dict(direct_vm._captured_validators[0][0])
    assert honest["resolution"] == "default"
    assert direct_vm.run_validator(index=0) is True
    forged = {**honest, "resolution": "jury", "verdict": "The AI jury ruled Party A's statement TRUE."}
    assert direct_vm.run_validator(index=0, leader_result=forged) is False


@pytest.mark.parametrize("field", ["partyA", "statement", "evidenceASubmitted"])
def test_a_rate_limited_call_is_an_outage_not_a_missing_field(score, direct_vm, field):
    # Read as "missing", a refused partyA would turn an Agreement into "unsupported_case_type",
    # a permanent error. It must be a transient failure that the keeper retries.
    mock_case(direct_vm, 15, {**agreement(A, B, STATEMENT, REASONING, verdict=1), field: RATE_LIMITED})
    mock_judgment(direct_vm)
    with pytest.raises(Exception, match=r"\[TRANSIENT\] rpc_call_error"):
        score.judge_cases([CASE])
