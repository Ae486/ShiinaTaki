"""Synthetic supervisor boundaries; never open the prepared real corpus."""

import importlib.util
import json
import sys
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
SPEC = importlib.util.spec_from_file_location(
    "w6_owned_runner", HERE / "w6-owned-emergency-runner.py"
)
runner = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(runner)
SOURCE_INVENTORY = runner.source_inventory


@pytest.fixture
def owned(tmp_path, monkeypatch):
    root, predecessor = tmp_path / "owned", tmp_path / "preserved"
    for directory in (root, predecessor):
        (directory / "data").mkdir(parents=True)
        (directory / "data/PG_VERSION").write_text("18", encoding="utf-8")
        (directory / "application.sqlite").write_bytes(b"synthetic Core bytes")
    (root / "core").mkdir()
    (root / "core/taki.db").write_bytes(b"synthetic Core bytes")
    driver = tmp_path / "driver.py"
    driver.write_text("# inert synthetic child\n", encoding="utf-8")
    monkeypatch.setattr(runner, "ROOT", root)
    monkeypatch.setattr(runner, "PREDECESSOR", predecessor)
    monkeypatch.setattr(runner, "REPO", tmp_path)
    monkeypatch.setattr(runner, "NODE", Path(sys.executable))
    monkeypatch.setattr(runner, "DRIVER", driver)
    monkeypatch.setattr(runner, "CORE_SHA", runner.digest(root / "core/taki.db"))
    monkeypatch.setattr(runner, "stopped", lambda: None)
    runner.write_json(root / "source-files.json", runner.input_inventory(predecessor))
    monkeypatch.setattr(
        runner, "INPUT_MANIFEST_SHA", runner.digest(root / "source-files.json")
    )
    runner.write_json(
        root / "ownership.json",
        {
            "kind": "w6-private-pair",
            "root": str(root),
            "source": str(predecessor),
            "sourceCoreSha256": runner.CORE_SHA,
            "prepared": True,
            "started": False,
            "stopped": True,
            "manifestSha256": runner.INPUT_MANIFEST_SHA,
        },
    )
    runner.write_json(
        root / "core-layout.json",
        {
            "coreDataDir": str(root / "core"),
            "coreDbPath": str(root / "core/taki.db"),
            "nativePgData": str(root / "data"),
            "preservedCoreInput": str(root / "application.sqlite"),
        },
    )
    monkeypatch.setattr(
        runner,
        "source_inventory",
        lambda: [{"path": "driver.py", "sha256": runner.digest(driver)}],
    )
    return root, predecessor, driver


def report(root):
    paths = list((root / "emergency-history").glob("*/supervisor-result.json"))
    assert len(paths) == 1
    return runner.read_json(paths[0])


def test_default_is_inert(monkeypatch, tmp_path, capsys):
    monkeypatch.setattr(runner, "ROOT", tmp_path / "absent")
    monkeypatch.setattr(runner, "run", lambda: pytest.fail("default must not execute"))
    assert runner.main([]) == 0
    assert json.loads(capsys.readouterr().out)["executed"] is False
    assert not (tmp_path / "absent").exists()


@pytest.mark.parametrize("change", ["original", "prepared", "wal", "layout"])
def test_preflight_refuses_drift_before_child(owned, monkeypatch, change):
    root, predecessor, _ = owned
    if change == "original":
        (predecessor / "data/PG_VERSION").write_text("foreign", encoding="utf-8")
    elif change == "prepared":
        (root / "data/extra").write_bytes(b"unexpected")
    elif change == "wal":
        (root / "core/taki.db-wal").write_bytes(b"uncheckpointed")
    else:
        layout = runner.read_json(root / "core-layout.json")
        layout["coreDataDir"] = str(root / "data")
        runner.write_json(root / "core-layout.json", layout)
    monkeypatch.setattr(
        runner, "execute_driver", lambda *_: pytest.fail("child must not start")
    )
    with pytest.raises(AssertionError):
        runner.run()
    assert runner.read_json(root / "ownership.json")["started"] is False
    assert not (root / "emergency-supervisor.lock").exists()


def child_code(*, complete=True, exit_code=0, drift=False):
    return "\n".join(
        [
            "import hashlib, json, os, pathlib, sys",
            "result = pathlib.Path(sys.argv[sys.argv.index('--result-path') + 1])",
            "db = pathlib.Path(sys.argv[sys.argv.index('--core-db-path') + 1])",
            "phase = sys.argv[sys.argv.index('--phase') + 1]",
            "checkpoint = db.parent / 'w6-emergency-checkpoint.json'",
            "if phase == 'restart':",
            "    prior = json.loads(checkpoint.read_text(encoding='utf-8'))",
            "    assert prior['sha256'] == hashlib.sha256(db.read_bytes()).hexdigest()",
            "    assert prior['pid'] != os.getpid()",
            "db.write_bytes(b'changed synthetic Core')",
            "if phase == 'emergency':",
            "    point = {'pid': os.getpid(), "
            "'sha256': hashlib.sha256(db.read_bytes()).hexdigest()}",
            "    checkpoint.write_text(json.dumps(point), encoding='utf-8')",
            f"result.write_text(json.dumps({{'completed': {complete!r}}}), "
            "encoding='utf-8')",
            "pathlib.Path(__file__).write_text('# changed', encoding='utf-8')"
            if drift
            else "",
            f"raise SystemExit({exit_code})",
        ]
    )


def test_success_retains_result_and_never_runs_twice(owned):
    root, predecessor, driver = owned
    driver.write_text(child_code(), encoding="utf-8")
    assert runner.run() == 0
    result = report(root)
    assert result["completed"] is True and result["driverStopped"] is True
    assert result["driverExitCode"] == 0 and result["driverForcedStop"] is False
    assert [phase["phase"] for phase in result["phases"]] == ["emergency", "restart"]
    assert all(
        phase["completed"] and phase["driverStopped"] for phase in result["phases"]
    )
    assert (
        result["phases"][0]["coreAfterSha256"]
        == result["phases"][1]["coreBeforeSha256"]
    )
    assert (
        result["preservedInputsVerified"] is True and result["sourcesPreserved"] is True
    )
    assert runner.read_json(root / "ownership.json")["stopped"] is True
    assert (predecessor / "application.sqlite").read_bytes() == b"synthetic Core bytes"
    with pytest.raises(AssertionError):
        runner.run()
    assert report(root) == result


@pytest.mark.parametrize(
    "complete,exit_code,drift",
    [(False, 3, False), (False, 0, False), ("true", 0, False), (True, 0, True)],
)
def test_failure_and_source_drift_are_preserved(owned, complete, exit_code, drift):
    root, _, driver = owned
    driver.write_text(
        child_code(complete=complete, exit_code=exit_code, drift=drift),
        encoding="utf-8",
    )
    with pytest.raises(AssertionError):
        runner.run()
    result = report(root)
    assert result["completed"] is False and result["driverStopped"] is True
    assert result["driverExitCode"] == exit_code
    assert len(result["phases"]) == 1, "failed emergency must never launch restart"
    assert not (root / "emergency-supervisor.lock").exists()
    assert (root / "core/taki.db").read_bytes() == b"changed synthetic Core"
    assert runner.read_json(root / "ownership.json")["emergencyCompleted"] is False


def test_timeout_stops_only_owned_child_and_keeps_failure(owned, monkeypatch):
    root, _, driver = owned
    driver.write_text("import time\ntime.sleep(60)\n", encoding="utf-8")
    monkeypatch.setattr(runner, "DRIVER_SECONDS", 0.2)
    with pytest.raises(runner.subprocess.TimeoutExpired):
        runner.run()
    result = report(root)
    assert result["completed"] is False and result["driverForcedStop"] is True
    assert result["driverStopped"] is True
    assert runner.read_json(root / "ownership.json")["stopped"] is True


def test_restart_failure_preserves_completed_emergency(owned):
    root, _, driver = owned
    driver.write_text(
        child_code().replace(
            "raise SystemExit(0)",
            "raise SystemExit(9 if phase == 'restart' else 0)",
        ),
        encoding="utf-8",
    )
    with pytest.raises(AssertionError, match="W6_DRIVER_FAILED"):
        runner.run()
    result = report(root)
    assert result["completed"] is False and result["driverExitCode"] == 9
    assert result["driverStopped"] is True and len(result["phases"]) == 2
    assert result["phases"][0]["completed"] is True
    assert result["phases"][1]["completed"] is False


def test_existing_lock_is_never_removed_or_claimed(owned, monkeypatch):
    root, _, _ = owned
    lock = root / "emergency-supervisor.lock"
    lock.write_text("earlier owner", encoding="utf-8")
    monkeypatch.setattr(
        runner, "preflight", lambda: pytest.fail("lock must refuse first")
    )
    with pytest.raises(FileExistsError):
        runner.run()
    assert lock.read_text(encoding="utf-8") == "earlier owner"


def test_source_inventory_tracks_code_but_not_progress_notes(owned, monkeypatch):
    _, _, driver = owned
    monkeypatch.setattr(runner, "HERE", driver.parent)
    notes = driver.parent / "notes.md"
    notes.write_text("before", encoding="utf-8")
    monkeypatch.setattr(
        runner.subprocess,
        "check_output",
        lambda *_args, **_kwargs: b"driver.py\0notes.md\0",
    )
    before = SOURCE_INVENTORY()
    assert len(before) == 1 and before[0]["path"] == "driver.py"
    notes.write_text("running", encoding="utf-8")
    assert SOURCE_INVENTORY() == before
    driver.write_text("# changed source", encoding="utf-8")
    assert SOURCE_INVENTORY() != before
