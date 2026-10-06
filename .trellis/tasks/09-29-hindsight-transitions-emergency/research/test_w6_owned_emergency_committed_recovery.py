"""Synthetic same-receipt continuation gates; never opens the actual corpus."""

import importlib.util
import json
import sqlite3
import sys
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
SPEC = importlib.util.spec_from_file_location("w6_committed", HERE / "w6-owned-emergency-committed-recovery.py")
recovery = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(recovery)


@pytest.fixture
def owned(tmp_path, monkeypatch):
    r, p, s = recovery.runner, recovery.previous, recovery.sealed
    monkeypatch.setattr(r, "ROOT", tmp_path)
    monkeypatch.setattr(r, "verify_preserved_inputs", lambda: [])
    report = {
        "completed": False,
        "driverStopped": True,
        "driverForcedStop": False,
        "driverExitCode": 1,
        "preservedInputsVerified": True,
        "sourcesPreserved": True,
    }
    for name in (s.prior.FAILED_ID, s.SECOND_ID, p.THIRD_ID, recovery.FOURTH_ID):
        h = tmp_path / "emergency-history" / name
        (h / "emergency").mkdir(parents=True)
        r.write_json(h / "supervisor-result.json", report)
    digest = r.digest(h / "supervisor-result.json")
    for obj, key in [
        (s.prior, "FAILED_REPORT_SHA"),
        (s, "SECOND_REPORT_SHA"),
        (p, "THIRD_REPORT_SHA"),
        (recovery, "FOURTH_REPORT_SHA"),
    ]:
        monkeypatch.setattr(obj, key, digest)
    r.write_json(
        recovery.evidence_path(tmp_path),
        {
            "completed": False,
            "operation": {
                "operationId": recovery.OPERATION,
                "state": "outcome_unknown",
                "result": {
                    "transitionId": s.TRANSITION,
                    "authorityCommitted": True,
                    "receiptId": recovery.RECEIPT,
                    "runtime": "ready",
                },
            },
            "installation": {"candidateId": p.CANDIDATE, "checkedBeforeLocalStartup": True},
            "diagnostics": [{"cause": "MEMORY_TRANSITION_LEASE_LOST", "phase": "binding"}],
            "counters": {
                "nativeCalls": 0,
                "transportCalls": 0,
                "modelCalls": 0,
                "nativeInFlight": 0,
                "modelInFlight": 0,
            },
        },
    )
    monkeypatch.setattr(recovery, "FOURTH_DRIVER_SHA", r.digest(recovery.evidence_path(tmp_path)))
    r.write_json(
        tmp_path / "ownership.json",
        {"root": str(tmp_path), "stopped": True, "emergencyCompleted": False, "emergencyRun": str(h)},
    )
    (tmp_path / "data").mkdir()
    incident = tmp_path / "core/backups" / f"incident-{s.INCIDENT}"
    incident.mkdir(parents=True)
    (incident / "core.sqlite").write_bytes(b"synthetic immutable seal")
    monkeypatch.setattr(s, "SEALED_CORE_SHA", r.digest(incident / "core.sqlite"))
    capture = {"captureId": s.CAPTURE, "incidentId": s.INCIDENT, "operationId": s.OPERATION}
    manifest = {"transition": {"capture": capture}, "core": {"sha256": s.SEALED_CORE_SHA}}
    r.write_json(incident / "manifest.json", manifest)
    attempt = {
        "operationId": recovery.OPERATION,
        "attemptId": recovery.ATTEMPT,
        "generation": 3,
        "revision": 10,
        "phase": "binding",
        "lastEvidenceId": recovery.PROOF,
        "leaseUntil": "1970-01-01T00:00:00Z",
    }
    receipt = {"newEpochId": p.TARGET_EPOCH, "proofId": recovery.PROOF}
    publication = {
        "receiptId": recovery.RECEIPT,
        "candidateId": p.CANDIDATE,
        "captureId": s.CAPTURE,
        "incidentId": s.INCIDENT,
    }
    tables = {
        "memory_authority_selection": (
            ["singleton", "mode", "active_epoch_id", "transition_receipt_id"],
            [(1, "canonical-local", p.TARGET_EPOCH, recovery.RECEIPT)],
        ),
        "canonical_memory_authority_state": (["singleton", "active_epoch_id"], [(1, p.TARGET_EPOCH)]),
        "memory_transition_receipts": (
            ["transition_id", "receipt_id", "receipt_json"],
            [(s.TRANSITION, recovery.RECEIPT, json.dumps(receipt))],
        ),
        "memory_transition_publications": (
            ["transition_id", "publication_json"],
            [(s.TRANSITION, json.dumps(publication))],
        ),
        "memory_transition_foreign_branches": (
            ["transition_id", "receipt_id", "target_epoch_id", "incident_id"],
            [(s.TRANSITION, recovery.RECEIPT, p.TARGET_EPOCH, s.INCIDENT)],
        ),
        "memory_operations": (
            ["operation_id", "state"],
            [(x, "outcome_unknown") for x in (s.OPERATION, p.RECOVERY_OPERATION, recovery.OPERATION)],
        ),
        "memory_transition_emergency_captures": (
            ["transition_id", "capture_json"],
            [(s.TRANSITION, json.dumps(capture))],
        ),
        "memory_transition_attempts": (["transition_id", "attempt_json"], [(s.TRANSITION, json.dumps(attempt))]),
        "memory_transition_candidates": (["transition_id", "id"], [(s.TRANSITION, p.CANDIDATE)]),
        "memory_transition_incidents": (
            ["transition_id", "manifest_hash", "manifest_json"],
            [(s.TRANSITION, s.MANIFEST_HASH, json.dumps(manifest))],
        ),
    }
    db = sqlite3.connect(tmp_path / "core/taki.db")
    for name, (columns, rows) in tables.items():
        db.execute(f"CREATE TABLE {name} ({','.join(columns)})")
        db.executemany(f"INSERT INTO {name} VALUES({','.join('?' for _ in columns)})", rows)
    db.commit()
    db.close()
    monkeypatch.setattr(recovery, "CORE_SHA", r.digest(tmp_path / "core/taki.db"))
    return tmp_path


def test_inert(monkeypatch, capsys):
    monkeypatch.setattr(recovery.runner, "run", lambda: pytest.fail("unexpected execution"))
    assert recovery.main([]) == 0
    assert json.loads(capsys.readouterr().out)["executed"] is False


def test_exact_committed_preflight_is_readonly(owned):
    before = recovery.runner.digest(owned / "core/taki.db")
    assert recovery.preflight()["recoveryReceiptId"] == recovery.RECEIPT
    assert recovery.runner.digest(owned / "core/taki.db") == before
    assert not (owned / "core/taki.db-wal").exists()


def test_recovery_evidence_is_only_supplied_to_first_phase(owned):
    args = recovery.command(owned / "result.json", "emergency")
    assert args[-4:] == [
        "--recovery-transition-id",
        recovery.sealed.TRANSITION,
        "--recovery-evidence-path",
        str(recovery.evidence_path(owned)),
    ]
    assert "--recovery-evidence-path" not in recovery.command(owned / "restart.json", "restart")


@pytest.mark.parametrize("change", ["history", "wal", "seal", "installation"])
def test_changed_artifact_refuses(owned, change):
    if change == "history":
        (owned / "emergency-history/unreviewed").mkdir()
    else:
        path = {
            "wal": owned / "core/taki.db-wal",
            "installation": recovery.evidence_path(owned),
            "seal": owned / "core/backups" / f"incident-{recovery.sealed.INCIDENT}" / "core.sqlite",
        }[change]
        with path.open("ab") as stream:
            stream.write(b"changed")
    with pytest.raises(AssertionError):
        recovery.preflight()


@pytest.mark.parametrize("change", ["receipt", "target", "lease", "unknown"])
def test_changed_commit_semantics_refuse_even_if_file_pin_changes(owned, monkeypatch, change):
    core = owned / "core/taki.db"
    db = sqlite3.connect(core)
    if change == "receipt":
        db.execute("UPDATE memory_transition_receipts SET receipt_id='different'")
    elif change == "target":
        db.execute("UPDATE canonical_memory_authority_state SET active_epoch_id='different'")
    elif change == "unknown":
        db.execute("UPDATE memory_operations SET state='completed'")
    else:
        value = json.loads(db.execute("SELECT attempt_json FROM memory_transition_attempts").fetchone()[0])
        value["leaseUntil"] = "2099-01-01T00:00:00Z"
        db.execute("UPDATE memory_transition_attempts SET attempt_json=?", (json.dumps(value),))
    db.commit()
    db.close()
    monkeypatch.setattr(recovery, "CORE_SHA", recovery.runner.digest(core))
    with pytest.raises(AssertionError):
        recovery.preflight()
