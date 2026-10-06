"""Parent-only frozen V2 execution with existing worker/system telemetry.

The original V2 child, model, clone, timers, result and source inventory remain
unchanged. This wrapper verifies its cumulative inventory before/after execution
and writes a separate telemetry-result.json. No PostgreSQL backend observation.
"""

from __future__ import annotations

import argparse
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import w5_actual_embedding_control as control
from w5_baseline_profile_metrics import Sampler

MANIFEST = control.HERE / "w5-candidate-actual-embedding-telemetry-source-manifest.json"
BASELINE_MANIFEST = control.HERE / "w5-baseline-readonly-profile-source-manifest.json"
BASELINE_SHA = "2109f69f40d49085cb0087444c66cc836622fca94c4ef6da267b09bf9e5dda8f"
V2_MANIFEST = control.HERE / "w5-candidate-actual-embedding-v2-source-manifest.json"
V2_SHA = "9d327ad5a2b2dd9f551f6c7398d0192aa7f3375a6d3badc508c898e05d618e6f"


def verify_manifest() -> dict[str, Any]:
    # Do not assign control.MANIFEST: frozen V2 deliberately keeps its own
    # cumulative inventory in both parent and actual-model child processes.
    assert control.digest(BASELINE_MANIFEST) == BASELINE_SHA, (
        "BASELINE_MANIFEST_CHANGED"
    )
    assert control.digest(V2_MANIFEST) == V2_SHA, "V2_MANIFEST_CHANGED"
    manifest = control.read_json(MANIFEST)
    for row in manifest["files"]:
        path = Path(row["path"])
        assert (
            path.stat().st_size == row["bytes"]
            and control.digest(path) == row["sha256"]
        ), "WRAPPER_SOURCE_DRIFT"
    return {
        "sha256": control.digest(MANIFEST),
        "entries": len(manifest["files"]),
        "verified": True,
    }


def summarize(
    original: dict[str, Any], telemetry: dict[str, Any], before: Any, after: Any
) -> dict[str, Any]:
    telemetry_ok = bool(
        telemetry.get("samples", 0) > 0
        and telemetry.get("errors") == {}
        and telemetry.get("backendSamples") == {}
    )
    inventory_ok = bool(before == after and before.get("verified") is True)
    source = original.get("childReport", {}).get("actualHelperManifestSha256")
    return {
        "meaning": "One unchanged V2 actual-model run plus worker/system counters; PostgreSQL backend attribution is absent.",
        "diagnosticSucceeded": bool(
            original.get("diagnosticSucceeded") is True
            and telemetry_ok
            and inventory_ok
            and source == V2_SHA
        ),
        "v2DiagnosticSucceeded": original.get("diagnosticSucceeded"),
        "directWorkerIdentityVerified": original.get("directWorkerIdentityVerified"),
        "nativeApplyBudgetPassed": original.get("childReport", {}).get(
            "nativeApplyBudgetPassed"
        ),
        "httpOrAuthorityRecoveryProven": False,
        "watchdog": original.get("watchdog"),
        "preservation": original.get("preservation"),
        "cleanup": original.get("cleanup"),
        "v2ChildSourceManifestSha256": source,
        "wrapperInventoryBefore": before,
        "wrapperInventoryAfter": after,
        "telemetryCollectionSucceeded": telemetry_ok,
        "postgresBackendObservations": "absent-by-design",
        "telemetry": telemetry,
    }


def run_reviewed() -> Path:
    before = verify_manifest()
    v2 = control.load("w5_actual_telemetry_v2", "w5-candidate-actual-embedding-v2.py")
    original_start, original_runner, original_supervise = (
        v2.start_worker,
        v2.v1_runner,
        control.supervise,
    )
    jobs: list[Path] = []
    telemetry: dict[str, Any] = {}

    def start(job: Path, **kwargs: Any) -> Any:
        assert not jobs, "ONE_V2_RUN_ONLY"
        jobs.append(job)
        return original_start(job, **kwargs)

    def supervise(child: Any, phase_reader: Any, **kwargs: Any) -> Any:
        sampler = Sampler(jobs[0])

        def observed_phase() -> Any:
            value = phase_reader()
            # Baseline-only backend.json semantics are not valid for the V2
            # connection pool. Never sample guessed PIDs or a postmaster proxy.
            assert value.get("phase") != "baseline", "UNEXPECTED_BASELINE_PHASE"
            sampler.sample(value)
            return value

        try:
            return original_supervise(child, observed_phase, **kwargs)
        finally:
            telemetry.update(sampler.report())

    def runner() -> Any:
        value = original_runner()
        value.control = SimpleNamespace(**{**vars(control), "supervise": supervise})
        return value

    v2.start_worker, v2.v1_runner = start, runner
    failure: str | None = None
    try:
        job = v2.run_reviewed()
        assert jobs == [job], "V2_JOB_MISMATCH"
    except BaseException as error:
        failure = type(error).__name__
    finally:
        v2.start_worker, v2.v1_runner = original_start, original_runner
        try:
            after = verify_manifest()
        except Exception as error:
            after = {"verified": False, "errorClass": type(error).__name__}
    assert len(jobs) == 1, "V2_JOB_NOT_CREATED"
    job = jobs[0]
    original_path = job / "result.json"
    original = control.read_json(original_path) if original_path.exists() else {}
    original_hash = control.digest(original_path) if original_path.exists() else None
    result = summarize(original, telemetry, before, after)
    result.update(
        job=str(job),
        v2ResultSha256=original_hash,
        originalV2ResultPreserved=original_hash is not None,
    )
    if failure is not None:
        result.update(diagnosticSucceeded=False, wrapperErrorClass=failure)
    control.write_json(job / "telemetry-result.json", result)
    if original_hash is not None:
        assert control.digest(original_path) == original_hash, "V2_RESULT_CHANGED"
    print(
        f"W5_ACTUAL_EMBEDDING_TELEMETRY_RESULT {job / 'telemetry-result.json'}",
        flush=True,
    )
    return job


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-reviewed-clone", action="store_true")
    args = parser.parse_args()
    if args.run_reviewed_clone:
        job = run_reviewed()
        if not control.read_json(job / "telemetry-result.json")["diagnosticSucceeded"]:
            raise SystemExit(1)
    else:
        print(
            "Parent-only; executed=false; unchanged V2 actual model; worker/system telemetry only; no PG backend attribution."
        )


if __name__ == "__main__":
    main()
