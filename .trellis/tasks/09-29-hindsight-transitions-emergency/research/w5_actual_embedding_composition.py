"""NEW thin composition over frozen migration/clone helpers; parent execution only."""

from __future__ import annotations

import os
import re
import time
from pathlib import Path
from typing import Any

import w5_actual_embedding_control as control

MODEL_OPTIONS = {
    "model_name": "BAAI/bge-small-en-v1.5",
    "force_cpu": False,
    "trust_remote_code": False,
    "allow_mps": False,
}


def phase(job: Path, name: str) -> None:
    control.write_json(job / "phase.json", {"phase": name, "monotonic": time.monotonic()})


async def initialize_model(job: Path, report: dict[str, Any], factory: Any = None) -> Any:
    # Persist before even importing the local ML stack. The independent watchdog
    # remains runnable while synchronous imports/loading block this process.
    phase(job, "initializing")
    started = time.perf_counter()
    report.update(
        options=MODEL_OPTIONS.copy(),
        initializationCompleted=False,
        documentBatches=[],
        syntheticEncoderCalls=0,
        queryEncoderCalls=0,
    )
    control.write_json(job / "embedding.json", report)
    try:
        if factory is None:
            from hindsight_api.engine.embeddings import LocalSTEmbeddings

            factory = LocalSTEmbeddings
        model: Any = factory(**MODEL_OPTIONS)
        await model.initialize()
        report.update(
            initializationCompleted=True,
            dimension=model.dimension,
            device=model._device_type,
            modelName=model.model_name,
            cacheRevision=None,
        )
        # Model metadata is optional, local, and never a trigger to resolve or
        # download assets. Only a closed commit hash may enter the report.
        local_model = vars(model).get("_model")
        if local_model is not None:
            revision = getattr(
                getattr(getattr(local_model[0], "auto_model", None), "config", None), "_commit_hash", None
            )
            if isinstance(revision, str) and re.fullmatch(r"[a-fA-F0-9]{40,64}", revision):
                report["cacheRevision"] = revision
    except BaseException as error:
        report["initializationErrorClass"] = type(error).__name__
        raise
    finally:
        report["initializationMilliseconds"] = (time.perf_counter() - started) * 1000
        control.write_json(job / "embedding.json", report)
        phase(job, "initialized" if report["initializationCompleted"] else "initialization-failed")

    # The watchdog polls independently; a just-finished late initializer must
    # also refuse rather than hide its deadline crossing between two polls.
    assert report["initializationMilliseconds"] < control.INIT_SECONDS * 1000, "INITIALIZATION_DEADLINE_EXCEEDED"

    original_encode = model.encode_documents

    def encode_documents(texts: list[str]) -> Any:
        entry: dict[str, Any] = {"inputs": len(texts), "completed": False}
        report["documentBatches"].append(entry)
        control.write_json(job / "embedding.json", report)
        started = time.perf_counter()
        try:
            result = original_encode(texts)
            entry["completed"] = True
            return result
        finally:
            entry["milliseconds"] = (time.perf_counter() - started) * 1000
            control.write_json(job / "embedding.json", report)

    def refuse_query(_texts: Any) -> Any:
        report["queryEncoderCalls"] += 1
        raise RuntimeError("QUERY_ENCODING_REFUSED")

    setattr(model, "encode_documents", encode_documents)
    setattr(model, "encode_query", refuse_query)
    return model


def prepare_interceptor(original: Any, model: Any, report: dict[str, Any]) -> Any:
    async def prepare(*, request: Any, embeddings_model: Any, format_date_fn: Any) -> Any:
        # The frozen clone obtained this dimension from the copied native SQL.
        # This runs before the original production prepare and all delta writes.
        assert model.dimension == embeddings_model.dimension, "STORED_VECTOR_DIMENSION_MISMATCH"
        report["storedVectorDimension"] = embeddings_model.dimension

        def refuse_synthetic(_texts: Any) -> Any:
            report["syntheticEncoderCalls"] += 1
            raise RuntimeError("SYNTHETIC_ENCODING_REFUSED")

        embeddings_model.encode_documents = refuse_synthetic
        embeddings_model.encode_query = refuse_synthetic
        return await original(request=request, embeddings_model=model, format_date_fn=format_date_fn)

    return prepare


def actual_report(value: dict[str, Any], model_report: dict[str, Any]) -> dict[str, Any]:
    result = dict(value)
    dimension = result.pop("syntheticVectorDimension", None)
    batches = result.pop("syntheticEmbeddingBatches", [])
    result.pop("realModelCalls", None)
    result.update(
        meaning="Actual local embeddings after SQL migration proof prewarming; direct Native timing only.",
        embeddings=model_report,
        storedVectorDimension=dimension,
        llmCalls=0,
        syntheticEncoderNeverCalled=not batches and model_report.get("syntheticEncoderCalls", 0) == 0,
        actualDocumentEncodingCalls=len(model_report.get("documentBatches", [])),
        httpOrAuthorityRecoveryProven=False,
    )
    full = next((entry for entry in result.get("stages", []) if entry["name"] == "full-apply"), None)
    result["nativeApplyBudgetPassed"] = bool(full and full.get("completed") and full["milliseconds"] < 60000)
    if full and "milliseconds" in full:
        result["fullApplyMilliseconds"] = full["milliseconds"]
        elapsed = result.get("applyElapsedMs")
        if elapsed is not None:
            result["subsequentLookupAndBookkeepingMilliseconds"] = max(0, elapsed - full["milliseconds"])
    lookup = next((entry for entry in result.get("stages", []) if entry["name"] == "exact-lookup"), None)
    if lookup is not None:
        result["exactLookupMilliseconds"] = lookup.get("milliseconds")
    return result


def install(clone: Any, job: Path, model_report: dict[str, Any] | None = None) -> None:
    if model_report is None:
        model_report = {}
    original_writer, original_run, original_command = clone.write_json, clone.run_clone, clone.pg_command
    original_timed = clone.timed

    def timed(name: str, function: Any) -> Any:
        if name == "full-apply":
            # Only this diagnostic service instance gains transparent lookup
            # timing. The original lookup and full-apply wrappers still execute.
            service = function.__self__
            service.lookup = original_timed("exact-lookup", service.lookup)
        return original_timed(name, function)

    def writer(path: Path, value: Any) -> None:
        if path.name == "result.json":
            value = actual_report(value, model_report)
        original_writer(path, value)
        if path.name == "ownership.json":
            pointer_path = job / "clone.json"
            pointer = (
                control.read_json(pointer_path)
                if pointer_path.exists()
                else {
                    "job": str(job),
                    "clone": str(clone.CLONE),
                    "data": str(clone.CLONE / "data"),
                    "port": clone.PORT,
                    "postgres": str(control.POSTGRES.resolve()),
                }
            )
            assert Path(clone.owner.inspection.PG_CTL).resolve() == control.PG_CTL.resolve()
            control.validate_pointer(pointer)
            control.write_json(pointer_path, pointer)

    def command(arguments: list[str], label: str, timeout: int = 45) -> int:
        pointer = control.read_json(job / "clone.json")  # Must exist BEFORE pg_ctl starts.
        if arguments[-1] == "start":
            phase(job, "pg-starting")
        else:
            process = control.owned_pg(pointer)
            assert process is not None, "OWNED_PG_NOT_RUNNING"
            process.close()
        result = original_command(arguments, label, timeout)
        if arguments[-1] == "start":
            process = control.owned_pg(pointer)
            if process is not None:
                pointer["process"] = process.value
                process.close()
                control.write_json(job / "clone.json", pointer)
            phase(job, "pg-started")
        return result

    def owned() -> bool:
        process = control.owned_pg(control.read_json(job / "clone.json"))
        if process is None:
            return False
        process.close()
        return True

    def stop() -> bool:
        if not (job / "clone.json").exists():
            return True  # No PG could start before this pointer was persisted.
        result = control.cleanup_pg(control.read_json(job / "clone.json"))
        clone.REPORT["ownedPgCleanup"] = result
        return result["stopped"]

    async def run(password: str) -> None:
        model = await initialize_model(job, model_report)
        from hindsight_api.engine.transfer import transition_delta

        original_prepare = transition_delta.prepare_current_state_rows
        transition_delta.prepare_current_state_rows = prepare_interceptor(original_prepare, model, model_report)
        phase(job, "apply-and-lookup")
        try:
            await original_run(password)
            assert not clone.REPORT.get("syntheticEmbeddingBatches"), "SYNTHETIC_MODEL_WAS_USED"
            assert model_report["syntheticEncoderCalls"] == 0 and model_report["queryEncoderCalls"] == 0
        finally:
            transition_delta.prepare_current_state_rows = original_prepare
            control.write_json(job / "embedding.json", model_report)
            phase(job, "cleanup")

    clone.write_json, clone.run_clone, clone.pg_command = writer, run, command
    clone.owned_pg, clone.stop_clone = owned, stop
    clone.timed = timed


def run_child(job: Path) -> None:
    retained = control.child_environment(job)
    os.environ.clear()
    os.environ.update(retained)
    control.verify_sources()
    rehearsal = control.load("w5_actual_migration", "w5-trigger-uuid-migration-rehearsal.py")
    original_load = rehearsal.load
    model_report: dict[str, Any] = {}

    def load(name: str, filename: str) -> Any:
        module = original_load(name, filename)
        if filename == "w5-reentry-candidate-native-clone.py":
            install(module, job, model_report)
        elif filename == "w5-candidate-trigger-readonly-diagnostic-v3.py":
            # The frozen rehearsal directs result.json straight to the V3
            # serializer, bypassing clone.write_json. Adapt that exact sink too,
            # including failures before model initialization is ever attempted.
            original_result = module.write_result

            def write_result(path: Path, value: Any) -> None:
                result = actual_report(value, model_report)
                result["actualHelperManifestSha256"] = control.digest(control.MANIFEST)
                original_result(path, result)

            module.write_result = write_result
        return module

    rehearsal.load = load
    rehearsal.run_reviewed(with_apply=True)
