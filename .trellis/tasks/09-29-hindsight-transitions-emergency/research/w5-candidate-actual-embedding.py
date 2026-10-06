"""PARENT ONLY: --run-reviewed-clone runs one offline actual-model discriminator.

Without that flag this prints usage metadata and does no source/data/model access.
The hidden child has a 180-second initialization and 900-second overall watchdog.
Bounded PG cleanup follows termination; this is not a production timer extension.
"""

from __future__ import annotations

import argparse
import os
import subprocess
import time
import uuid
from pathlib import Path
from typing import Any

import w5_actual_embedding_control as control


def preservation(clone: Any, before: Any) -> dict[str, Any]:
    checks = {
        "sourcePreserved": lambda: clone.data_manifest(clone.owner.ROOT / "data") == before,
        "inputPreserved": clone.verify_input,
        "corePreserved": lambda: clone.candidate_audit.pinned_core()["sha256"] == clone.candidate_audit.SOURCE_DB,
        "originalPreserved": lambda: bool(clone.owner.source_verified()),
        "sourcesPreserved": lambda: control.verify_sources() is None,
    }
    result: dict[str, Any] = {}
    for name, check in checks.items():
        try:
            result[name] = bool(check())
        except Exception as error:
            result[name] = False
            result.setdefault("errors", []).append({"check": name, "errorClass": type(error).__name__})
    return result


def collect(job: Path, result: dict[str, Any], clone: Any, before: Any) -> None:
    """Write a parent report even when the terminated child serialized nothing."""
    pointer_file = job / "clone.json"
    result["cleanup"] = {"stopped": False, "portReleased": False, "ownershipVerified": False}
    if pointer_file.exists():
        pointer = control.read_json(pointer_file)
        result["clone"] = pointer
        result["cleanup"] = control.cleanup_pg(pointer)
        # The old pg_ctl start may have completed after child termination. Only
        # this validated owned clone can be stopped, never a port-discovered PID.
        report_path = control.validate_pointer(pointer) / "result.json"
        result["childReportPresent"] = report_path.is_file()
        if report_path.is_file():
            try:
                result["childReport"] = control.read_json(report_path)
                result["childReportSha256"] = control.digest(report_path)
            except Exception as error:
                result["childReportErrorClass"] = type(error).__name__
    else:
        result["childReportPresent"] = False
        result["cleanup"] = {"stopped": True, "portReleased": None, "pgNeverAdmitted": True}
    if (job / "embedding.json").exists():
        result["embeddings"] = control.read_json(job / "embedding.json")
    if (job / "child-failure.json").exists():
        result["childFailure"] = control.read_json(job / "child-failure.json")
    result["preservation"] = preservation(clone, before)


def run_reviewed() -> Path:
    if os.name != "nt":
        raise RuntimeError("WINDOWS_ONLY")
    control.verify_sources()
    job = (control.RUNTIME / f"w5-actual-embedding-{uuid.uuid4().hex}").resolve()
    job.mkdir()
    # Write immutable parent custody before launching any child. Clone custody
    # is recorded separately by the hook before any pg_ctl/model start.
    control.write_json(
        job / "job.json",
        {
            "job": str(job),
            "parentPid": os.getpid(),
            "python": str(control.PYTHON.resolve()),
            "initializationHardSeconds": control.INIT_SECONDS,
            "overallHardSeconds": control.OVERALL_SECONDS,
            "pgStartupSettleMaximumSeconds": control.START_SETTLE_SECONDS,
            "pgStopMaximumSeconds": 70,
            "sourceManifestSha256": control.digest(control.MANIFEST),
            "offline": control.OFFLINE,
            "transition": "6d27eb9b-6bbd-4b56-8ef4-0fda9c5eec53",
            "deltaOperation": "6497dfc9-e287-4cb1-96b5-1020ea1eabc4",
            "requestHash": "946b0a8228df74206a91ea4154e34d6592082e5afae2c069a71846e8e301b8d7",
        },
    )
    print(f"W5_ACTUAL_EMBEDDING_JOB {job}", flush=True)
    result: dict[str, Any] = {"job": str(job), "diagnosticSucceeded": False, "httpOrAuthorityRecoveryProven": False}
    child, clone, before = None, None, None
    try:
        clone = control.load("w5_actual_parent_custody", "w5-reentry-candidate-native-clone.py")
        before = clone.data_manifest(clone.owner.ROOT / "data")
        control.write_json(job / "source-before.json", before)
        preflight = preservation(clone, before)
        control.write_json(job / "preflight.json", preflight)
        assert all(
            preflight.get(key) is True
            for key in ("sourcePreserved", "inputPreserved", "corePreserved", "originalPreserved", "sourcesPreserved")
        )
        child = subprocess.Popen(
            [str(control.PYTHON), "-B", "-s", str(Path(__file__).resolve()), "--owned-job", str(job)],
            cwd=control.HERE,
            env=control.child_environment(job),
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            creationflags=subprocess.CREATE_NO_WINDOW,
        )
        identity = control.ProcessIdentity(child.pid)
        try:
            control.write_json(job / "child.json", identity.value)
        finally:
            identity.close()

        def phase_reader() -> Any:
            return control.read_json(job / "phase.json") if (job / "phase.json").exists() else {}

        result["watchdog"] = control.supervise(
            child, phase_reader, record=lambda value: control.write_json(job / "watchdog.json", value)
        )
    except BaseException as error:
        result["errorClass"] = type(error).__name__
    finally:
        # Also catch errors in the watchdog/phase reader, without allowing an
        # orphan child or selecting a different process by its numeric PID.
        if child is not None and child.poll() is None:
            try:
                child.terminate()
                child.wait(timeout=10)
                result["terminatedOwnedChildAfterError"] = True
            except Exception as error:
                result["childTerminationErrorClass"] = type(error).__name__
        try:
            assert child is None or child.poll() is not None, "CHILD_STILL_RUNNING_CLEANUP_REFUSED"
            phase = control.read_json(job / "phase.json") if (job / "phase.json").exists() else {}
            if phase.get("phase") == "pg-starting":
                # pg_ctl is a separate executable and may survive its launcher.
                # Its frozen start timeout is 45 s. Let that bounded start settle
                # before checking the exact clone PID; do not infer no-PG early.
                remaining = max(0, control.START_SETTLE_SECONDS - (time.monotonic() - phase["monotonic"]))
                result["pgStartupSettleSeconds"] = remaining
                time.sleep(remaining)
            if clone is not None and before is not None:
                collect(job, result, clone, before)
            else:
                result["preservation"] = {"verified": False, "reason": "preflight-did-not-complete"}
        except BaseException as error:
            result["collectionErrorClass"] = type(error).__name__
            result.setdefault("cleanup", {"stopped": False, "portReleased": False, "ownershipVerified": False})
            # Even a bad ownership pointer must not prevent independent source
            # preservation facts from being recorded.
            if clone is not None and before is not None:
                result["preservation"] = preservation(clone, before)
        finally:
            if "watchdog" not in result and (job / "watchdog.json").exists():
                result["watchdog"] = control.read_json(job / "watchdog.json")
            child_report = result.get("childReport", {})
            result["diagnosticSucceeded"] = bool(
                result.get("watchdog", {}).get("childExitCode") == 0
                and not result.get("watchdog", {}).get("timeout")
                and child_report.get("applyCompleted")
                and child_report.get("exactLookupMatches")
                and child_report.get("syntheticEncoderNeverCalled")
                and child_report.get("embeddings", {}).get("initializationCompleted")
                and child_report.get("actualDocumentEncodingCalls", 0) > 0
                and result.get("cleanup", {}).get("stopped")
                and result.get("cleanup", {}).get("portReleased")
                and all(
                    result.get("preservation", {}).get(key) is True
                    for key in (
                        "sourcePreserved",
                        "inputPreserved",
                        "corePreserved",
                        "originalPreserved",
                        "sourcesPreserved",
                    )
                )
            )
            control.write_json(job / "result.json", result)
    print(f"W5_ACTUAL_EMBEDDING_RESULT {job / 'result.json'}", flush=True)
    return job


def child_entry(job: Path) -> None:
    job = job.resolve()
    assert job.parent == control.RUNTIME.resolve() and job.name.startswith("w5-actual-embedding-")
    custody = control.read_json(job / "job.json")
    assert custody["job"] == str(job) and custody["parentPid"] == os.getppid(), "PARENT_CUSTODY_REFUSED"
    started = time.monotonic()
    while not (job / "child.json").exists():
        assert time.monotonic() - started < 10, "CHILD_CUSTODY_NOT_PUBLISHED"
        time.sleep(0.05)
    process = control.ProcessIdentity(os.getpid())
    try:
        assert process.value == control.read_json(job / "child.json"), "CHILD_IDENTITY_REFUSED"
    finally:
        process.close()
    try:
        from w5_actual_embedding_composition import run_child

        run_child(job)
    except BaseException as error:
        control.write_json(job / "child-failure.json", {"errorClass": type(error).__name__})
        raise


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-reviewed-clone", action="store_true")
    parser.add_argument("--owned-job", type=Path, help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.owned_job is not None:
        child_entry(args.owned_job)
    elif args.run_reviewed_clone:
        job = run_reviewed()
        if not control.read_json(job / "result.json")["diagnosticSucceeded"]:
            raise SystemExit(1)
    else:
        print("Parent-only; executed=false; init hard deadline=180s; overall hard deadline=900s.")


if __name__ == "__main__":
    main()
