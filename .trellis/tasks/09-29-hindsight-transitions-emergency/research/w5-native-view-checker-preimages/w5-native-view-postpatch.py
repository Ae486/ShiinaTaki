"""Parent-only postpatch V2 actual-model/telemetry composition. Default does no work."""

from __future__ import annotations

import argparse
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import asdict
from pathlib import Path
from typing import Any

import w5_actual_embedding_control as control
import w5_native_view_inventory as inventory

ENTRY = Path(__file__).resolve()


@contextmanager
def composition(
    source: inventory.VerifiedInventory, jobs: list[Path]
) -> Iterator[None]:
    """Adapt only source inventory and the actual V2 worker's entry script.

    Original verifiers still check every new inventory entry and their fixed
    helper hashes. The additive verifier additionally pins all old manifests
    and forbids any replacement outside the explicit W5 ownership list.
    """
    original_load, original_verify, original_manifest = (
        control.load,
        control.verify_sources,
        control.MANIFEST,
    )

    def verify() -> None:
        inventory.verify_inventory(source.sha256)
        original_verify()

    def adapt(module: Any, filename: str) -> Any:
        if filename == "w5-candidate-actual-embedding-v2.py":
            module.V2_ENTRY = ENTRY
            original_runner, original_start = module.v1_runner, module.start_worker

            def runner() -> Any:
                value = original_runner()
                # V2 assigns its historical manifest on every runner load.
                # This NEW composition immediately restores the complete new
                # one in both processes, before any original verifier runs.
                control.MANIFEST = inventory.MANIFEST
                return value

            def start(job: Path, **kwargs: Any) -> Any:
                assert not jobs, "ONE_POSTPATCH_WORKER_ONLY"
                jobs.append(job)
                control.write_json(job / "inventory-parent-before.json", asdict(source))
                return original_start(job, **kwargs)

            module.v1_runner, module.start_worker = runner, start
        elif filename == "w5-candidate-actual-embedding-telemetry.py":
            module.verify_manifest = lambda: asdict(
                inventory.verify_inventory(source.sha256)
            )
            module.V2_SHA = source.sha256
        elif filename == "w5-trigger-uuid-migration-rehearsal.py":
            module.MANIFEST = inventory.MANIFEST
            nested_load = module.load

            def nested(name: str, child_filename: str) -> Any:
                return adapt(nested_load(name, child_filename), child_filename)

            module.load = nested
        elif filename == "w5-candidate-trigger-readonly-diagnostic-v3.py":
            module.READER_MANIFEST, module.READER_HASH = (
                inventory.MANIFEST,
                source.sha256,
            )
        return module

    def load(name: str, filename: str) -> Any:
        return adapt(original_load(name, filename), filename)

    setattr(control, "load", load)
    setattr(control, "verify_sources", verify)
    control.MANIFEST = inventory.MANIFEST
    try:
        yield
    finally:
        control.load, control.verify_sources, control.MANIFEST = (
            original_load,
            original_verify,
            original_manifest,
        )


def worker(job: Path) -> None:
    job = job.resolve()
    assert job.parent == control.RUNTIME.resolve() and job.name.startswith(
        "w5-actual-embedding-"
    )
    source = inventory.verify_inventory(
        control.read_json(job / "job.json")["sourceManifestSha256"]
    )
    with composition(source, []):
        v2 = control.load(
            "w5_native_view_worker_v2", "w5-candidate-actual-embedding-v2.py"
        )
        v2.worker_handshake(job)
        control.write_json(job / "inventory-worker-before.json", asdict(source))
        try:
            v2.v1_runner().child_entry(job)
        finally:
            control.write_json(
                job / "inventory-worker-after.json",
                asdict(inventory.verify_inventory(source.sha256)),
            )


def run_reviewed() -> Path:
    source = inventory.verify_inventory()
    jobs: list[Path] = []
    error_class = None
    try:
        with composition(source, jobs):
            telemetry = control.load(
                "w5_native_view_telemetry", "w5-candidate-actual-embedding-telemetry.py"
            )
            job = telemetry.run_reviewed()
            assert jobs == [job], "POSTPATCH_JOB_MISMATCH"
    except BaseException as error:
        error_class = type(error).__name__
    assert len(jobs) == 1, "POSTPATCH_JOB_NOT_CREATED"
    job = jobs[0]
    try:
        after = asdict(inventory.verify_inventory(source.sha256))
    except Exception as error:
        after = {"verified": False, "errorClass": type(error).__name__}
    control.write_json(job / "inventory-parent-after.json", after)
    reports = {}
    for name in (
        "inventory-worker-before",
        "inventory-worker-after",
        "telemetry-result",
    ):
        path = job / f"{name}.json"
        reports[name] = control.read_json(path) if path.exists() else None
    complete = after == asdict(source) and all(
        reports[name] == asdict(source)
        for name in ("inventory-worker-before", "inventory-worker-after")
    )
    telemetry_result = reports["telemetry-result"] or {}
    result = {
        "meaning": "Postpatch Native source; unchanged V2 model/clone/watchdog plus worker/system telemetry.",
        "diagnosticSucceeded": complete
        and telemetry_result.get("diagnosticSucceeded") is True
        and error_class is None,
        "completeInventoryVerifiedByParentAndActualWorker": complete,
        "sourceInventory": asdict(source),
        "parentInventoryAfter": after,
        "reports": reports,
        "nativeApplyBudgetPassed": telemetry_result.get("nativeApplyBudgetPassed"),
        "httpOrAuthorityRecoveryProven": False,
        "errorClass": error_class,
    }
    control.write_json(job / "postpatch-result.json", result)
    print(
        f"W5_NATIVE_VIEW_POSTPATCH_RESULT {job / 'postpatch-result.json'}", flush=True
    )
    return job


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-reviewed-clone", action="store_true")
    parser.add_argument("--owned-job", type=Path, help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.owned_job is not None:
        worker(args.owned_job)
    elif args.run_reviewed_clone:
        job = run_reviewed()
        if not control.read_json(job / "postpatch-result.json")["diagnosticSucceeded"]:
            raise SystemExit(1)
    else:
        print(
            "Parent-only; executed=false; postpatch complete inventory; original V2 deadlines and model unchanged."
        )


if __name__ == "__main__":
    main()
