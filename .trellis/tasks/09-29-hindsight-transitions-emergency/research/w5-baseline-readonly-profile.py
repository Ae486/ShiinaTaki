"""Parent-only fresh-clone baseline profile; default invocation performs no work.

Reuse V2's exact worker/venv custody and the sealed clone/e40 migration setup.
Two independent read-only RR captures retain every production proof check. No
delta apply, claim, renewal, maintenance, model, HTTP, or working-pair startup.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import sqlite3
import sys
import time
from contextlib import nullcontext
from dataclasses import asdict
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import w5_actual_embedding_control as control
from w5_baseline_profile_metrics import Profile, ReadConnection, Sampler

ENTRY = Path(__file__).resolve()
MANIFEST = control.HERE / "w5-baseline-readonly-profile-source-manifest.json"
V2_MANIFEST = control.HERE / "w5-candidate-actual-embedding-v2-source-manifest.json"
V2_SHA = "9d327ad5a2b2dd9f551f6c7398d0192aa7f3375a6d3badc508c898e05d618e6f"
PASS_SECONDS = 180
SQL_SECONDS = 30
PASSES = ("light", "detail")


def configure_manifest() -> None:
    assert control.digest(V2_MANIFEST) == V2_SHA, "V2_MANIFEST_CHANGED"
    control.MANIFEST = MANIFEST
    control.verify_sources()


def phase(job: Path, name: str, pass_name: str | None = None) -> None:
    control.write_json(
        job / "phase.json",
        {"phase": name, "pass": pass_name, "monotonic": time.monotonic()},
    )


def request_input(clone: Any) -> tuple[str, Any]:
    from hindsight_api.engine.transfer.transition_delta_models import (
        TakiTransitionDeltaRequest,
        transition_delta_hash,
    )

    clone.verify_input()
    path = (clone.INPUT / "application.sqlite").resolve()
    database = sqlite3.connect(path.as_uri() + "?mode=ro&immutable=1", uri=True)
    try:
        row = database.execute(
            "SELECT body FROM memory_transition_preparations WHERE transition_id=?",
            (str(clone.TRANSITION),),
        ).fetchone()
    finally:
        database.close()
    assert row is not None, "MISSING_EXACT_PREPARATION"
    prepared = json.loads(row[0])
    request = TakiTransitionDeltaRequest.model_validate(prepared["request"])
    bank_id = prepared["scope"]["nativeBankId"]
    assert request.operation_id == clone.candidate_audit.DELTA_OPERATION
    assert (
        request.request_hash
        == clone.candidate_audit.DELTA_HASH
        == transition_delta_hash(bank_id, request)
    )
    return bank_id, request


async def backend_identity(
    raw: Any, clone: Any, job: Path, pass_name: str
) -> dict[str, Any]:
    assert clone.owned_pg(), "OWNED_PG_REQUIRED"
    assert (
        Path(await raw.fetchval("SHOW data_directory")).resolve()
        == (clone.CLONE / "data").resolve()
    )
    assert int(await raw.fetchval("SHOW port")) == clone.PORT
    row = await raw.fetchrow(
        "SELECT pid,backend_start,host(client_addr) AS client FROM pg_stat_activity WHERE pid=pg_backend_pid()"
    )
    assert row is not None and row["client"] == "127.0.0.1", (
        "BACKEND_CONNECTION_REFUSED"
    )
    identity = control.ProcessIdentity(row["pid"])
    try:
        executable, creation_ticks = (
            identity.value["executable"],
            identity.value["creationTicks"],
        )
        assert isinstance(executable, str) and isinstance(creation_ticks, int), (
            "BACKEND_IDENTITY_SHAPE"
        )
        assert Path(executable).resolve() == control.POSTGRES.resolve(), (
            "BACKEND_IMAGE_REFUSED"
        )
        created = creation_ticks / 10_000_000 - 11_644_473_600
        assert abs(created - row["backend_start"].timestamp()) <= 3, (
            "BACKEND_PID_REUSED"
        )
        result = {
            "clone": str(clone.CLONE),
            "pass": pass_name,
            "identity": identity.value,
            "backendStart": row["backend_start"].isoformat(),
            "connectionVerified": True,
        }
        control.write_json(job / "backend.json", result)
        control.write_json(job / f"backend-{pass_name}.json", result)
        return result
    finally:
        identity.close()


async def baseline_pass(
    raw: Any, clone: Any, job: Path, pass_name: str, bank_id: str, request: Any
) -> dict[str, Any]:
    from hindsight_api.engine.db.postgresql import PostgresConnection
    from hindsight_api.engine.transition_models import TakiTransitionFinalProof
    from hindsight_api.engine.transition_snapshot import capture_transition_baseline

    profile = Profile() if pass_name == "detail" else None
    result: dict[str, Any] = {"pass": pass_name, "completed": False, "bodyReuse": True}
    async with raw.transaction(isolation="repeatable_read", readonly=True):
        assert await raw.fetchval("SHOW transaction_read_only") == "on", (
            "READ_ONLY_TRANSACTION_REQUIRED"
        )
        assert await raw.fetchval("SHOW transaction_isolation") == "repeatable read", (
            "RR_TRANSACTION_REQUIRED"
        )
        row = await raw.fetchrow(
            "SELECT phase,proof::text AS proof FROM memory_transition_requests WHERE bank_id=$1 AND transition_id=$2",
            bank_id,
            request.baseline_transition_id,
        )
        assert row is not None and row["phase"] == "retired", (
            "RETIRED_BASELINE_REQUIRED"
        )
        proof = TakiTransitionFinalProof.model_validate(json.loads(row["proof"]))
        assert proof.proof_hash == request.baseline_proof_hash, (
            "EXACT_BASELINE_PROOF_REQUIRED"
        )
        connection = ReadConnection(PostgresConnection(raw), profile)
        phase(job, "baseline", pass_name)
        wall, process, thread = (
            time.perf_counter_ns(),
            time.process_time_ns(),
            time.thread_time_ns(),
        )
        try:
            with profile.installed() if profile else nullcontext():
                baseline = await capture_transition_baseline(
                    connection, clone.fq_table, bank_id, _reuse_body_bytes=True
                )
            assert baseline.baseline_hash == proof.baseline_hash, (
                "FULL_BASELINE_HASH_MISMATCH"
            )
            result.update(
                completed=True,
                baselineHash=baseline.baseline_hash,
                nativeHash=baseline.native_records_hash,
                applicationHash=baseline.application_records_hash,
                auxiliaryHash=baseline.auxiliary_records_hash,
                auxiliaryRecords=len(baseline.auxiliary),
            )
        finally:
            result.update(
                wallMilliseconds=(time.perf_counter_ns() - wall) / 1_000_000,
                processCpuMilliseconds=(time.process_time_ns() - process) / 1_000_000,
                threadCpuMilliseconds=(time.thread_time_ns() - thread) / 1_000_000,
                sqlCalls=connection.calls,
                readOnly=True,
                isolation="repeatable read",
            )
            if profile:
                result["profile"] = profile.report()
            control.write_json(job / f"baseline-{pass_name}.json", result)
            phase(job, "between-passes")
    return result


async def measure(clone: Any, job: Path) -> dict[str, Any]:
    import asyncpg
    from hindsight_api.engine.memories import set_memories
    from hindsight_api.engine.memories.postgres import PostgresMemories

    set_memories(PostgresMemories({}))
    bank_id, request = request_input(clone)
    report: dict[str, Any] = {
        "completed": False,
        "passes": [],
        "applyCalls": 0,
        "modelCalls": 0,
        "meaning": "SQL-prewarmed read-only baseline attribution. No request latency or authority-recovery claim.",
    }
    for pass_name in PASSES:
        raw = await asyncpg.connect(
            host="127.0.0.1",
            port=clone.PORT,
            database="taki_real",
            user="taki_real",
            password="",
            timeout=10,
            command_timeout=SQL_SECONDS,
            server_settings={
                "default_transaction_read_only": "on",
                "statement_timeout": "30000",
                "lock_timeout": "2000",
                "application_name": "w5-baseline-readonly-profile",
            },
        )
        try:
            await backend_identity(raw, clone, job, pass_name)
            report["passes"].append(
                await asyncio.wait_for(
                    baseline_pass(raw, clone, job, pass_name, bank_id, request),
                    PASS_SECONDS,
                )
            )
        finally:
            try:
                await asyncio.wait_for(raw.close(), 5)
            except TimeoutError:
                raw.terminate()
                raise
    light, detail = report["passes"]
    for key in (
        "baselineHash",
        "nativeHash",
        "applicationHash",
        "auxiliaryHash",
        "auxiliaryRecords",
        "sqlCalls",
    ):
        assert light[key] == detail[key], "INDEPENDENT_BASELINE_DIVERGENCE"
    # Instrumentation can change wall/CPU costs; equal semantic output and calls
    # are the equivalence gate, never a ratio used to 'correct' measured latency.
    assert not any(
        name in sys.modules for name in ("torch", "sentence_transformers")
    ), "MODEL_IMPORTED"
    report["completed"] = True
    return report


def child_run(job: Path) -> None:
    retained = control.child_environment(job)
    os.environ.clear()
    os.environ.update(retained)
    configure_manifest()
    rehearsal = control.load(
        "w5_baseline_migration", "w5-trigger-uuid-migration-rehearsal.py"
    )
    clone = control.load("w5_baseline_clone", "w5-reentry-candidate-native-clone.py")
    custody = control.load("w5_baseline_custody", "w5_actual_embedding_composition.py")
    sys.path.insert(0, str(clone.NATIVE))
    custody.install(clone, job)
    custody_writer = clone.write_json
    clone.REPORT.clear()
    clone.REPORT.update(
        meaning="Parent-owned fresh clone: e30/e40 setup, two independent read-only baseline captures.",
        networkAttemptsRefused=0,
        applyCalls=0,
        modelCalls=0,
        stopped=False,
    )

    # Reuse only the installed PG pointer/handle/stop custody. Replacing run_clone
    # here makes the model initializer and original apply path unreachable.
    async def run(_unused_password: str) -> None:
        absent = clone.CLONE / "no-external-pg-credentials"
        assert not absent.exists()
        os.environ["PGPASSFILE"] = os.environ["PGSERVICEFILE"] = str(absent)
        clone.connection_refusal_guard()
        await asyncio.wait_for(
            rehearsal.migrate_and_prove(clone), rehearsal.PROOF_SECONDS
        )
        configure_manifest()
        clone.REPORT["baselineProfile"] = await measure(clone, job)
        phase(job, "read-only-preservation")
        after = await asyncio.wait_for(
            rehearsal.capture(clone), rehearsal.PROOF_SECONDS
        )
        assert asdict(after) == control.read_json(
            clone.CLONE / "migration-after.json"
        ), "READ_ONLY_DATA_CHANGED"
        clone.REPORT["readOnlyTablesPreserved"] = True
        clone.REPORT["sourceManifestSha256"] = control.digest(MANIFEST)

    def writer(path: Path, value: Any) -> None:
        if path.name == "result.json":
            control.write_json(path, value)
        else:
            custody_writer(path, value)

    clone.run_clone, clone.write_json = run, writer

    def table_name(table: str) -> str:
        assert re.fullmatch(r"[a-z_]+", table), "TABLE_NAME_REFUSED"
        return '"' + table + '"'

    clone.fq_table = table_name
    clone.main()


def final_report(
    job: Path, result: dict[str, Any], telemetry: dict[str, Any]
) -> dict[str, Any]:
    child = result.get("childReport", {})
    profile = child.get("baselineProfile", {})
    self_report = (
        control.read_json(job / "worker-self.json")
        if (job / "worker-self.json").exists()
        else None
    )
    held = (
        control.read_json(job / "child.json") if (job / "child.json").exists() else None
    )
    identity_ok = bool(
        self_report
        and held
        and self_report.get("verified") is True
        and self_report.get("identity") == held
        and self_report.get("heldPid") == self_report.get("scriptPid") == held["pid"]
    )
    results = profile.get("passes", [])
    equal_hashes = len(results) == 2 and all(
        isinstance(results[0].get(key), str)
        and re.fullmatch(r"[a-f0-9]{64}", results[0][key])
        and results[0][key] == results[1].get(key)
        for key in ("baselineHash", "nativeHash", "applicationHash", "auxiliaryHash")
    )
    result.update(
        meaning="Read-only baseline diagnostic; preserved V1 supervisor job naming is custody reuse only.",
        workerSelf=self_report,
        directWorkerIdentityVerified=identity_ok,
        telemetry=telemetry,
        diagnosticSucceeded=False,
        nativeApplyBudgetPassed=None,
        httpOrAuthorityRecoveryProven=False,
    )
    result["diagnosticSucceeded"] = bool(
        identity_ok
        and result.get("watchdog", {}).get("childExitCode") == 0
        and not result.get("watchdog", {}).get("timeout")
        and not result.get("errorClass")
        and not result.get("collectionErrorClass")
        and not child.get("errorClass")
        and profile.get("completed") is True
        and equal_hashes
        and [row.get("pass") for row in results] == list(PASSES)
        and all(
            row.get("completed") is True
            and row.get("readOnly") is True
            and row.get("isolation") == "repeatable read"
            for row in results
        )
        and child.get("readOnlyTablesPreserved") is True
        and child.get("applyCalls") == 0
        and child.get("modelCalls") == 0
        and result.get("cleanup", {}).get("stopped") is True
        and result.get("cleanup", {}).get("portReleased") is True
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
        and all(telemetry.get("backendSamples", {}).get(name, 0) > 0 for name in PASSES)
    )
    return result


def parent_run() -> Path:
    configure_manifest()
    runner = control.load("w5_baseline_parent", "w5-candidate-actual-embedding.py")
    v2 = control.load("w5_baseline_v2", "w5-candidate-actual-embedding-v2.py")
    v2.V2_ENTRY = ENTRY
    observation: dict[str, Any] = {}
    original_supervise = control.supervise
    job_holder: list[Path] = []

    def launch(arguments: list[str], **kwargs: Any) -> Any:
        assert (
            len(arguments) == 6
            and arguments[1:3] == ["-B", "-s"]
            and arguments[4] == "--owned-job"
        )
        assert Path(arguments[0]).resolve() == control.PYTHON.resolve()
        assert (
            Path(arguments[3]).resolve()
            == control.HERE / "w5-candidate-actual-embedding.py"
        )
        job = Path(arguments[5])
        job_holder.append(job)
        return v2.start_worker(job, environment=kwargs["env"])

    def supervise(child: Any, phase_reader: Any, **kwargs: Any) -> dict[str, Any]:
        sampler = Sampler(job_holder[0])

        def observed_phase() -> Any:
            value = phase_reader()
            sampler.sample(value)
            return value

        try:
            return original_supervise(child, observed_phase, **kwargs)
        finally:
            observation.update(sampler.report())

    # Neither patch mutates global subprocess or the control module. V1 keeps
    # its error cleanup, independent preservation and 900-second held watchdog.
    runner.subprocess = SimpleNamespace(
        **{
            name: getattr(runner.subprocess, name)
            for name in ("DEVNULL", "CREATE_NO_WINDOW")
        },
        Popen=launch,
    )
    runner.control = SimpleNamespace(**{**vars(control), "supervise": supervise})
    job = runner.run_reviewed()
    result = final_report(job, control.read_json(job / "result.json"), observation)
    control.write_json(job / "result.json", result)
    print(f"W5_BASELINE_READONLY_RESULT {job / 'result.json'}", flush=True)
    return job


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-reviewed-clone", action="store_true")
    parser.add_argument("--owned-job", type=Path, help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.owned_job:
        job = args.owned_job.resolve()
        assert job.parent == control.RUNTIME.resolve() and job.name.startswith(
            "w5-actual-embedding-"
        )
        try:
            v2 = control.load(
                "w5_baseline_worker_v2", "w5-candidate-actual-embedding-v2.py"
            )
            v2.worker_handshake(job)
            child_run(job)
        except BaseException as error:
            control.write_json(
                job / "child-failure.json",
                {"errorClass": type(error).__name__, "stage": "baseline-readonly"},
            )
            raise
    elif args.run_reviewed_clone:
        job = parent_run()
        if not control.read_json(job / "result.json")["diagnosticSucceeded"]:
            raise SystemExit(1)
    else:
        print(
            "Parent-only; executed=false; fresh clone/e40 setup; two read-only baseline passes; no model/apply; overall=900s."
        )


if __name__ == "__main__":
    main()
