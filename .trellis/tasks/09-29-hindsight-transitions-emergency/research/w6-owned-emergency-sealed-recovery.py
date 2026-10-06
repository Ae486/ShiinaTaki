"""Recover exactly the admitted W6 transition and valid original sealed incident.

No default action, new emergency, evidence rewrite, or automatic failed-run retry.
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
SPEC = importlib.util.spec_from_file_location("w6_prior_admission", HERE / "w6-owned-emergency-admission-retry.py")
prior = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(prior)
runner = prior.runner
SECOND_ID = "abe6344ee4bb433dbef99fa25047bbf9"
SECOND_REPORT_SHA = "927ab615a1598c0289006c29d31ff79fe69bd45803fb79969a19466846691f94"
CORE_SHA = "41fb3b3d289575f7cd8e276b8c9fea696a8a89581b4c3aac5b31d21688afec76"
SEALED_CORE_SHA = "cc6dc6567eb3dc88512134f6444945c8c8bdf779a8352f0cd6bf599897569e6b"
MANIFEST_HASH = "1bc41735f139a0db7ca9de5fba95758cbadc913d4bfdc5200af59f5688e7d2e1"
TRANSITION = "0faf660d-9d8c-4215-ae5f-954f9f574734"
OPERATION = "0505474f-3dc3-4b04-8a03-409e8634d239"
CAPTURE = "c0067448-2ea5-4548-aea3-97841eff2216"
INCIDENT = "05f6c765-b099-4894-a191-32c83969a481"
ORIGINAL_COMMAND = runner.command


def command(result_path, phase):
    args = ORIGINAL_COMMAND(result_path, phase)
    return [*args, "--recovery-transition-id", TRANSITION] if phase == "emergency" else args


def preflight():
    root = runner.ROOT
    runner.no_link(root)
    history = root / "emergency-history"
    expected = {prior.FAILED_ID: prior.FAILED_REPORT_SHA, SECOND_ID: SECOND_REPORT_SHA}
    assert sorted(p.name for p in history.iterdir()) == sorted(expected), "W6_RECOVERY_HISTORY_CHANGED"
    for name, digest in expected.items():
        path = history / name / "supervisor-result.json"
        runner.no_link(path)
        assert runner.digest(path) == digest, "W6_RECOVERY_PRIOR_REPORT_CHANGED"
        report = runner.read_json(path)
        assert report["completed"] is False and report["driverStopped"] is True
        assert report["driverExitCode"] == 1 and report["driverForcedStop"] is False
        assert report["preservedInputsVerified"] is True and report["sourcesPreserved"] is True
    result = runner.read_json(history / SECOND_ID / "emergency/driver-result.json")
    assert result["completed"] is False and result["operation"]["operationId"] == OPERATION
    assert result["operation"]["state"] == "outcome_unknown"
    assert result["operation"]["result"]["transitionId"] == TRANSITION
    assert result["operation"]["result"]["authorityCommitted"] is False
    assert result["counters"] == {
        "nativeCalls": 0,
        "transportCalls": 0,
        "modelCalls": 0,
        "nativeInFlight": 0,
        "modelInFlight": 0,
    }
    owner = runner.read_json(root / "ownership.json")
    assert Path(owner["root"]) == root and owner["stopped"] is True
    assert owner["emergencyCompleted"] is False and Path(owner["emergencyRun"]) == history / SECOND_ID
    core = root / "core/taki.db"
    runner.no_link(core)
    assert runner.digest(core) == CORE_SHA, "W6_RECOVERY_CORE_CHANGED"
    assert not any(Path(str(core) + suffix).exists() for suffix in ("-wal", "-shm", "-journal"))
    assert not (root / "core/w6-emergency-checkpoint.json").exists()
    assert not (root / "data/postmaster.pid").exists()
    runner.verify_preserved_inputs()
    db = sqlite3.connect(core.resolve().as_uri() + "?mode=ro&immutable=1", uri=True)
    try:
        assert prior.table_hash(db, "memory_authority_selection") == prior.UNCHANGED["memory_authority_selection"]
        assert (
            db.execute(
                "SELECT count(*) FROM memory_transition_receipts WHERE transition_id=?", (TRANSITION,)
            ).fetchone()[0]
            == 0
        )
        assert (
            db.execute("SELECT state FROM memory_operations WHERE operation_id=?", (OPERATION,)).fetchone()[0]
            == "outcome_unknown"
        )
        capture = json.loads(
            db.execute(
                "SELECT capture_json FROM memory_transition_emergency_captures WHERE transition_id=?", (TRANSITION,)
            ).fetchone()[0]
        )
        assert (
            capture["captureId"] == CAPTURE
            and capture["incidentId"] == INCIDENT
            and capture["operationId"] == OPERATION
        )
        attempt = json.loads(
            db.execute(
                "SELECT attempt_json FROM memory_transition_attempts WHERE transition_id=?", (TRANSITION,)
            ).fetchone()[0]
        )
        assert attempt["phase"] == "fenced" and attempt["generation"] == 1 and attempt["lastEvidenceId"] is None
        assert datetime.fromisoformat(attempt["leaseUntil"].replace("Z", "+00:00")) < datetime.now(timezone.utc)
        row = db.execute(
            "SELECT manifest_hash,manifest_json FROM memory_transition_incidents WHERE transition_id=?", (TRANSITION,)
        ).fetchone()
        assert row[0] == MANIFEST_HASH
        manifest = json.loads(row[1])
        assert manifest["incidentId"] == INCIDENT and manifest["transition"]["capture"] == capture
        sealed = root / "core/backups" / f"incident-{INCIDENT}"
        for name in ("core.sqlite", "manifest.json"):
            runner.no_link(sealed / name)
        assert runner.digest(sealed / "core.sqlite") == SEALED_CORE_SHA == manifest["core"]["sha256"]
        assert runner.read_json(sealed / "manifest.json") == manifest, "W6_RECOVERY_SEAL_CHANGED"
    finally:
        db.close()
    return {
        **owner,
        "previousEmergencyRun": str(history / SECOND_ID),
        "recoveryTransitionId": TRANSITION,
        "recoveryIncidentId": INCIDENT,
        "retryReason": "reviewed-original-sealed-transition-recovery",
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-reviewed-sealed-recovery", action="store_true")
    if not parser.parse_args(argv).run_reviewed_sealed_recovery:
        print(json.dumps({"executed": False, "completed": False}))
        return 0
    runner.preflight = preflight
    runner.command = command
    runner.DRIVER_SECONDS = 1800
    return runner.run()


if __name__ == "__main__":
    sys.exit(main())
