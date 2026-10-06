"""Synthetic original-seal recovery gates; never access the actual corpus."""

import importlib.util
import json
import sqlite3
import sys
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
SPEC = importlib.util.spec_from_file_location("w6_sealed_recovery", HERE / "w6-owned-emergency-sealed-recovery.py")
recovery = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(recovery)


@pytest.fixture
def owned(tmp_path, monkeypatch):
    r = recovery.runner
    monkeypatch.setattr(r, "ROOT", tmp_path)
    monkeypatch.setattr(r, "verify_preserved_inputs", lambda: [])
    report = {
        "completed": False,
        "driverStopped": True,
        "driverExitCode": 1,
        "driverForcedStop": False,
        "preservedInputsVerified": True,
        "sourcesPreserved": True,
    }
    for name in (recovery.prior.FAILED_ID, recovery.SECOND_ID):
        h = tmp_path / "emergency-history" / name
        (h / "emergency").mkdir(parents=True)
        r.write_json(h / "supervisor-result.json", report)
    monkeypatch.setattr(recovery.prior, "FAILED_REPORT_SHA", r.digest(h / "supervisor-result.json"))
    monkeypatch.setattr(recovery, "SECOND_REPORT_SHA", r.digest(h / "supervisor-result.json"))
    r.write_json(
        h / "emergency/driver-result.json",
        {
            "completed": False,
            "operation": {
                "operationId": recovery.OPERATION,
                "state": "outcome_unknown",
                "result": {"transitionId": recovery.TRANSITION, "authorityCommitted": False},
            },
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
        {"root": str(tmp_path), "stopped": True, "emergencyCompleted": False, "emergencyRun": str(h)},
    )
    (tmp_path / "data").mkdir()
    sealed = tmp_path / "core/backups" / f"incident-{recovery.INCIDENT}"
    sealed.mkdir(parents=True)
    (sealed / "core.sqlite").write_bytes(b"immutable synthetic sealed Core")
    monkeypatch.setattr(recovery, "SEALED_CORE_SHA", r.digest(sealed / "core.sqlite"))
    capture = {"captureId": recovery.CAPTURE, "incidentId": recovery.INCIDENT, "operationId": recovery.OPERATION}
    manifest = {
        "incidentId": recovery.INCIDENT,
        "transition": {"capture": capture},
        "core": {"sha256": recovery.SEALED_CORE_SHA},
    }
    r.write_json(sealed / "manifest.json", manifest)
    db = sqlite3.connect(tmp_path / "core/taki.db")
    db.executescript("""
      CREATE TABLE memory_authority_selection(body TEXT);
      INSERT INTO memory_authority_selection VALUES('original authority');
      CREATE TABLE memory_transition_receipts(transition_id TEXT);
      CREATE TABLE memory_operations(operation_id TEXT,state TEXT);
      CREATE TABLE memory_transition_emergency_captures(transition_id TEXT,capture_json TEXT);
      CREATE TABLE memory_transition_attempts(transition_id TEXT,attempt_json TEXT);
      CREATE TABLE memory_transition_incidents(transition_id TEXT,manifest_hash TEXT,manifest_json TEXT);
    """)
    db.execute("INSERT INTO memory_operations VALUES(?,?)", (recovery.OPERATION, "outcome_unknown"))
    db.execute(
        "INSERT INTO memory_transition_emergency_captures VALUES(?,?)", (recovery.TRANSITION, json.dumps(capture))
    )
    db.execute(
        "INSERT INTO memory_transition_attempts VALUES(?,?)",
        (
            recovery.TRANSITION,
            json.dumps(
                {"phase": "fenced", "generation": 1, "lastEvidenceId": None, "leaseUntil": "1970-01-01T00:00:00Z"}
            ),
        ),
    )
    db.execute(
        "INSERT INTO memory_transition_incidents VALUES(?,?,?)",
        (recovery.TRANSITION, recovery.MANIFEST_HASH, json.dumps(manifest)),
    )
    monkeypatch.setattr(
        recovery.prior,
        "UNCHANGED",
        {"memory_authority_selection": recovery.prior.table_hash(db, "memory_authority_selection")},
    )
    db.commit()
    db.close()
    monkeypatch.setattr(recovery, "CORE_SHA", r.digest(tmp_path / "core/taki.db"))
    return tmp_path


def test_default_inert(monkeypatch, capsys):
    monkeypatch.setattr(recovery.runner, "run", lambda: pytest.fail("unexpected run"))
    assert recovery.main([]) == 0
    assert json.loads(capsys.readouterr().out)["executed"] is False


def test_recovery_flag_only_for_first_phase(tmp_path):
    args = recovery.command(tmp_path / "result.json", "emergency")
    assert args[-2:] == ["--recovery-transition-id", recovery.TRANSITION]
    assert "--recovery-transition-id" not in recovery.command(tmp_path / "result.json", "restart")


def test_exact_original_seal_eligible_without_writes(owned):
    result = recovery.preflight()
    assert result["recoveryTransitionId"] == recovery.TRANSITION
    assert result["recoveryIncidentId"] == recovery.INCIDENT
    assert not (owned / "core/taki.db-wal").exists()


@pytest.mark.parametrize("change", ["core", "seal", "manifest", "history", "wal"])
def test_changed_evidence_refuses(owned, change):
    sealed = owned / "core/backups" / f"incident-{recovery.INCIDENT}"
    if change == "history":
        (owned / "emergency-history/another").mkdir()
    else:
        target = {
            "core": owned / "core/taki.db",
            "seal": sealed / "core.sqlite",
            "manifest": sealed / "manifest.json",
            "wal": owned / "core/taki.db-wal",
        }[change]
        with target.open("ab") as stream:
            stream.write(b"changed")
    with pytest.raises((AssertionError, json.JSONDecodeError)):
        recovery.preflight()


def test_new_commit_refuses_even_if_file_pin_is_replaced(owned, monkeypatch):
    core = owned / "core/taki.db"
    db = sqlite3.connect(core)
    db.execute("INSERT INTO memory_transition_receipts VALUES(?)", (recovery.TRANSITION,))
    db.commit()
    db.close()
    monkeypatch.setattr(recovery, "CORE_SHA", recovery.runner.digest(core))
    with pytest.raises(AssertionError):
        recovery.preflight()
