"""Synthetic exact-state retry gates; no actual corpus read or service startup."""

import importlib.util
import json
import sqlite3
import sys
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
SPEC = importlib.util.spec_from_file_location("w6_retry", HERE / "w6-owned-emergency-admission-retry.py")
retry = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(retry)


@pytest.fixture
def owned(tmp_path, monkeypatch):
    r = retry.runner
    monkeypatch.setattr(r, "ROOT", tmp_path)
    monkeypatch.setattr(r, "verify_preserved_inputs", lambda: [])
    (tmp_path / "core").mkdir()
    (tmp_path / "data").mkdir()
    history = tmp_path / "emergency-history" / retry.FAILED_ID
    (history / "emergency").mkdir(parents=True)
    r.write_json(
        history / "supervisor-result.json",
        {
            "completed": False,
            "driverStopped": True,
            "driverExitCode": 1,
            "driverForcedStop": False,
            "preservedInputsVerified": True,
            "sourcesPreserved": True,
        },
    )
    monkeypatch.setattr(retry, "FAILED_REPORT_SHA", r.digest(history / "supervisor-result.json"))
    r.write_json(
        history / "emergency/driver-result.json",
        {
            "completed": False,
            "error": {"code": "MEMORY_TRANSITION_STALE"},
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
            "emergencyRun": str(history),
        },
    )
    hashes = {}
    for path in (tmp_path / "application.sqlite", tmp_path / "core/taki.db"):
        db = sqlite3.connect(path)
        for table in retry.UNCHANGED:
            db.execute(f"CREATE TABLE {table}(body TEXT)")
            db.execute(f"INSERT INTO {table} VALUES('original')")
            hashes[table] = retry.table_hash(db, table)
        for table in retry.EMPTY:
            db.execute(f"CREATE TABLE {table}(body TEXT)")
        db.commit()
        db.close()
    monkeypatch.setattr(retry, "UNCHANGED", hashes)
    monkeypatch.setattr(retry, "STOPPED_CORE_SHA", r.digest(tmp_path / "core/taki.db"))
    return tmp_path


def test_default_inert(monkeypatch, capsys):
    monkeypatch.setattr(retry.runner, "run", lambda: pytest.fail("unexpected execution"))
    assert retry.main([]) == 0
    assert json.loads(capsys.readouterr().out)["executed"] is False


def test_verified_unadmitted_copy_is_eligible(owned):
    before = retry.runner.digest(owned / "core/taki.db")
    result = retry.preflight()
    assert result["previousEmergencyRun"].endswith(retry.FAILED_ID)
    assert retry.runner.digest(owned / "core/taki.db") == before
    assert not (owned / "core/taki.db-wal").exists()


@pytest.mark.parametrize("change", ["core", "history", "wal", "checkpoint", "report"])
def test_changed_state_refuses(owned, change):
    if change == "core":
        with (owned / "core/taki.db").open("ab") as f:
            f.write(b"changed")
    elif change == "history":
        (owned / "emergency-history/second-attempt").mkdir()
    elif change == "wal":
        (owned / "core/taki.db-wal").write_bytes(b"unsettled")
    elif change == "checkpoint":
        (owned / "core/w6-emergency-checkpoint.json").write_text("{}")
    else:
        (owned / "emergency-history" / retry.FAILED_ID / "supervisor-result.json").write_text("{}")
    with pytest.raises(AssertionError):
        retry.preflight()


@pytest.mark.parametrize("table", ["memory_operations", "memory_transition_incidents"])
def test_new_admission_cannot_be_retried_even_with_new_file_pin(owned, monkeypatch, table):
    path = owned / "core/taki.db"
    db = sqlite3.connect(path)
    db.execute(f"INSERT INTO {table} VALUES('new admission')")
    db.commit()
    db.close()
    monkeypatch.setattr(retry, "STOPPED_CORE_SHA", retry.runner.digest(path))
    with pytest.raises(AssertionError):
        retry.preflight()
