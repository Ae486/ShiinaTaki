"""Focused actual run_child -> owned pg_ctl startup seam, without corpus/models."""

from __future__ import annotations

import os
import subprocess
from contextlib import nullcontext
from types import SimpleNamespace
from unittest.mock import patch

import pytest

import w5_actual_embedding_control as control
import w5_http_composition as composition
from w5_http_environment_probe import EVIDENCE, original_command, synthetic_cluster


def test_actual_run_child_preserves_windows_before_owned_pg_start(tmp_path):
    cluster = synthetic_cluster()
    job = tmp_path / "job"
    job.mkdir()
    source = {"sha256": "a" * 64, "entries": 5084, "verified": True}
    control.write_json(job / "job.json", {"sourceManifestSha256": source["sha256"]})
    retained = control.child_environment(job)
    incoming = {
        **retained,
        "OPENAI_API_KEY": "fixture-secret-must-not-reach-child",
        "HINDSIGHT_API_LLM_API_KEY": "fixture-secret-must-not-reach-child",
        "HF_HOME": "fixture-cache-override-must-not-reach-child",
        "TRANSFORMERS_CACHE": "fixture-cache-override-must-not-reach-child",
    }
    clone = SimpleNamespace(
        CLONE=cluster.root,
        PORT=cluster.pointer["port"],
        REPORT={},
        owner=SimpleNamespace(inspection=SimpleNamespace(PG_CTL=control.PG_CTL)),
        pg_command=original_command(cluster),
        write_json=control.write_json,
        run_clone=lambda _: (_ for _ in ()).throw(
            AssertionError("MODEL_ENTRY_FORBIDDEN")
        ),
        timed=lambda _name, function: function,
    )
    old = SimpleNamespace(composition=lambda *_args: nullcontext())
    observed = {
        "root": str(cluster.root),
        "meaning": "Actual run_child environment and PG start; synthetic rehearsal boundary",
    }

    def run_reviewed(*, with_apply):
        assert with_apply is True
        module = rehearsal.load("fixture", "w5-reentry-candidate-native-clone.py")
        # The actual models.install custody adapter publishes the pointer before
        # calling the exact frozen pg_command function on this empty fixture.
        module.write_json(
            cluster.root / "ownership.json",
            control.read_json(cluster.root / "ownership.json"),
        )
        observed["retainedKeysMatch"] = {
            key: os.environ.get(key) == value for key, value in retained.items()
        }
        observed["forbiddenKeysAbsent"] = all(
            key not in os.environ
            for key in (
                "OPENAI_API_KEY",
                "HINDSIGHT_API_LLM_API_KEY",
                "HF_HOME",
                "TRANSFORMERS_CACHE",
            )
        )
        observed["httpSettingsMatch"] = all(
            os.environ.get(key) == value for key, value in composition.SETTINGS.items()
        )
        observed["startExitCode"] = module.pg_command(
            cluster.arguments, "run-child-start"
        )
        assert observed["startExitCode"] == 0
        process = control.owned_pg(cluster.pointer)
        assert process is not None
        process.close()
        observed["ownedPostgresVerified"] = True
        assert all(observed["retainedKeysMatch"].values())
        assert observed["forbiddenKeysAbsent"] and observed["httpSettingsMatch"]

    rehearsal = SimpleNamespace(load=lambda *_args: clone, run_reviewed=run_reviewed)

    def load(_name, filename):
        if filename == "w5-native-view-postpatch.py":
            return old
        assert filename == "w5-trigger-uuid-migration-rehearsal.py"
        return rehearsal

    try:
        with (
            patch.dict(os.environ, incoming, clear=True),
            patch.object(
                composition.inventory, "verify_inventory", return_value=source
            ),
            patch.object(control, "load", load),
        ):
            composition.run_child(job)
        assert control.read_json(job / "inventory-python-after.json") == source
        observed["sourceAfterWritten"] = True
    finally:
        # Environment restoration above occurs before cleanup, including the RED
        # case, so a broken filter cannot prevent the test parent reaping PG.
        observed["cleanup"] = control.cleanup_pg(cluster.pointer)
        for name in ("http-pg-start-failure.json", "phase.json"):
            if (job / name).exists():
                observed[name] = control.read_json(job / name)
        EVIDENCE.mkdir(exist_ok=True)
        control.write_json(EVIDENCE / "run-child-seam.json", observed)
        assert observed["cleanup"]["stopped"] and observed["cleanup"]["portReleased"]


def test_pg_start_failure_preserves_first_numeric_site(tmp_path):
    codes = iter([3221225477, 1])
    clone = SimpleNamespace(REPORT={}, pg_command=lambda *_args: next(codes))
    composition.observe_pg_start(clone, tmp_path)
    assert clone.pg_command(["-D", "owned", "start"], "start") == 3221225477
    first = control.read_json(tmp_path / "http-pg-start-failure.json")
    assert first == {
        "site": "pg_ctl.start",
        "errorClass": "NonZeroExit",
        "exitCode": 3221225477,
        "exitHex": "0xc0000005",
    }
    assert clone.REPORT["httpPgStartFailure"] == first
    assert control.read_json(tmp_path / "phase.json")["phase"] == "pg-start-failed"
    assert clone.pg_command(["-D", "owned", "start"], "later") == 1
    assert control.read_json(tmp_path / "http-pg-start-failure.json") == first


def test_exceptional_start_preserves_phase_and_monotonic_anchor(tmp_path):
    phase = {"phase": "pg-starting", "monotonic": 12345.25}
    control.write_json(tmp_path / "phase.json", phase)
    original_phase = (tmp_path / "phase.json").read_bytes()
    error = subprocess.TimeoutExpired("owned-pg-start", 45)

    def start(*_args):
        raise error

    clone = SimpleNamespace(REPORT={}, pg_command=start)
    composition.observe_pg_start(clone, tmp_path)
    with pytest.raises(subprocess.TimeoutExpired) as caught:
        clone.pg_command(["-D", "owned", "start"], "start")
    assert caught.value is error
    assert (tmp_path / "phase.json").read_bytes() == original_phase
    assert control.read_json(tmp_path / "phase.json") == phase
    assert control.read_json(tmp_path / "http-pg-start-failure.json") == {
        "site": "pg_ctl.start",
        "errorClass": "TimeoutExpired",
    }
