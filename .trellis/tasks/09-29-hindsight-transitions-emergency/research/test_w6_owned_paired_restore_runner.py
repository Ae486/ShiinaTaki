"""Synthetic parent supervision checks; never read or start the actual corpus."""

import importlib.util
import json
import os
import sys
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
SPEC = importlib.util.spec_from_file_location(
    "w6_paired_runner", HERE / "w6-owned-paired-restore-runner.py"
)
runner = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(runner)


def test_inert_default(monkeypatch, capsys):
    monkeypatch.setattr(runner, "run", lambda: pytest.fail("must remain inert"))
    assert runner.main([]) == 0
    assert json.loads(capsys.readouterr().out)["executed"] is False


@pytest.fixture
def phase_fixture(tmp_path, monkeypatch):
    calls = []

    def child(root, name, args, env):
        calls.append(name)
        if name == "core-stage":
            runner.write_json(
                root / "stage-result.json",
                {
                    "completed": True,
                    "stopped": True,
                    "backupId": "original-backup",
                    "nativeRequestPath": str(root / "original-native-request.json"),
                },
            )
        elif name == "native-restore":
            runner.write_json(
                root / "native-restore-result.json",
                {
                    "completed": True,
                    "sourceUnchanged": True,
                    "tableCount": 56,
                },
            )
        elif name == "core-seal":
            runner.write_json(
                root / "seal-result.json",
                {
                    "completed": True,
                    "stopped": True,
                    "pairDir": str(root / "sealed-pair"),
                },
            )
        elif name == "core-preflight":
            runner.write_json(root / "core-restore-preflight.json", {"completed": True})

    monkeypatch.setattr(runner, "child", child)
    monkeypatch.setattr(runner, "pg_start", lambda *args: calls.append("start"))
    monkeypatch.setattr(runner, "pg_stop", lambda *args: calls.append("stop"))
    return tmp_path, calls, child


def test_product_phase_order_and_original_request(phase_fixture):
    root, calls, _ = phase_fixture
    report = {}
    runner.phases(root, report, {})
    assert calls == [
        "core-stage",
        "start",
        "native-restore",
        "stop",
        "core-seal",
        "core-preflight",
    ]
    assert report["completed"] is True
    assert report["backupId"] == "original-backup"
    native = runner.read_json(root / "native-plan.json")
    assert native["nativeRequestPath"] == str(root / "original-native-request.json")
    seal = runner.read_json(root / "seal-plan.json")
    assert seal["initializeOwnedFixtureCustody"] is False


@pytest.mark.parametrize(
    "failure", ["core-stage", "native-restore", "core-seal", "core-preflight"]
)
def test_failed_phase_never_continues(phase_fixture, monkeypatch, failure):
    root, calls, original = phase_fixture

    def fail(root, name, args, env):
        if name == failure:
            calls.append(name)
            raise RuntimeError("owned failure")
        original(root, name, args, env)

    monkeypatch.setattr(runner, "child", fail)
    report = {}
    with pytest.raises(RuntimeError):
        runner.phases(root, report, {})
    assert report.get("completed") is not True
    if "start" in calls:
        assert calls.count("stop") == 1
    if failure == "native-restore":
        assert calls[-1] == "stop" and "core-seal" not in calls
        assert runner.read_json(root / "stage-result.json")["completed"] is True
    if failure == "core-stage":
        assert "start" not in calls


def test_partial_pg_start_still_stops(phase_fixture, monkeypatch):
    root, calls, _ = phase_fixture

    def failed_start(*args):
        calls.append("start")
        raise TimeoutError()

    monkeypatch.setattr(runner, "pg_start", failed_start)
    with pytest.raises(TimeoutError):
        runner.phases(root, {}, {})
    assert calls == ["core-stage", "start", "stop"]


def test_actual_owned_child_timeout_retains_evidence(tmp_path, monkeypatch):
    monkeypatch.setattr(runner, "REPO", tmp_path)
    monkeypatch.setattr(runner, "SECONDS", 0.2)
    with pytest.raises(runner.subprocess.TimeoutExpired):
        runner.child(
            tmp_path,
            "timeout",
            [sys.executable, "-c", "import time; time.sleep(20)"],
            dict(os.environ),
        )
    result = runner.read_json(tmp_path / "timeout.process.json")
    assert result["stopped"] is True and result["forcedStop"] is True
    assert (tmp_path / "timeout.stdout.log").exists()
    assert (tmp_path / "timeout.stderr.log").exists()


def test_actual_child_failure_is_not_success(tmp_path, monkeypatch):
    monkeypatch.setattr(runner, "REPO", tmp_path)
    with pytest.raises(AssertionError):
        runner.child(
            tmp_path,
            "fail",
            [sys.executable, "-c", "raise SystemExit(3)"],
            dict(os.environ),
        )
    result = runner.read_json(tmp_path / "fail.process.json")
    assert result["exitCode"] == 3 and result["stopped"] is True


@pytest.mark.parametrize("bad", ["completion", "dispatch"])
def test_preflight_refuses_before_corpus_read(tmp_path, monkeypatch, bad):
    monkeypatch.setattr(runner.emergency, "ROOT", tmp_path)
    monkeypatch.setattr(
        runner.emergency,
        "verify_preserved_inputs",
        lambda: pytest.fail("no corpus read"),
    )
    history = tmp_path / "emergency-history/owned"
    history.mkdir(parents=True)
    runner.write_json(
        tmp_path / "ownership.json",
        {
            "emergencyCompleted": bad != "completion",
            "stopped": True,
            "emergencyRun": str(history),
        },
    )
    runner.write_json(
        history / "supervisor-result.json", {"completed": True, "driverStopped": True}
    )
    (history / "emergency").mkdir()
    runner.write_json(
        history / "emergency/driver-result.json",
        {
            "completed": True,
            "additionalDispatch": {"native": 1, "transport": 0, "model": 0},
        },
    )
    with pytest.raises(AssertionError):
        runner.preflight()


def test_prior_attempt_not_replaced(tmp_path, monkeypatch):
    monkeypatch.setattr(runner.emergency, "ROOT", tmp_path)
    monkeypatch.setattr(runner, "preflight", lambda: [])
    pointer = tmp_path / "paired-restore-ownership.json"
    pointer.write_bytes(b"preserved failure evidence")
    with pytest.raises(FileExistsError):
        runner.run()
    assert pointer.read_bytes() == b"preserved failure evidence"


def test_pg_wrong_directory_refuses_before_process_query(tmp_path, monkeypatch):
    (tmp_path / "data").mkdir()
    (tmp_path / "data/postmaster.pid").write_text(
        f"123\n{tmp_path / 'foreign'}\n0\n1234\n", encoding="utf-8"
    )
    monkeypatch.setattr(
        runner, "ProcessIdentity", lambda *args: pytest.fail("foreign process queried")
    )
    with pytest.raises(AssertionError):
        runner.pg_identity(tmp_path, 1234)
