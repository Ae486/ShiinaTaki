"""Focused synthetic post-COMMIT admission and zero-allowance wiring tests."""

from __future__ import annotations

import json
import sqlite3
from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
import w5_postcommit_custody as custody
from w5_actual_embedding_control import digest, load, write_json

subject = load("w5_postcommit_test_subject", "w5-working-postcommit-continuation.py")


def dump(value) -> str:
    return json.dumps(value)


@pytest.fixture
def committed():
    db = sqlite3.connect(":memory:")
    db.row_factory = sqlite3.Row
    tables = {
        "memory_transition_receipts": "transition_id,receipt_id,receipt_json",
        "memory_transition_intents": "transition_id,intent_json",
        "memory_transition_publications": "transition_id,receipt_id,publication_id,candidate_id,publication_json",
        "memory_transition_candidates": "id,transition_id,slot,body",
        "memory_transition_baselines": "id,transition_id,slot,body",
        "memory_transition_evidence": "evidence_id,transition_id,proof_json",
        "memory_transition_native_evidence": "id,transition_id,slot,body",
        "memory_authority_selection": (
            "singleton,transition_receipt_id,active_epoch_id,mode,provider_lineage_id,"
            "replica_checkpoint_digest,activation_transaction_id"
        ),
        "canonical_memory_authority_epochs": (
            "epoch_id,provider_id,status,provider_lineage_id,predecessor_epoch_id,reason,ended_at"
        ),
        "canonical_memory_authority_state": "singleton,active_epoch_id",
        "memory_transition_attempts": "transition_id,attempt_json",
        "memory_operations": "operation_id,state,producer_json",
        "memory_transition_resolutions": "transition_id,resolution_json",
    }
    for table, columns in tables.items():
        db.execute(f"CREATE TABLE {table} ({columns})")

    def insert(table, *values):
        db.execute(f"INSERT INTO {table} VALUES ({','.join('?' for _ in values)})", values)

    transition, receipt_id, epoch = custody.TRANSITION, custody.RECEIPT, custody.EPOCH
    banks = [{"nativeBankId": "bank-a"}, {"nativeBankId": "bank-b"}]
    identity = {
        "predecessorEpochId": custody.LOCAL_EPOCH,
        "sourceProvider": "local",
        "targetProvider": "hindsight",
        "targetLineageId": "lineage",
        "banks": banks,
    }
    receipt = {
        "receiptId": receipt_id,
        "transitionId": transition,
        "newEpochId": epoch,
        "kind": "transition.reenter-hindsight",
        "operationId": "original",
        "requestId": "request",
        "identity": identity,
        "proofId": "proof",
        "mappingHash": "mapping",
        "custodyAssignmentHash": "custody",
        "cutoffSequence": 0,
        "committedAt": "2026-10-05T19:45:39.875Z",
    }
    publication = {
        "receiptId": receipt_id,
        "publicationId": "publication",
        "candidateId": "candidate",
        "transitionId": transition,
        "proofId": "proof",
        "baselineId": "baseline",
        "custodyAssignmentHash": "custody",
    }
    candidate = {
        "candidateId": "candidate",
        "transitionId": transition,
        "predecessorEpochId": custody.LOCAL_EPOCH,
        "targetEpochId": epoch,
        "mappingHash": "mapping",
        "stateHash": "state",
        "evidenceIds": ["a", "b"],
        "scopes": [{"nativeBankId": "bank-a", "evidenceId": "a"}, {"nativeBankId": "bank-b", "evidenceId": "b"}],
    }
    baseline = {
        "baselineId": "baseline",
        "transitionId": transition,
        "candidateId": "candidate",
        "targetEpochId": epoch,
        "mappingHash": "mapping",
        "stateHash": "state",
        "evidenceIds": ["a", "b"],
    }
    proof = {
        "transitionId": transition,
        "identity": identity,
        "mappingHash": "mapping",
        "fencedManifestHash": "state",
        "cutoffSequence": 0,
        "banks": [{"native": {"proofHash": "proof-a"}}, {"native": {"proofHash": "proof-b"}}],
    }
    attempt = {"transitionId": transition, "operationId": "recovery", "phase": "committed", "cutoffSequence": 0}
    state = {
        "completed": False,
        "steps": {"reentry": {"operationId": "recovery"}},
        "journey": {"returnAnchor": {"banks": banks}},
    }
    insert("memory_transition_receipts", transition, receipt_id, dump(receipt))
    insert(
        "memory_transition_intents",
        transition,
        dump({"operationId": "original", "request": {"requestId": "request", "expected": identity}}),
    )
    insert("memory_transition_publications", transition, receipt_id, "publication", "candidate", dump(publication))
    insert("memory_transition_candidates", "candidate", transition, "final", dump(candidate).encode())
    insert("memory_transition_baselines", "baseline", transition, "final", dump(baseline).encode())
    insert("memory_transition_evidence", "proof", transition, dump(proof))
    for key in ("a", "b"):
        value = {
            "evidenceId": key,
            "transitionId": transition,
            "status": {
                "bank_id": "bank-" + key,
                "phase": "proven",
                "request": {"transition_id": transition},
                "proof": {"proof_hash": "proof-" + key},
            },
        }
        insert("memory_transition_native_evidence", key, transition, "bank-" + key, dump(value).encode())
    insert("memory_authority_selection", 1, receipt_id, epoch, "hindsight", "lineage", "checkpoint", None)
    insert(
        "canonical_memory_authority_epochs",
        epoch,
        "hindsight",
        "active",
        "lineage",
        custody.LOCAL_EPOCH,
        "planned-switch",
        None,
    )
    insert(
        "canonical_memory_authority_epochs",
        custody.LOCAL_EPOCH,
        "local",
        "closed",
        "old-lineage",
        None,
        "old",
        receipt["committedAt"],
    )
    insert("canonical_memory_authority_state", 1, epoch)
    insert("memory_transition_attempts", transition, dump(attempt))
    insert("memory_operations", "recovery", "outcome_unknown", dump({"transitionId": transition}))
    yield db, state, insert
    db.close()


def test_exact_committed_joins_and_unchanged_artifacts_after_completion(committed):
    db, state, insert = committed
    before = custody.audit_publication(db, state, finished=False)
    assert before["receiptId"] == custody.RECEIPT and len(before["nativeEvidenceBytesSha256"]) == 2
    state["completed"] = True
    db.execute("UPDATE memory_operations SET state='completed'")
    db.execute("UPDATE memory_transition_attempts SET attempt_json=json_set(attempt_json,'$.phase','terminal')")
    insert(
        "memory_transition_resolutions",
        custody.TRANSITION,
        dump({"result": {"receiptId": custody.RECEIPT, "outcome": "completed"}}),
    )
    assert custody.audit_publication(db, state, finished=True) == before
    with pytest.raises(AssertionError):
        custody.audit_publication(db, state, finished=False)


@pytest.mark.parametrize(
    "sql",
    [
        "DELETE FROM memory_transition_receipts",
        "UPDATE memory_transition_receipts SET receipt_id='foreign'",
        "UPDATE memory_transition_receipts SET receipt_json=json_set(receipt_json,'$.newEpochId','foreign')",
        "INSERT INTO memory_transition_receipts SELECT * FROM memory_transition_receipts",
        "DELETE FROM memory_transition_publications",
        "UPDATE memory_transition_publications SET candidate_id='foreign'",
        "UPDATE memory_transition_evidence SET proof_json=json_set(proof_json,'$.identity.targetLineageId','foreign')",
        "DELETE FROM memory_transition_candidates",
        "UPDATE memory_transition_baselines SET slot='foreign'",
        "DELETE FROM memory_transition_native_evidence WHERE id='b'",
        "UPDATE memory_authority_selection SET active_epoch_id='foreign'",
        "UPDATE memory_authority_selection SET transition_receipt_id='foreign'",
        "UPDATE canonical_memory_authority_state SET active_epoch_id='foreign'",
        "UPDATE canonical_memory_authority_epochs SET status='closed'",
        "UPDATE memory_operations SET state='completed'",
        "UPDATE memory_transition_attempts SET attempt_json=json_set(attempt_json,'$.phase','fenced')",
        "UPDATE memory_transition_attempts SET attempt_json=json_set(attempt_json,'$.operationId','foreign')",
    ],
)
def test_absent_foreign_conflicting_or_completed_state_refuses(committed, sql):
    db, state, _ = committed
    db.execute(sql)
    with pytest.raises(AssertionError):
        custody.audit_publication(db, state, finished=False)


@pytest.fixture
def stopped_copy(tmp_path, monkeypatch, committed):
    db, state, _ = committed
    monkeypatch.setattr(custody, "ROOT", tmp_path)
    owner = {"root": str(tmp_path), "source": str(custody.SOURCE), "stopped": True, "pgPort": 18495, "httpPort": 18496}
    write_json(tmp_path / "ownership.json", owner)
    write_json(tmp_path / "model-submissions.json", {"submitted": 551})
    db.commit()
    with sqlite3.connect(tmp_path / "application.sqlite") as target:
        db.backup(target)
    monkeypatch.setattr(custody, "CORE_SHA", digest(tmp_path / "application.sqlite"))
    old = Mock(return_value={"state": state, "bankA": "bank-a", "preparationSha256": "preparation"})
    monkeypatch.setattr(custody, "read_core", old)
    return tmp_path, old


def test_retains_old_after_checks_and_refuses_wal_root_ownership_counter(stopped_copy):
    root, old = stopped_copy
    custody.read_committed(root)
    old.assert_called_once_with(root, after=True)
    old.reset_mock()
    with pytest.raises(AssertionError, match="WRONG_ROOT"):
        custody.read_committed(root / "foreign")
    (root / "application.sqlite-wal").write_bytes(b"unsettled")
    with pytest.raises(AssertionError, match="WAL_UNSETTLED"):
        custody.read_committed(root)
    old.assert_not_called()
    (root / "application.sqlite-wal").write_bytes(b"")
    write_json(root / "model-submissions.json", {"submitted": 552})
    with pytest.raises(AssertionError, match="COUNTER_CHANGED"):
        custody.read_committed(root)
    (root / "ownership.json").unlink()
    with pytest.raises(FileNotFoundError):
        custody.read_committed(root)


def test_changed_checkpointed_core_refuses_before_history(stopped_copy):
    root, old = stopped_copy
    with (root / "application.sqlite").open("ab") as stream:
        stream.write(b"changed")
    with pytest.raises(AssertionError, match="CORE_SNAPSHOT_CHANGED"):
        custody.read_committed(root)
    old.assert_not_called()


def test_default_is_inert_and_cli_has_no_allowance_or_target_override(monkeypatch, capsys):
    run = Mock(return_value=0)
    monkeypatch.setattr(subject, "run", run)
    assert subject.main([]) == 0
    assert json.loads(capsys.readouterr().out)["executed"] is False
    run.assert_not_called()
    for extra in ("--root", "--submission-cap", "--maintenance-approval", "--stage", "--reentry-renewal"):
        with pytest.raises(SystemExit):
            subject.main(["--run-reviewed-working-copy", extra, "forbidden"])
    assert subject.main(["--run-reviewed-working-copy"]) == 0
    run.assert_called_once_with()


def test_zero_allowance_guard_wiring_and_callback_restoration(tmp_path, monkeypatch):
    monkeypatch.setattr(subject, "ROOT", tmp_path)
    monkeypatch.setattr(subject, "verify_sources", lambda: "seal")
    (tmp_path / subject.PROOF_NAME).write_text("synthetic", encoding="utf-8")
    evidence = {"receiptId": custody.RECEIPT}
    read = Mock(side_effect=lambda **kw: {"postCommit": deepcopy(evidence)})
    monkeypatch.setattr(subject, "read_committed", read)
    old_read = Mock()
    forwarded = []

    class Controller:
        root = tmp_path

        def install_guard(self, original, pg_port, listener, *, model_access):
            forwarded.append(model_access)
            return set()

    original_guard = Controller.install_guard
    entry = SimpleNamespace(ROOT=tmp_path, TRANSITION=custody.TRANSITION, read_core=old_read)

    def run(args):
        assert args.submission_cap == 551 and args.maintenance_approval == subject.APPROVAL
        approval = json.loads(args.maintenance_approval.read_text(encoding="utf-8"))
        assert approval["banks"] == [] and approval["transitionId"] == custody.TRANSITION
        entry.read_core()
        Controller().install_guard(object(), 18495, object(), model_access=True)
        entry.read_core(after=True)
        return 0

    network = SimpleNamespace(entry=entry, NetworkContinuation=Controller, run=run)
    monkeypatch.setattr(subject, "load", lambda *args: network)
    assert subject.run() == 0
    assert forwarded == [False] and read.call_args_list[0].kwargs == {"after": False}
    assert entry.read_core is old_read and Controller.install_guard is original_guard
    reports = list((tmp_path / "working-postcommit-history").glob("*/result.json"))
    assert len(reports) == 1
    result = json.loads(reports[0].read_text())
    assert result["completed"] and result["sealedSourcesPreserved"] and not result["modelAccess"]


def test_changed_empty_approval_refuses_before_loading_supervisor(tmp_path, monkeypatch):
    approval = tmp_path / "approval.json"
    write_json(approval, {"version": 1, "banks": [{"bankId": "a"}], "cumulativeCap": 552})
    monkeypatch.setattr(subject, "APPROVAL", approval)
    monkeypatch.setattr(subject, "verify_sources", lambda: "seal")
    start = Mock()
    monkeypatch.setattr(subject, "load", start)
    with pytest.raises(AssertionError, match="ALLOWANCE_REFUSED"):
        subject.run()
    start.assert_not_called()
