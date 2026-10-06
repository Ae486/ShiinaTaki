"""Synthetic proof-retaining recovery gates; real corpus is never accessed."""

import importlib.util
import json
import sqlite3
import sys
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
SPEC = importlib.util.spec_from_file_location("w6_proven", HERE / "w6-owned-emergency-proven-recovery.py")
recovery = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(recovery)


@pytest.fixture
def owned(tmp_path, monkeypatch):
    r = recovery.runner
    p = recovery.previous
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
    for name in (p.prior.FAILED_ID, p.SECOND_ID, recovery.THIRD_ID):
        h = tmp_path / "emergency-history" / name
        (h / "emergency").mkdir(parents=True)
        r.write_json(h / "supervisor-result.json", report)
    digest = r.digest(h / "supervisor-result.json")
    monkeypatch.setattr(p.prior, "FAILED_REPORT_SHA", digest)
    monkeypatch.setattr(p, "SECOND_REPORT_SHA", digest)
    monkeypatch.setattr(recovery, "THIRD_REPORT_SHA", digest)
    r.write_json(
        h / "emergency/driver-result.json",
        {
            "completed": False,
            "operation": {
                "operationId": recovery.RECOVERY_OPERATION,
                "state": "outcome_unknown",
                "result": {"transitionId": p.TRANSITION, "authorityCommitted": False, "receiptId": None},
            },
            "diagnostics": [{"cause": "MEMORY_TRANSITION_LEASE_LOST", "phase": "proven"}],
            "counters": {
                "nativeCalls": 0,
                "transportCalls": 0,
                "modelCalls": 0,
                "nativeInFlight": 0,
                "modelInFlight": 0,
            },
        },
    )
    r.write_json(
        tmp_path / "ownership.json",
        {
            "root": str(tmp_path),
            "stopped": True,
            "emergencyCompleted": False,
            "emergencyRun": str(h),
        },
    )
    (tmp_path / "data").mkdir()
    sealed = tmp_path / "core/backups" / f"incident-{p.INCIDENT}"
    sealed.mkdir(parents=True)
    (sealed / "core.sqlite").write_bytes(b"synthetic sealed Core")
    monkeypatch.setattr(p, "SEALED_CORE_SHA", r.digest(sealed / "core.sqlite"))
    capture = {"captureId": p.CAPTURE, "incidentId": p.INCIDENT, "operationId": p.OPERATION}
    manifest = {"transition": {"capture": capture}, "core": {"sha256": p.SEALED_CORE_SHA}}
    r.write_json(sealed / "manifest.json", manifest)
    db = sqlite3.connect(tmp_path / "core/taki.db")
    db.executescript("""
      CREATE TABLE memory_authority_selection(body TEXT);
      INSERT INTO memory_authority_selection VALUES('original authority');
      CREATE TABLE memory_transition_receipts(transition_id TEXT);
      CREATE TABLE memory_transition_publications(transition_id TEXT);
      CREATE TABLE memory_transition_foreign_branches(transition_id TEXT);
      CREATE TABLE memory_operations(operation_id TEXT,state TEXT);
      CREATE TABLE memory_transition_emergency_captures(transition_id TEXT,capture_json TEXT);
      CREATE TABLE memory_transition_attempts(transition_id TEXT,attempt_json TEXT);
      CREATE TABLE memory_transition_incidents(transition_id TEXT,manifest_hash TEXT,manifest_json TEXT);
      CREATE TABLE memory_transition_candidates(transition_id TEXT,id TEXT);
      CREATE TABLE memory_transition_candidate_reservations(transition_id TEXT,target_epoch_id TEXT);
    """)
    db.executemany(
        "INSERT INTO memory_operations VALUES(?,'outcome_unknown')", [(p.OPERATION,), (recovery.RECOVERY_OPERATION,)]
    )
    db.execute("INSERT INTO memory_transition_emergency_captures VALUES(?,?)", (p.TRANSITION, json.dumps(capture)))
    attempt = {
        "operationId": recovery.RECOVERY_OPERATION,
        "attemptId": recovery.ATTEMPT,
        "generation": 2,
        "revision": 6,
        "phase": "proven",
        "lastEvidenceId": recovery.PROOF,
        "leaseUntil": "1970-01-01T00:00:00Z",
    }
    db.execute("INSERT INTO memory_transition_attempts VALUES(?,?)", (p.TRANSITION, json.dumps(attempt)))
    db.execute(
        "INSERT INTO memory_transition_incidents VALUES(?,?,?)", (p.TRANSITION, p.MANIFEST_HASH, json.dumps(manifest))
    )
    db.execute("INSERT INTO memory_transition_candidates VALUES(?,?)", (p.TRANSITION, recovery.CANDIDATE))
    db.execute(
        "INSERT INTO memory_transition_candidate_reservations VALUES(?,?)", (p.TRANSITION, recovery.TARGET_EPOCH)
    )
    monkeypatch.setattr(
        p.prior, "UNCHANGED", {"memory_authority_selection": p.prior.table_hash(db, "memory_authority_selection")}
    )
    db.commit()
    db.close()
    monkeypatch.setattr(recovery, "CORE_SHA", r.digest(tmp_path / "core/taki.db"))
    return tmp_path


def test_default_inert(monkeypatch, capsys):
    monkeypatch.setattr(recovery.runner, "run", lambda: pytest.fail("unexpected mutation"))
    assert recovery.main([]) == 0
    assert json.loads(capsys.readouterr().out)["executed"] is False


def test_original_proven_identity_without_writes(owned):
    before = recovery.runner.digest(owned / "core/taki.db")
    result = recovery.preflight()
    assert result["recoveryTransitionId"] == recovery.previous.TRANSITION
    assert recovery.runner.digest(owned / "core/taki.db") == before
    assert not (owned / "core/taki.db-wal").exists()


@pytest.mark.parametrize("change", ["core", "seal", "history", "wal"])
def test_changed_artifact_refuses(owned, change):
    if change == "history":
        (owned / "emergency-history/unreviewed").mkdir()
    else:
        path = {
            "core": owned / "core/taki.db",
            "wal": owned / "core/taki.db-wal",
            "seal": owned / "core/backups" / f"incident-{recovery.previous.INCIDENT}" / "core.sqlite",
        }[change]
        with path.open("ab") as stream:
            stream.write(b"changed")
    with pytest.raises(AssertionError):
        recovery.preflight()


@pytest.mark.parametrize("change", ["receipt", "generation", "candidate", "authority"])
def test_semantic_change_refuses_even_with_changed_file_pin(owned, monkeypatch, change):
    p = recovery.previous
    core = owned / "core/taki.db"
    db = sqlite3.connect(core)
    if change == "receipt":
        db.execute("INSERT INTO memory_transition_receipts VALUES(?)", (p.TRANSITION,))
    elif change == "generation":
        value = json.loads(db.execute("SELECT attempt_json FROM memory_transition_attempts").fetchone()[0])
        value["generation"] += 1
        db.execute("UPDATE memory_transition_attempts SET attempt_json=?", (json.dumps(value),))
    elif change == "candidate":
        db.execute("UPDATE memory_transition_candidates SET id='different'")
    else:
        db.execute("UPDATE memory_authority_selection SET body='different'")
    db.commit()
    db.close()
    monkeypatch.setattr(recovery, "CORE_SHA", recovery.runner.digest(core))
    with pytest.raises(AssertionError):
        recovery.preflight()


def test_explicit_entry_uses_original_recovery_command(monkeypatch):
    r = recovery.runner
    monkeypatch.setattr(r, "preflight", None)
    monkeypatch.setattr(r, "command", None)
    monkeypatch.setattr(r, "DRIVER_SECONDS", 1)
    monkeypatch.setattr(r, "run", lambda: 7)
    assert recovery.main(["--run-reviewed-proven-recovery"]) == 7
    assert r.preflight is recovery.preflight
    args = r.command(Path("result.json"), "emergency")
    assert args[-2:] == ["--recovery-transition-id", recovery.previous.TRANSITION]
    assert "--recovery-transition-id" not in r.command(Path("restart.json"), "restart")
