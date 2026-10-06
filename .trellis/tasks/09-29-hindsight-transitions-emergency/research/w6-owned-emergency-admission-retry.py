"""Explicit successor for the verified unadmitted W6 failure; never a blind retry.

The first attempt and original runner remain unchanged. Only this exact stopped
Core, with no emergency admission/effect, may generate a fresh preview/submission.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import sqlite3
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("w6_unadmitted_runner", HERE / "w6-owned-emergency-runner.py")
runner = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(runner)
FAILED_ID = "ac140a8d81a24846b150cfc93f313e80"
FAILED_REPORT_SHA = "16630f6f0fa1e3b7cd6453586e4d7581985046be6684650d47116a6fd92a77ae"
STOPPED_CORE_SHA = "5c25bd398ba2af5743059d6cd048a2a0dfb1593a3b658a8d86ef943395d4995a"
UNCHANGED = {
    "memory_authority_selection": "0bfdc51351531d894bb0a070f0c03cbeba3bff1a331371e4e978e11cd0239591",
    "memory_transition_intents": "bb7fcec1ddd9ec17568ed1ea018e7ef607f5e72bb679839b4dce9ec7c269b13c",
    "memory_transition_receipts": "116c2d7d4e6a4b5ba1e1b5f2f4d1f6c2e30ec5bcb7131008f1320519998dfc0a",
    "memory_operations": "bf82d026e0627558c8217601f8b37c1b37df41bcf6ed4926c1cf8dfa94bb787c",
}
EMPTY = (
    "memory_transition_emergency_captures",
    "memory_transition_incidents",
    "memory_transition_surviving_evidence",
    "memory_transition_foreign_branches",
    "memory_transition_emergency_quarantine",
    "memory_transition_emergency_manual_quarantine",
)


def table_hash(db, name):
    rows = db.execute(f"SELECT * FROM {name} ORDER BY rowid").fetchall()
    return hashlib.sha256(json.dumps(rows, separators=(",", ":")).encode()).hexdigest()


def preflight():
    root = runner.ROOT
    runner.no_link(root)
    history = root / "emergency-history"
    assert sorted(p.name for p in history.iterdir()) == [FAILED_ID], "W6_RETRY_HISTORY_CHANGED"
    prior = history / FAILED_ID
    report_path = prior / "supervisor-result.json"
    assert runner.digest(report_path) == FAILED_REPORT_SHA, "W6_RETRY_PRIOR_REPORT_CHANGED"
    report = runner.read_json(report_path)
    assert report["completed"] is False and report["driverStopped"] is True
    assert report["driverExitCode"] == 1 and report["driverForcedStop"] is False
    assert report["preservedInputsVerified"] is True and report["sourcesPreserved"] is True
    result = runner.read_json(prior / "emergency/driver-result.json")
    assert result["completed"] is False and result["error"] == {"code": "MEMORY_TRANSITION_STALE"}
    assert result["counters"] == {
        "nativeCalls": 0,
        "transportCalls": 0,
        "modelCalls": 0,
        "nativeInFlight": 0,
        "modelInFlight": 0,
    }
    core = root / "core/taki.db"
    runner.no_link(core)
    assert runner.digest(core) == STOPPED_CORE_SHA, "W6_RETRY_CORE_CHANGED"
    assert not any(Path(str(core) + suffix).exists() for suffix in ("-wal", "-shm", "-journal"))
    assert not (root / "core/w6-emergency-checkpoint.json").exists()
    assert not (root / "data/postmaster.pid").exists()
    owner = runner.read_json(root / "ownership.json")
    assert Path(owner["root"]) == root and owner["stopped"] is True
    assert owner["emergencyCompleted"] is False and Path(owner["emergencyRun"]) == prior
    runner.verify_preserved_inputs()
    # The exact source hashes prove this is before admission, not an unknown
    # COMMIT to be replayed. Both copies are stopped immutable SQLite inputs.
    for path in (root / "application.sqlite", core):
        db = sqlite3.connect(path.resolve().as_uri() + "?mode=ro&immutable=1", uri=True)
        try:
            for name, expected in UNCHANGED.items():
                assert table_hash(db, name) == expected, "W6_RETRY_ADMISSION_STATE_CHANGED"
            if path == core:
                for name in EMPTY:
                    assert db.execute(f"SELECT count(*) FROM {name}").fetchone()[0] == 0
        finally:
            db.close()
    return {
        **owner,
        "previousEmergencyRun": str(prior),
        "retryReason": "reviewed-unadmitted-preview-expiry",
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-reviewed-unadmitted-copy", action="store_true")
    if not parser.parse_args(argv).run_reviewed_unadmitted_copy:
        print(json.dumps({"executed": False, "completed": False}))
        return 0
    runner.preflight = preflight
    # Actual first-attempt composition/preview/admission took almost nine minutes.
    # Permit finite full work without weakening any production deadline or guard.
    runner.DRIVER_SECONDS = 1800
    return runner.run()


if __name__ == "__main__":
    sys.exit(main())
