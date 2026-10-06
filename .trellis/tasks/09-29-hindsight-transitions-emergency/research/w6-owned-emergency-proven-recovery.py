"""Recover only the reviewed W6 proven candidate after the retained lease refusal.

Default inert. Earlier supervisor reports/pins remain immutable. This is not a retry loop.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("w6_sealed_predecessor", HERE / "w6-owned-emergency-sealed-recovery.py")
previous = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(previous)
runner = previous.runner
THIRD_ID = "d9280ebf2293468b9457af574727f195"
THIRD_REPORT_SHA = "daeecc236b0b0272b0e10720edc14dcd3ca711596454016d4ed3d404bb8396e5"
CORE_SHA = "5d0071986151d6762cc400263b969c75fb7865a0b8f282921a585b23b24b82fe"
RECOVERY_OPERATION = "b661d113-93e3-4b2a-bfdd-ab61d21f1dca"
ATTEMPT = "dd48446c-0c6b-4ad2-b7a1-86e193d200ee"
CANDIDATE = "c10685da68d8d5f6e8861f2c322d14b7ef1e823053d0b0aaeace5fbafb336c10"
PROOF = "8e967eb5a17bc96ed60c18f084a5ae468cd6ca153a7321f16ad692c97ba06600"
TARGET_EPOCH = "c4f53993-517e-4d97-96cd-7e916620ce29"


def verify_history(root):
    history = root / "emergency-history"
    expected = {
        previous.prior.FAILED_ID: previous.prior.FAILED_REPORT_SHA,
        previous.SECOND_ID: previous.SECOND_REPORT_SHA,
        THIRD_ID: THIRD_REPORT_SHA,
    }
    assert sorted(p.name for p in history.iterdir()) == sorted(expected), "W6_PROVEN_HISTORY_CHANGED"
    for name, digest in expected.items():
        path = history / name / "supervisor-result.json"
        runner.no_link(path)
        assert runner.digest(path) == digest, "W6_PROVEN_PRIOR_REPORT_CHANGED"
        report = runner.read_json(path)
        assert report["completed"] is False and report["driverStopped"] is True
        assert report["driverExitCode"] == 1 and report["driverForcedStop"] is False
        assert report["preservedInputsVerified"] is True and report["sourcesPreserved"] is True
    result = runner.read_json(history / THIRD_ID / "emergency/driver-result.json")
    assert result["completed"] is False and result["operation"]["operationId"] == RECOVERY_OPERATION
    assert result["operation"]["state"] == "outcome_unknown"
    assert result["operation"]["result"]["transitionId"] == previous.TRANSITION
    assert result["operation"]["result"]["authorityCommitted"] is False
    assert result["operation"]["result"]["receiptId"] is None
    assert any(
        row["cause"] == "MEMORY_TRANSITION_LEASE_LOST" and row["phase"] == "proven" for row in result["diagnostics"]
    )
    assert result["counters"] == {
        "nativeCalls": 0,
        "transportCalls": 0,
        "modelCalls": 0,
        "nativeInFlight": 0,
        "modelInFlight": 0,
    }


def verify_database(root):
    db = sqlite3.connect((root / "core/taki.db").resolve().as_uri() + "?mode=ro&immutable=1", uri=True)
    tid = (previous.TRANSITION,)
    try:
        assert (
            previous.prior.table_hash(db, "memory_authority_selection")
            == previous.prior.UNCHANGED["memory_authority_selection"]
        )
        for table in (
            "memory_transition_receipts",
            "memory_transition_publications",
            "memory_transition_foreign_branches",
        ):
            assert db.execute(f"SELECT count(*) FROM {table} WHERE transition_id=?", tid).fetchone()[0] == 0
        for operation in (previous.OPERATION, RECOVERY_OPERATION):
            assert (
                db.execute("SELECT state FROM memory_operations WHERE operation_id=?", (operation,)).fetchone()[0]
                == "outcome_unknown"
            )
        capture = json.loads(
            db.execute(
                "SELECT capture_json FROM memory_transition_emergency_captures WHERE transition_id=?", tid
            ).fetchone()[0]
        )
        assert (capture["captureId"], capture["incidentId"], capture["operationId"]) == (
            previous.CAPTURE,
            previous.INCIDENT,
            previous.OPERATION,
        )
        attempt = json.loads(
            db.execute("SELECT attempt_json FROM memory_transition_attempts WHERE transition_id=?", tid).fetchone()[0]
        )
        assert (
            attempt["operationId"],
            attempt["attemptId"],
            attempt["generation"],
            attempt["revision"],
            attempt["phase"],
            attempt["lastEvidenceId"],
        ) == (RECOVERY_OPERATION, ATTEMPT, 2, 6, "proven", PROOF)
        assert datetime.fromisoformat(attempt["leaseUntil"].replace("Z", "+00:00")) < datetime.now(timezone.utc)
        assert db.execute("SELECT id FROM memory_transition_candidates WHERE transition_id=?", tid).fetchall() == [
            (CANDIDATE,)
        ]
        assert db.execute(
            "SELECT target_epoch_id FROM memory_transition_candidate_reservations WHERE transition_id=?", tid
        ).fetchall() == [(TARGET_EPOCH,)]
        row = db.execute(
            "SELECT manifest_hash,manifest_json FROM memory_transition_incidents WHERE transition_id=?", tid
        ).fetchone()
        assert row[0] == previous.MANIFEST_HASH
        manifest = json.loads(row[1])
        assert manifest["transition"]["capture"] == capture
        sealed = root / "core/backups" / f"incident-{previous.INCIDENT}"
        for name in ("core.sqlite", "manifest.json"):
            runner.no_link(sealed / name)
        assert runner.digest(sealed / "core.sqlite") == previous.SEALED_CORE_SHA == manifest["core"]["sha256"]
        assert runner.read_json(sealed / "manifest.json") == manifest
    finally:
        db.close()


def preflight():
    root = runner.ROOT
    runner.no_link(root)
    verify_history(root)
    owner = runner.read_json(root / "ownership.json")
    assert Path(owner["root"]) == root and owner["stopped"] is True and owner["emergencyCompleted"] is False
    assert Path(owner["emergencyRun"]) == root / "emergency-history" / THIRD_ID
    core = root / "core/taki.db"
    runner.no_link(core)
    assert runner.digest(core) == CORE_SHA, "W6_PROVEN_CORE_CHANGED"
    assert not any(Path(str(core) + suffix).exists() for suffix in ("-wal", "-shm", "-journal"))
    assert not (root / "core/w6-emergency-checkpoint.json").exists()
    assert not (root / "data/postmaster.pid").exists()
    runner.verify_preserved_inputs()
    verify_database(root)
    return {
        **owner,
        "previousEmergencyRun": str(root / "emergency-history" / THIRD_ID),
        "recoveryTransitionId": previous.TRANSITION,
        "recoveryIncidentId": previous.INCIDENT,
        "retryReason": "reviewed-original-proven-transition-recovery",
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-reviewed-proven-recovery", action="store_true")
    if not parser.parse_args(argv).run_reviewed_proven_recovery:
        print(json.dumps({"executed": False, "completed": False}))
        return 0
    runner.preflight = preflight
    runner.command = previous.command
    runner.DRIVER_SECONDS = 1800
    return runner.run()


if __name__ == "__main__":
    sys.exit(main())
