"""One native Reflect round with stage timings; actual model and policy gates remain enabled."""

from __future__ import annotations

import json
import time
import uuid
from collections import defaultdict
from functools import wraps
from pathlib import Path
from typing import Any

from d77_siliconflow_api import ROOT, SOURCE, event, private_json
from real_hindsight_network import observation_failed
from run_d77_api_acceptance import configure_supervisor, supervisor

IDENTITY = "api-reflect-profile-4"
# Native budget="low" multiplies this base by 0.5 before entering the loop.
# Four base iterations therefore allow one tool round and one final synthesis.
ITERATIONS = 4
TIMINGS: dict[str, dict[str, float]] = defaultdict(lambda: {"calls": 0, "seconds": 0.0})


def stage_event(code: str, **values: Any) -> None:
    try:
        event(code, **values)
    except BaseException:
        observation_failed(ROOT, "write")


def instrument(target: Any, name: str, label: str, *, stages: bool = False) -> None:
    original = getattr(target, name)

    @wraps(original)
    async def measured(*args: Any, **kwargs: Any) -> Any:
        started = time.perf_counter()
        count = len(getattr(args[0], "_admitted", {})) if args else 0
        if stages:
            stage_event("REFLECT_STAGE_START", method=label, admitted=count)
        try:
            return await original(*args, **kwargs)
        finally:
            elapsed = time.perf_counter() - started
            TIMINGS[label]["calls"] += 1
            TIMINGS[label]["seconds"] += elapsed
            if stages:
                stage_event(
                    "REFLECT_STAGE_END",
                    method=label,
                    admitted=count,
                    seconds=round(elapsed, 3),
                )

    setattr(target, name, measured)


def observe_stages(root: Path) -> None:
    from hindsight_api.engine.application_state import read_admission
    from hindsight_api.engine.application_state.store import ApplicationStateStore
    from hindsight_api.engine.db.postgresql import PostgresConnection

    for name in ("fetch", "fetchrow", "fetchval"):
        instrument(PostgresConnection, name, "sql." + name)
    for name in ("head", "artifact", "read_body"):
        instrument(ApplicationStateStore, name, "store." + name)
    instrument(
        read_admission.ApplicationReadAdmission, "_binding", "admission._binding"
    )
    for name in (
        "before_model_input",
        "filter_candidates",
        "filter_recall",
        "admit_tool_output",
    ):
        instrument(
            read_admission.ApplicationReadAdmission,
            name,
            "admission." + name,
            stages=True,
        )
    instrument(read_admission, "current_native", "current_native")


async def request_body(root: Path, private: dict[str, str]) -> tuple[str, Any]:
    from hindsight_api.api.taki_application_state import TakiApplicationReflectRequest
    from hindsight_api.engine.application_state.models import (
        TakiApplicationBodyRef,
        TakiApplicationNamespace,
    )
    from hindsight_api.engine.application_state.store import parse_model
    from hindsight_api.engine.db.postgresql import PostgreSQLBackend

    old = json.loads(
        (SOURCE / "recall-character-exact-diagnostic.json").read_text(encoding="utf-8")
    )
    bank_id = old["nativeDiagnostic"]["input"]["bankId"]
    query = json.loads(
        (root / "attempt-api-models-1/api-reflect-grounded.json").read_text(
            encoding="utf-8"
        )
    )["query"]
    owner = json.loads((root / "native/ownership.json").read_text(encoding="utf-8"))
    backend = PostgreSQLBackend()
    await backend.initialize(
        f"postgresql://taki_real:{private['pg_password']}@127.0.0.1:{owner['port']}/taki_real",
        min_size=1,
        max_size=1,
    )
    try:
        async with backend.acquire() as conn:
            assert (
                Path(await conn.fetchval("SHOW data_directory")).resolve()
                == (root / "native/data").resolve()
            )
            row = await conn.fetchrow(
                "SELECT descriptor,provider_lineage,bank_generation FROM memory_application_bodies "
                "WHERE bank_id=$1 AND body_schema='application-read-context.v1' AND state='sealed' ORDER BY body_id LIMIT 1",
                bank_id,
            )
            assert row is not None
            namespace = TakiApplicationNamespace(
                provider_lineage=row["provider_lineage"],
                bank_generation=row["bank_generation"],
                application_id="taki",
            )
            reference = parse_model(TakiApplicationBodyRef, row["descriptor"])
    finally:
        await backend.shutdown()
    return bank_id, TakiApplicationReflectRequest.model_validate(
        {
            "namespace": namespace,
            "request_id": uuid.uuid4(),
            "policy_context_ref": reference,
            "native_request": {
                "query": query,
                "budget": "low",
                "max_tokens": 8192,
                "include": {"facts": {}, "tool_calls": {"output": True}},
            },
        }
    )


async def consume(
    root: Path,
    endpoint: str,
    private: dict[str, str],
    identity: str,
    stop: Any,
    *,
    progress: Any = None,
) -> Any:
    import httpx
    from hindsight_api.api.taki_application_state import TakiApplicationReflectResponse

    assert root == ROOT and identity == IDENTITY
    result_path = root / f"{IDENTITY}-result.json"
    assert not result_path.exists()
    started = time.perf_counter()
    bank_id, body = await request_body(root, private)
    stage_event("NATIVE_REFLECT_PROFILE_STARTED", iterations=ITERATIONS)
    async with httpx.AsyncClient(
        timeout=315,
        trust_env=False,
        headers={"Authorization": "Bearer " + private["api_key"]},
    ) as client:
        response = await client.post(
            f"{endpoint}/ext/taki-memory/banks/{bank_id}/application-state/reflect",
            json=body.model_dump(mode="json"),
        )
    private_json(
        f"{identity}-raw-response.json",
        {
            "status": response.status_code,
            "body": response.text,
            "inclusiveTimings": dict(TIMINGS),
        },
    )
    try:
        value = response.json()
    except ValueError:
        value = None
    elapsed = time.perf_counter() - started
    metadata = {
        "status": response.status_code,
        "seconds": elapsed,
        "baseIterations": ITERATIONS,
        "effectiveIterations": 2,
        "completeAnswer": False,
        "subjectiveOwnerAcceptance": False,
    }
    if response.status_code == 200:
        parsed = TakiApplicationReflectResponse.model_validate(value)
        assert (
            parsed.request_id == body.request_id and parsed.namespace == body.namespace
        )
        assert parsed.admission.context_hash == body.policy_context_ref.payload_hash
        assert parsed.native_response.text.strip()
        assert parsed.admission.admitted_memories > 0
        assert (
            parsed.native_response.based_on is not None
            and parsed.native_response.based_on.memories
        )
        metadata.update(
            completeAnswer=True,
            characters=len(parsed.native_response.text),
            usage=parsed.native_response.usage.model_dump()
            if parsed.native_response.usage
            else None,
        )
    private_json(
        result_path.name,
        {
            "metadata": metadata,
            "request": body.model_dump(mode="json"),
            "response": value,
            "inclusiveTimings": dict(TIMINGS),
        },
    )
    stage_event("NATIVE_REFLECT_PROFILE_COMPLETE", **metadata)
    with (root / f"consumer-{identity}-complete.json").open(
        "x", encoding="utf-8"
    ) as stream:
        stream.write(
            json.dumps(
                {
                    "schemaVersion": 1,
                    "runDirectoryId": root.name,
                    "consumerId": identity,
                    "state": "complete",
                }
            )
            + "\n"
        )
    outcome = supervisor.TerminalOutcome(
        "consumer_complete",
        0,
        False,
        0,
        identity,
        services_stopped={
            "consumer": True,
            "http": False,
            "engine": False,
            "background_tasks": False,
            "postgres": False,
        },
    )
    if progress is not None:
        progress.outcome = outcome
        progress.terminal.set()
    return outcome


def main() -> int:
    configure_supervisor()
    original_environment = supervisor.model_environment
    original_observer = supervisor.observe_model_calls

    def environment(root: Path) -> dict[str, str]:
        values = original_environment(root)
        values["HINDSIGHT_API_REFLECT_MAX_ITERATIONS"] = str(ITERATIONS)
        return values

    def observe(root: Path) -> None:
        original_observer(root)
        observe_stages(root)

    supervisor.__file__ = str(Path(__file__).resolve())
    supervisor.model_environment = environment
    supervisor.observe_model_calls = observe
    supervisor.consume = consume
    return supervisor.main()


if __name__ == "__main__":
    raise SystemExit(main())
