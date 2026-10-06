"""Resume only the reviewed W6 committed receipt after the binding lease refusal."""

from __future__ import annotations

import argparse
import importlib.util
import json
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("w6_proven_predecessor", HERE / "w6-owned-emergency-proven-recovery.py")
previous = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(previous)
sealed = previous.previous
runner = previous.runner
FOURTH_ID = "baa914d916a34442a654f436f63b4298"
FOURTH_REPORT_SHA = "983e7809de94f6cc40c3ef7b55c4dc64441bb10e219092b1821909d5ce7b36a2"
FOURTH_DRIVER_SHA = "e2be16cc5bf96cd7b466b44f5d1e2c581e6675e5db94ad02a5698376959802ce"
CORE_SHA = "2efaa2332a7cee5c7fbed50c58d9f0e3f74d5f0c4049d5ba6b0e6d2210b54949"
OPERATION = "391a96ee-e370-4129-911c-2fc37a717f0b"
ATTEMPT = "867570ab-3677-42b6-9edb-4d808c3f74ef"
PROOF = "80a9f19628c196d2b336735e805d0950ea14f6b80c4914d497e250f73d9bca11"
RECEIPT = "5da1b2448bcc7ccaf0a41d5cbfa50fc9ea5e6f77e3610082300c7ea9477eed31"


def evidence_path(root):
    return root / "emergency-history" / FOURTH_ID / "emergency/driver-result.json"


def command(result_path, phase):
    args = sealed.command(result_path, phase)
    return [*args, "--recovery-evidence-path", str(evidence_path(runner.ROOT))] if phase == "emergency" else args


def verify_history(root):
    history = root / "emergency-history"
    expected = {
        sealed.prior.FAILED_ID: sealed.prior.FAILED_REPORT_SHA,
        sealed.SECOND_ID: sealed.SECOND_REPORT_SHA,
        previous.THIRD_ID: previous.THIRD_REPORT_SHA,
        FOURTH_ID: FOURTH_REPORT_SHA,
    }
    assert sorted(p.name for p in history.iterdir()) == sorted(expected), "W6_COMMITTED_HISTORY_CHANGED"
    for name, digest in expected.items():
        path = history / name / "supervisor-result.json"
        runner.no_link(path)
        assert runner.digest(path) == digest, "W6_COMMITTED_PRIOR_REPORT_CHANGED"
        report = runner.read_json(path)
        assert report["completed"] is False and report["driverStopped"] is True
        assert report["driverExitCode"] == 1 and report["driverForcedStop"] is False
        assert report["preservedInputsVerified"] is True and report["sourcesPreserved"] is True
    path = evidence_path(root)
    runner.no_link(path)
    assert runner.digest(path) == FOURTH_DRIVER_SHA, "W6_COMMITTED_INSTALLATION_REPORT_CHANGED"
    result = runner.read_json(path)
    operation = result["operation"]
    assert result["completed"] is False and operation["operationId"] == OPERATION
    assert operation["state"] == "outcome_unknown"
    assert operation["result"]["transitionId"] == sealed.TRANSITION
    assert operation["result"]["authorityCommitted"] is True
    assert operation["result"]["receiptId"] == RECEIPT and operation["result"]["runtime"] == "ready"
    assert result["installation"]["candidateId"] == previous.CANDIDATE
    assert result["installation"]["checkedBeforeLocalStartup"] is True
    assert any(
        row["cause"] == "MEMORY_TRANSITION_LEASE_LOST" and row["phase"] == "binding" for row in result["diagnostics"]
    )
    assert result["counters"] == {
        "nativeCalls": 0,
        "transportCalls": 0,
        "modelCalls": 0,
        "nativeInFlight": 0,
        "modelInFlight": 0,
    }


def verify_core(root):
    db = sqlite3.connect((root / "core/taki.db").resolve().as_uri() + "?mode=ro&immutable=1", uri=True)
    tid = (sealed.TRANSITION,)
    try:
        assert db.execute(
            "SELECT mode,active_epoch_id,transition_receipt_id FROM memory_authority_selection WHERE singleton=1"
        ).fetchone() == ("canonical-local", previous.TARGET_EPOCH, RECEIPT)
        assert db.execute(
            "SELECT active_epoch_id FROM canonical_memory_authority_state WHERE singleton=1"
        ).fetchone() == (previous.TARGET_EPOCH,)
        assert db.execute(
            "SELECT receipt_id FROM memory_transition_receipts WHERE transition_id=?", tid
        ).fetchall() == [(RECEIPT,)]
        receipt = json.loads(
            db.execute("SELECT receipt_json FROM memory_transition_receipts WHERE transition_id=?", tid).fetchone()[0]
        )
        assert receipt["newEpochId"] == previous.TARGET_EPOCH and receipt["proofId"] == PROOF
        publication = json.loads(
            db.execute(
                "SELECT publication_json FROM memory_transition_publications WHERE transition_id=?", tid
            ).fetchone()[0]
        )
        assert publication["receiptId"] == RECEIPT and publication["candidateId"] == previous.CANDIDATE
        assert publication["captureId"] == sealed.CAPTURE and publication["incidentId"] == sealed.INCIDENT
        assert db.execute(
            "SELECT receipt_id,target_epoch_id,incident_id FROM memory_transition_foreign_branches "
            "WHERE transition_id=?",
            tid,
        ).fetchall() == [(RECEIPT, previous.TARGET_EPOCH, sealed.INCIDENT)]
        for operation in (sealed.OPERATION, previous.RECOVERY_OPERATION, OPERATION):
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
            sealed.CAPTURE,
            sealed.INCIDENT,
            sealed.OPERATION,
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
        ) == (OPERATION, ATTEMPT, 3, 10, "binding", PROOF)
        assert datetime.fromisoformat(attempt["leaseUntil"].replace("Z", "+00:00")) < datetime.now(timezone.utc)
        assert db.execute("SELECT id FROM memory_transition_candidates WHERE transition_id=?", tid).fetchall() == [
            (previous.CANDIDATE,)
        ]
        row = db.execute(
            "SELECT manifest_hash,manifest_json FROM memory_transition_incidents WHERE transition_id=?", tid
        ).fetchone()
        assert row[0] == sealed.MANIFEST_HASH
        manifest = json.loads(row[1])
        assert manifest["transition"]["capture"] == capture
        incident = root / "core/backups" / f"incident-{sealed.INCIDENT}"
        for name in ("core.sqlite", "manifest.json"):
            runner.no_link(incident / name)
        assert runner.digest(incident / "core.sqlite") == sealed.SEALED_CORE_SHA == manifest["core"]["sha256"]
        assert runner.read_json(incident / "manifest.json") == manifest
    finally:
        db.close()


def preflight():
    root = runner.ROOT
    runner.no_link(root)
    verify_history(root)
    owner = runner.read_json(root / "ownership.json")
    assert Path(owner["root"]) == root and owner["stopped"] is True and owner["emergencyCompleted"] is False
    assert Path(owner["emergencyRun"]) == root / "emergency-history" / FOURTH_ID
    core = root / "core/taki.db"
    runner.no_link(core)
    assert runner.digest(core) == CORE_SHA, "W6_COMMITTED_CORE_CHANGED"
    assert not any(Path(str(core) + suffix).exists() for suffix in ("-wal", "-shm", "-journal"))
    assert not (root / "core/w6-emergency-checkpoint.json").exists()
    assert not (root / "data/postmaster.pid").exists()
    runner.verify_preserved_inputs()
    verify_core(root)
    return {
        **owner,
        "previousEmergencyRun": str(root / "emergency-history" / FOURTH_ID),
        "recoveryTransitionId": sealed.TRANSITION,
        "recoveryReceiptId": RECEIPT,
        "recoveryIncidentId": sealed.INCIDENT,
        "retryReason": "reviewed-same-committed-receipt-recovery",
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-reviewed-committed-recovery", action="store_true")
    if not parser.parse_args(argv).run_reviewed_committed_recovery:
        print(json.dumps({"executed": False, "completed": False}))
        return 0
    runner.preflight = preflight
    runner.command = command
    # The complete same-receipt corpus rehearsal took 29m20s before a clean exit.
    # Bound only this task process with useful headroom; production leases remain unchanged.
    runner.DRIVER_SECONDS = 3600
    return runner.run()


if __name__ == "__main__":
    sys.exit(main())
