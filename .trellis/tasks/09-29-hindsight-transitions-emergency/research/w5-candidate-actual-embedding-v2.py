"""V2 parent-only entry: hold the actual Windows worker, preserving its venv.

V1 files are immutable. Only the process launch and pre-execution handshake are
adapted; all model, SQL, custody, watchdog, and preservation semantics are reused.
"""

from __future__ import annotations

import argparse
import importlib.util
import os
import subprocess
import sys
import time
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import w5_actual_embedding_control as control

BASE_PYTHON = Path("C:/Users/55473/AppData/Local/Programs/Python/Python311/python.exe").resolve()
VENV = control.PYTHON.parents[1].resolve()
V2_MANIFEST = control.HERE / "w5-candidate-actual-embedding-v2-source-manifest.json"
V1_ENTRY = control.HERE / "w5-candidate-actual-embedding.py"
V2_ENTRY = Path(__file__).resolve()
PACKAGES = ("sentence_transformers", "asyncpg", "torch")


def direct_environment(environment: dict[str, str]) -> dict[str, str]:
    # CPython consumes this before importing site, giving the directly launched
    # base executable the exact original venv. Do not substitute PYTHONPATH or
    # manually append site-packages; those would change prefix/stdlib semantics.
    return {**environment, "__PYVENV_LAUNCHER__": str(control.PYTHON.resolve())}


def start_worker(job: Path, *, probe: bool = False, environment: dict[str, str] | None = None) -> Any:
    assert os.name == "nt" and BASE_PYTHON.is_file(), "SUPPORTED_BASE_INTERPRETER_REQUIRED"
    launch = {
        "parentPid": os.getpid(),
        "baseExecutable": str(BASE_PYTHON),
        "logicalVenvExecutable": str(control.PYTHON.resolve()),
        "venvPrefix": str(VENV),
        "launcherVariable": "__PYVENV_LAUNCHER__",
        "probeOnly": probe,
    }
    control.write_json(job / "worker-launch.json", launch)
    return subprocess.Popen(
        [str(BASE_PYTHON), "-B", "-s", str(V2_ENTRY), "--probe-job" if probe else "--owned-job", str(job)],
        cwd=control.HERE,
        env=direct_environment(control.child_environment(job) if environment is None else environment),
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        creationflags=subprocess.CREATE_NO_WINDOW,
    )


def worker_handshake(job: Path) -> dict[str, Any]:
    """No model/data imports: verify self-report before allowing the V1 child."""
    custody = control.read_json(job / "job.json")
    launch = control.read_json(job / "worker-launch.json")
    assert custody["parentPid"] == launch["parentPid"] == os.getppid(), "DIRECT_WORKER_PARENT_MISMATCH"
    started = time.monotonic()
    while not (job / "child.json").exists():
        assert time.monotonic() - started < 10, "DIRECT_WORKER_CUSTODY_TIMEOUT"
        time.sleep(0.025)
    expected = control.read_json(job / "child.json")
    identity = control.ProcessIdentity(os.getpid())
    try:
        base_executable = getattr(sys, "_base_executable", None)
        assert isinstance(base_executable, str), "DIRECT_WORKER_BASE_UNAVAILABLE"
        assert expected == identity.value, "DIRECT_WORKER_HANDLE_MISMATCH"
        assert Path(identity.value["executable"]).resolve() == BASE_PYTHON, "DIRECT_WORKER_IMAGE_MISMATCH"
        assert Path(base_executable).resolve() == BASE_PYTHON, "DIRECT_WORKER_BASE_MISMATCH"
        assert Path(sys.executable).resolve() == control.PYTHON.resolve(), "DIRECT_WORKER_LOGICAL_EXECUTABLE_MISMATCH"
        assert Path(sys.prefix).resolve() == VENV, "DIRECT_WORKER_VENV_MISMATCH"
        assert Path(sys.base_prefix).resolve() == BASE_PYTHON.parent, "DIRECT_WORKER_BASE_PREFIX_MISMATCH"
        packages = {}
        for name in PACKAGES:
            spec = importlib.util.find_spec(name)
            assert spec is not None and spec.origin is not None, "VENV_PACKAGE_UNAVAILABLE"
            origin = Path(spec.origin).resolve()
            assert origin.is_relative_to(VENV / "Lib/site-packages"), "VENV_PACKAGE_RESOLUTION_MISMATCH"
            packages[name] = str(origin)
        report = {
            "parentPid": os.getppid(),
            "heldPid": expected["pid"],
            "scriptPid": os.getpid(),
            "identity": identity.value,
            "executable": sys.executable,
            "baseExecutable": base_executable,
            "prefix": sys.prefix,
            "basePrefix": sys.base_prefix,
            "packageOrigins": packages,
            "packagesImported": [name for name in PACKAGES if name in sys.modules],
            "verified": True,
        }
        assert report["packagesImported"] == [], "UNEXPECTED_PACKAGE_IMPORT_BEFORE_HANDSHAKE"
        control.write_json(job / "worker-self.json", report)
        return report
    finally:
        identity.close()


def v1_runner() -> Any:
    # Runtime-only composition: V1 source/manifest remain byte-identical. Its
    # common verifier now checks the cumulative V2 inventory in both processes.
    control.MANIFEST = V2_MANIFEST
    return control.load("w5_actual_v2_v1_runner", V1_ENTRY.name)


def run_reviewed() -> Path:
    runner = v1_runner()

    def launch(arguments: list[str], **kwargs: Any) -> Any:
        # Exact interception of V1's one diagnostic Popen call. No global
        # subprocess monkeypatch and no effect on PostgreSQL commands.
        assert len(arguments) == 6 and arguments[1:3] == ["-B", "-s"], "UNREVIEWED_CHILD_ARGUMENTS"
        assert Path(arguments[0]).resolve() == control.PYTHON.resolve()
        assert Path(arguments[3]).resolve() == V1_ENTRY and arguments[4] == "--owned-job"
        assert kwargs["creationflags"] == subprocess.CREATE_NO_WINDOW
        return start_worker(Path(arguments[5]), environment=kwargs["env"])

    runner.subprocess = SimpleNamespace(
        Popen=launch, DEVNULL=subprocess.DEVNULL, CREATE_NO_WINDOW=subprocess.CREATE_NO_WINDOW
    )
    job = runner.run_reviewed()
    result = control.read_json(job / "result.json")
    result["workerLaunch"] = (
        control.read_json(job / "worker-launch.json") if (job / "worker-launch.json").exists() else None
    )
    result["workerSelf"] = control.read_json(job / "worker-self.json") if (job / "worker-self.json").exists() else None
    result["directWorkerIdentityVerified"] = bool(result["workerSelf"] and result["workerSelf"]["verified"])
    result["diagnosticSucceeded"] = result["diagnosticSucceeded"] and result["directWorkerIdentityVerified"]
    control.write_json(job / "result.json", result)
    return job


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-reviewed-clone", action="store_true")
    parser.add_argument("--owned-job", type=Path, help=argparse.SUPPRESS)
    parser.add_argument("--probe-job", type=Path, help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.probe_job is not None:
        worker_handshake(args.probe_job)
        # Harmless synchronous blocker: actual process termination, never ML.
        control.write_json(args.probe_job / "phase.json", {"phase": "initializing", "monotonic": time.monotonic()})
        time.sleep(30)
        control.write_json(args.probe_job / "unexpected-completion.json", {"unexpected": True})
    elif args.owned_job is not None:
        job = args.owned_job.resolve()
        assert job.parent == control.RUNTIME.resolve() and job.name.startswith("w5-actual-embedding-")
        try:
            worker_handshake(job)
        except BaseException as error:
            control.write_json(
                job / "child-failure.json", {"errorClass": type(error).__name__, "stage": "direct-worker-handshake"}
            )
            raise
        v1_runner().child_entry(job)
    elif args.run_reviewed_clone:
        job = run_reviewed()
        if not control.read_json(job / "result.json")["diagnosticSucceeded"]:
            raise SystemExit(1)
    else:
        print("V2 parent-only; executed=false; direct base worker with original venv; init=180s; overall=900s.")


if __name__ == "__main__":
    main()
