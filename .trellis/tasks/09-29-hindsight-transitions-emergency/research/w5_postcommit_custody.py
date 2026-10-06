"""Exact stopped-copy post-COMMIT admission, not a replacement Core proof verifier.

Read the old custody/history checks first, then positively join the pinned receipt,
publication, candidate, proof, baseline and selected epoch. Core's ordinary recovery
still performs its full independent integrity/readiness checks before any effect.
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
from pathlib import Path

from w5_actual_embedding_control import digest
from w5_working_custody import LOCAL_EPOCH, ROOT, SOURCE, TRANSITION, no_link, read_core

RECEIPT = "c6dc908527eaec7b70c57151a5c08cef0dcde986d787fc69da9f50d00c4ab450"
EPOCH = "9a27367e-afb5-4a0a-ae55-2fbb7b07e8b4"
CAP = 551
CORE_SHA = "6c55c27eae7c11bc824ca71b263611092520c66a8b231164d049a88ed00e98dd"


def required(db: sqlite3.Connection, sql: str, args: tuple = ()) -> sqlite3.Row:
    rows = db.execute(sql, args).fetchall()
    assert len(rows) == 1, "POSTCOMMIT_MISSING_OR_CONFLICTING_JOIN"
    return rows[0]


def document(db: sqlite3.Connection, table: str, identity: str, key: str) -> tuple[dict, str]:
    assert table in {"candidates", "baselines"}
    row = required(db, f"SELECT * FROM memory_transition_{table} WHERE id=?", (identity,))
    assert row["transition_id"] == TRANSITION and row["slot"] == "final"
    assert isinstance(row["body"], bytes), "POSTCOMMIT_DOCUMENT_BYTES"
    value = json.loads(row["body"])
    assert value[key] == identity and value["transitionId"] == TRANSITION
    return value, hashlib.sha256(row["body"]).hexdigest()


def audit_publication(db: sqlite3.Connection, state: dict, *, finished: bool) -> dict:
    """Only stopped-copy joins; never synthesize receipts or native outcomes."""
    row = required(db, "SELECT * FROM memory_transition_receipts WHERE transition_id=?", (TRANSITION,))
    receipt = json.loads(row["receipt_json"])
    assert row["receipt_id"] == receipt["receiptId"] == RECEIPT, "POSTCOMMIT_RECEIPT_MISMATCH"
    assert receipt["transitionId"] == TRANSITION and receipt["newEpochId"] == EPOCH
    assert receipt["kind"] == "transition.reenter-hindsight"
    intent = json.loads(
        required(db, "SELECT intent_json FROM memory_transition_intents WHERE transition_id=?", (TRANSITION,))[0]
    )
    assert receipt["operationId"] == intent["operationId"] and receipt["requestId"] == intent["request"]["requestId"]
    identity = receipt["identity"]
    assert identity == intent["request"]["expected"]
    assert identity["predecessorEpochId"] == LOCAL_EPOCH
    assert identity["sourceProvider"] == "local" and identity["targetProvider"] == "hindsight"

    publication_row = required(db, "SELECT * FROM memory_transition_publications WHERE transition_id=?", (TRANSITION,))
    publication = json.loads(publication_row["publication_json"])
    assert publication_row["receipt_id"] == publication["receiptId"] == RECEIPT
    assert publication_row["publication_id"] == publication["publicationId"]
    assert publication_row["candidate_id"] == publication["candidateId"]
    assert publication["transitionId"] == TRANSITION and publication["proofId"] == receipt["proofId"]
    candidate, candidate_sha = document(db, "candidates", publication["candidateId"], "candidateId")
    baseline, baseline_sha = document(db, "baselines", publication["baselineId"], "baselineId")
    proof_row = required(db, "SELECT * FROM memory_transition_evidence WHERE evidence_id=?", (receipt["proofId"],))
    proof = json.loads(proof_row["proof_json"])
    assert proof_row["transition_id"] == proof["transitionId"] == TRANSITION
    assert proof["identity"] == identity and proof["mappingHash"] == receipt["mappingHash"]
    assert candidate["targetEpochId"] == baseline["targetEpochId"] == EPOCH
    assert candidate["predecessorEpochId"] == LOCAL_EPOCH
    assert baseline["candidateId"] == candidate["candidateId"]
    assert candidate["mappingHash"] == baseline["mappingHash"] == receipt["mappingHash"]
    assert candidate["stateHash"] == baseline["stateHash"] == proof["fencedManifestHash"]
    assert candidate["evidenceIds"] == baseline["evidenceIds"]
    assert receipt["custodyAssignmentHash"] == publication["custodyAssignmentHash"]

    scopes = candidate["scopes"]
    banks = {scope["nativeBankId"] for scope in scopes}
    assert len(scopes) == len(banks) == len(identity["banks"]) == 2
    assert banks == {bank["nativeBankId"] for bank in state["journey"]["returnAnchor"]["banks"]}
    assert len(candidate["evidenceIds"]) == len(set(candidate["evidenceIds"])) == 2
    evidence = db.execute(
        "SELECT id,slot,body FROM memory_transition_native_evidence WHERE transition_id=?", (TRANSITION,)
    ).fetchall()
    assert len(evidence) == 2 and {item["id"] for item in evidence} == set(candidate["evidenceIds"])
    evidence_sha = {}
    for item in evidence:
        value = json.loads(item["body"])
        status = value["status"]
        assert value["evidenceId"] == item["id"] and value["transitionId"] == TRANSITION
        assert status["bank_id"] == item["slot"] in banks and status["phase"] == "proven"
        assert status["request"]["transition_id"] == TRANSITION and status["proof"]
        scope = next(scope for scope in scopes if scope["nativeBankId"] == item["slot"])
        assert scope["evidenceId"] == item["id"]
        assert any(bank["native"]["proofHash"] == status["proof"]["proof_hash"] for bank in proof["banks"])
        evidence_sha[item["id"]] = hashlib.sha256(item["body"]).hexdigest()

    marker = required(db, "SELECT * FROM memory_authority_selection WHERE singleton=1")
    epoch = required(db, "SELECT * FROM canonical_memory_authority_epochs WHERE epoch_id=?", (EPOCH,))
    active = required(db, "SELECT active_epoch_id FROM canonical_memory_authority_state WHERE singleton=1")[0]
    assert marker["transition_receipt_id"] == RECEIPT and marker["active_epoch_id"] == active == EPOCH
    assert marker["mode"] == epoch["provider_id"] == "hindsight" and epoch["status"] == "active"
    assert marker["provider_lineage_id"] == epoch["provider_lineage_id"] == identity["targetLineageId"]
    assert epoch["predecessor_epoch_id"] == LOCAL_EPOCH and epoch["reason"] == "planned-switch"
    assert marker["replica_checkpoint_digest"] and marker["activation_transaction_id"] is None
    previous = required(db, "SELECT * FROM canonical_memory_authority_epochs WHERE epoch_id=?", (LOCAL_EPOCH,))
    assert previous["status"] == "closed" and previous["ended_at"] == receipt["committedAt"]

    attempt = json.loads(
        required(db, "SELECT attempt_json FROM memory_transition_attempts WHERE transition_id=?", (TRANSITION,))[0]
    )
    operation = required(
        db, "SELECT state,producer_json FROM memory_operations WHERE operation_id=?", (attempt["operationId"],)
    )
    assert attempt["transitionId"] == TRANSITION
    assert attempt["operationId"] == state["steps"]["reentry"]["operationId"]
    assert json.loads(operation["producer_json"])["transitionId"] == TRANSITION
    assert attempt["cutoffSequence"] == receipt["cutoffSequence"] == proof["cutoffSequence"]
    resolutions = db.execute(
        "SELECT resolution_json FROM memory_transition_resolutions WHERE transition_id=?", (TRANSITION,)
    ).fetchall()
    if finished:
        assert state.get("completed") is True and operation["state"] == "completed"
        assert attempt["phase"] == "terminal" and len(resolutions) == 1
        resolution = json.loads(resolutions[0][0])
        assert resolution["result"]["receiptId"] == RECEIPT and resolution["result"]["outcome"] == "completed"
    else:
        assert not state.get("completed") and operation["state"] == "outcome_unknown", "POSTCOMMIT_ALREADY_COMPLETED"
        assert attempt["phase"] in {"committed", "binding", "settling"} and not resolutions
    return {
        "receiptId": RECEIPT,
        "epochId": EPOCH,
        "publicationId": publication["publicationId"],
        "candidateId": candidate["candidateId"],
        "proofId": receipt["proofId"],
        "baselineId": baseline["baselineId"],
        "receiptBytesSha256": hashlib.sha256(row["receipt_json"].encode()).hexdigest(),
        "publicationBytesSha256": hashlib.sha256(publication_row["publication_json"].encode()).hexdigest(),
        "proofBytesSha256": hashlib.sha256(proof_row["proof_json"].encode()).hexdigest(),
        "candidateBytesSha256": candidate_sha,
        "baselineBytesSha256": baseline_sha,
        "nativeEvidenceBytesSha256": evidence_sha,
    }


def read_committed(root: Path = ROOT, *, after: bool = False) -> dict:
    assert root == ROOT, "POSTCOMMIT_WRONG_ROOT"
    no_link(root / "ownership.json")
    owner = json.loads((root / "ownership.json").read_text(encoding="utf-8"))
    assert Path(owner["root"]) == ROOT and Path(owner["source"]) == SOURCE and owner["stopped"] is True
    assert owner["pgPort"] == 18495 and owner["httpPort"] == 18496
    no_link(root / "application.sqlite")
    wal = root / "application.sqlite-wal"
    assert not wal.exists() or wal.stat().st_size == 0, "WORKING_CORE_WAL_UNSETTLED"
    if not after:
        # Parent supplied the stopped, checkpointed database identity. This exact
        # byte anchor avoids inventing a second implementation of Core hashing.
        assert digest(root / "application.sqlite") == CORE_SHA, "POSTCOMMIT_CORE_SNAPSHOT_CHANGED"
    # Keep every original history/source/mutation/WAL check. Only the previous
    # negative receipt assertion is replaced with the stronger exact join above.
    value = read_core(root, after=True)
    counter = json.loads((root / "model-submissions.json").read_text(encoding="utf-8"))["submitted"]
    assert type(counter) is int and counter == CAP, "POSTCOMMIT_COUNTER_CHANGED"
    db = sqlite3.connect((root / "application.sqlite").as_uri() + "?mode=ro&immutable=1", uri=True)
    db.row_factory = sqlite3.Row
    try:
        value["postCommit"] = audit_publication(db, value["state"], finished=after)
        return value
    finally:
        db.close()
