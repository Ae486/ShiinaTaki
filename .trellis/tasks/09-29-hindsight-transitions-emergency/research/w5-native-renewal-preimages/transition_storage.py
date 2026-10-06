"""Identity-checked transition state, fixed lock order and immutable history."""

from __future__ import annotations

import uuid
from collections.abc import Callable
from datetime import datetime
from typing import Any

from pydantic import ValidationError

from .bank_maintenance import lock_bank_maintenance
from .transfer.current_state_schema import current_state_hash
from .transition_models import (
    TakiTransitionAcquireRequest,
    TakiTransitionExecutor,
    TakiTransitionFinalProof,
    TakiTransitionOutcome,
    TakiTransitionStatus,
    TransitionError,
    transition_acquire_hash,
    transition_proof_hash,
)

# Keep this inventory identical to the migration; its presence is a runtime
# capability gate, not an assumption based on a version string or table name.
TRANSITION_BANK_TABLES = (
    "banks",
    "documents",
    "chunks",
    "memory_units",
    "invalidated_memory_units",
    "entities",
    "observation_history",
    "mental_models",
    "mental_model_history",
    "knowledge_pages",
    "directives",
    "graph_maintenance_queue",
    "memory_mutation_receipts",
    "memory_native_operation_receipts",
    "memory_retain_part_receipts",
    "memory_current_state_transfers",
    "memory_current_state_transfer_mappings",
    "memory_cutover_verifications",
    "memory_cutover_steps",
    "memory_cutover_actions",
    "memory_cutover_evidence_pages",
    "memory_application_banks",
    "memory_application_native_heads",
    "memory_application_artifacts",
    "memory_application_changes",
    "memory_application_operations",
    "memory_application_bodies",
    "memory_application_body_parts",
    "memory_application_snapshots",
)
TRANSITION_ASSOCIATIONS = ("unit_entities", "entity_cooccurrences", "memory_links")


async def transition_schema_available(conn: Any, fq_table: Callable[[str], str]) -> bool:
    if getattr(conn, "backend_type", "postgresql") != "postgresql":
        return False
    return bool(await conn.fetchval("SELECT to_regclass($1) IS NOT NULL", fq_table("memory_transition_fences")))


async def require_transition_schema(conn: Any, fq_table: Callable[[str], str]) -> None:
    try:
        if not await transition_schema_available(conn, fq_table):
            raise TransitionError("unsupported_storage", 503)
        for table, columns in (
            ("memory_transition_fences", "bank_id,generation,transition_id,admission_version"),
            ("memory_transition_bank_origins", "bank_id,creation_id,created_at,ever_used,deleted"),
            (
                "memory_transition_initializations",
                "bank_id,event_key,creation_id,import_id,template_hash,kind,operation_id,evidence",
            ),
            (
                "memory_transition_requests",
                "bank_id,transition_id,provider_lineage,bank_generation,request_hash,request,actor_hash,phase,revision,"
                "generation,attempt_id,fence_token,lease_expires_at,acquired_at,fenced_at,proof,outcome",
            ),
            (
                "memory_transition_writers",
                "writer_id,bank_id,generation,operation_id,state,lease_expires_at,entered_at,finished_at",
            ),
            ("memory_transition_work", "bank_id,transition_id,operation_id,parent_operation_id,parent_writer_id"),
            ("memory_transition_history", "bank_id,transition_id,revision,event,event_hash"),
            (
                "memory_transition_maintenance",
                "bank_id,verification_id,provider_lineage,bank_generation,request_hash,request,"
                "candidate,candidate_hash,required_set_hash,policy_hash,state,revision,attempt_id,maintenance_fence,reasons,certificate",
            ),
            (
                "memory_transition_steps",
                "bank_id,verification_id,step_key,kind,requirement_keys,state,plan,input_records,outcome_records,model_record",
            ),
            ("memory_transition_actions", "bank_id,verification_id,step_key,action_key,receipt,replay_result"),
            (
                "memory_transition_evidence_pages",
                "bank_id,verification_id,page_number,certificate_hash,page_hash,records",
            ),
            ("memory_transition_auxiliary_pages", "bank_id,transition_id,page_number,page_hash,records"),
            ("memory_transition_deltas", "bank_id,transition_id,operation_id,request_hash,request,result"),
        ):
            await conn.fetch(f"SELECT {columns} FROM {fq_table(table)} WHERE FALSE")
        expected = [(table, "guard_transition_bank_write", 31) for table in TRANSITION_BANK_TABLES]
        expected.extend((table, "guard_transition_association_write", 31) for table in TRANSITION_ASSOCIATIONS)
        expected.append(("async_operations", "zz_guard_transition_queue_admission", 23))
        expected.extend(
            (
                ("replication_bank_state", "guard_transition_replication_state", 27),
                ("replication_logical_changes", "guard_transition_replication_journal", 31),
            )
        )
        expected.extend(
            (
                ("memory_transition_history", "guard_transition_history", 27),
                ("memory_transition_deltas", "guard_transition_delta_history", 27),
                ("memory_transition_bank_origins", "guard_transition_bank_origin", 27),
                ("memory_transition_initializations", "guard_transition_initialization_history", 27),
            )
        )
        for table, trigger, kind in expected:
            function = {
                "guard_transition_replication_state": "guard_transition_bank_write",
                "guard_transition_replication_journal": "guard_transition_bank_write",
                "guard_transition_delta_history": "guard_transition_history",
                "guard_transition_initialization_history": "guard_transition_history",
                "zz_guard_transition_queue_admission": "guard_transition_queue_admission",
            }.get(trigger, trigger)
            if not await conn.fetchval(
                "SELECT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass($1) AND tgname=$2 "
                "AND NOT tgisinternal AND tgenabled IN ('O','A') AND tgtype=$3 AND tgfoid=to_regprocedure($4))",
                fq_table(table),
                trigger,
                kind,
                fq_table(function) + "()",
            ):
                raise TransitionError("unsupported_storage", 503)
        for function in (
            "check_transition_publication(text,boolean)",
            "transition_write_permit(text)",
            "transition_initialization_import(text,jsonb)",
            "transition_initialization_operation(text,jsonb)",
        ):
            if not await conn.fetchval("SELECT to_regprocedure($1) IS NOT NULL", fq_table(function)):
                raise TransitionError("unsupported_storage", 503)
    except TransitionError:
        raise
    except Exception as exc:
        raise TransitionError("unsupported_storage", 503) from exc


async def lock_transition_bank(conn: Any, fq_table: Callable[[str], str], bank_id: str) -> Any:
    # Ordinary canonical writers and transition control always enter here before
    # canonical rows. The async admission trigger intentionally uses owner-only
    # MVCC signaling, matching the existing maintenance admission contract.
    view = await lock_bank_maintenance(conn, fq_table, bank_id)
    await conn.execute(
        f"INSERT INTO {fq_table('memory_transition_fences')}(bank_id) VALUES($1) ON CONFLICT DO NOTHING", bank_id
    )
    await conn.fetchrow(f"SELECT * FROM {fq_table('memory_transition_fences')} WHERE bank_id=$1 FOR UPDATE", bank_id)
    return view


async def append_transition_history(conn: Any, fq_table: Callable[[str], str], row: Any) -> None:
    # Request, proof and outcome are typed on reads. Each execution generation
    # and phase is also retained so a new claim cannot rewrite historical truth.
    event = {key: value for key, value in dict(row).items()}
    for key, value in list(event.items()):
        if isinstance(value, datetime):
            event[key] = value.isoformat()
        elif isinstance(value, uuid.UUID):
            event[key] = str(value)
        elif key in {"request", "proof", "outcome"}:
            event[key] = conn.parse_json(value)
    import json

    await conn.execute(
        f"INSERT INTO {fq_table('memory_transition_history')}(bank_id,transition_id,revision,event,event_hash) "
        "VALUES($1,$2,$3,$4::jsonb,$5)",
        row["bank_id"],
        row["transition_id"],
        row["revision"],
        json.dumps(event),
        current_state_hash(event),
    )


async def read_transition_row(
    conn: Any,
    fq_table: Callable[[str], str],
    bank_id: str,
    transition_id: uuid.UUID,
    actor_hash: str,
) -> Any:
    row = await conn.fetchrow(
        f"SELECT * FROM {fq_table('memory_transition_requests')} WHERE bank_id=$1 AND transition_id=$2",
        bank_id,
        transition_id,
    )
    if row is None:
        raise TransitionError("transition_not_found", 404)
    if row["actor_hash"] != actor_hash:
        raise TransitionError("identity_mismatch", 403)
    return row


def executor_from_row(row: Any) -> TakiTransitionExecutor:
    return TakiTransitionExecutor(
        transition_id=row["transition_id"],
        attempt_id=row["attempt_id"],
        generation=row["generation"],
        fence_token=row["fence_token"],
    )


async def assert_transition_executor(conn: Any, row: Any, executor: TakiTransitionExecutor) -> None:
    now = await conn.fetchval("SELECT clock_timestamp()")
    if executor != executor_from_row(row) or row["lease_expires_at"] <= now or row["outcome"] is not None:
        raise TransitionError("executor_lost")


async def transition_status(conn: Any, fq_table: Callable[[str], str], row: Any) -> TakiTransitionStatus:
    try:
        request = TakiTransitionAcquireRequest.model_validate(conn.parse_json(row["request"]))
        proof = TakiTransitionFinalProof.model_validate(conn.parse_json(row["proof"])) if row["proof"] else None
        outcome = TakiTransitionOutcome.model_validate(conn.parse_json(row["outcome"])) if row["outcome"] else None
        if (
            request.transition_id != row["transition_id"]
            or request.request_hash != row["request_hash"]
            or request.request_hash != transition_acquire_hash(row["bank_id"], request)
            or request.provider_lineage != row["provider_lineage"]
            or request.bank_generation != row["bank_generation"]
        ):
            raise TransitionError("evidence_corrupt")
        if proof is not None:
            if (
                proof.proof_hash != transition_proof_hash(proof)
                or proof.bank_id != row["bank_id"]
                or proof.certificate_id != row["transition_id"]
                or proof.executor.transition_id != row["transition_id"]
                or proof.provider_lineage != request.provider_lineage
                or proof.bank_generation != request.bank_generation
                or proof.request_hash != request.request_hash
                or (request.direction == "reenter-hindsight") != (proof.delta_result_hash is not None)
                or proof.unused_scope_hash != (request.unused_scope.proof_hash if request.unused_scope else None)
            ):
                raise TransitionError("evidence_corrupt")
            await _assert_history_fact(conn, fq_table, row, "proof", proof.proof_hash, proof.executor)
        if outcome is not None and (
            outcome.bank_id != row["bank_id"]
            or outcome.provider_lineage != request.provider_lineage
            or outcome.bank_generation != request.bank_generation
            or outcome.phase != row["phase"]
            or outcome.request.executor != executor_from_row(row)
            or (
                outcome.request.proof_hash is not None
                and (proof is None or outcome.request.proof_hash != proof.proof_hash)
            )
            or outcome.outcome_hash != current_state_hash(outcome.model_dump(mode="json", exclude={"outcome_hash"}))
        ):
            raise TransitionError("evidence_corrupt")
        if outcome is not None:
            await _assert_history_fact(conn, fq_table, row, "outcome", outcome.outcome_hash, outcome.request.executor)
        now = await conn.fetchval("SELECT clock_timestamp()")
        writers = await conn.fetchval(
            f"SELECT count(*) FROM {fq_table('memory_transition_writers')} "
            "WHERE bank_id=$1 AND state='running' AND lease_expires_at>$2",
            row["bank_id"],
            now,
        )
        operations = await conn.fetchval(
            f"SELECT count(*) FROM {fq_table('async_operations')} "
            "WHERE bank_id=$1 AND status IN ('pending','processing')",
            row["bank_id"],
        )
        return TakiTransitionStatus(
            bank_id=row["bank_id"],
            request=request,
            executor=executor_from_row(row),
            revision=row["revision"],
            phase=row["phase"],
            lease_expires_at=row["lease_expires_at"].isoformat(),
            executor_live=row["lease_expires_at"] > now and outcome is None,
            active_writers=writers,
            accepted_operations=operations,
            proof=proof,
            outcome=outcome,
        )
    except (ValidationError, ValueError, TypeError, KeyError) as exc:
        raise TransitionError("evidence_corrupt") from exc


async def _assert_history_fact(
    conn: Any, fq_table: Callable[[str], str], row: Any, kind: str, expected_hash: str, executor: TakiTransitionExecutor
) -> None:
    # A self-consistent body hash does not prove which authenticated execution
    # published it. Join the append-only event that actually recorded the fact;
    # later lease claims may legitimately have a different current executor.
    history = await conn.fetchrow(
        f"SELECT revision,event,event_hash FROM {fq_table('memory_transition_history')} "
        "WHERE bank_id=$1 AND transition_id=$2 AND event->($3::text)->>($4::text)=$5 ORDER BY revision LIMIT 1",
        row["bank_id"],
        row["transition_id"],
        kind,
        f"{kind}_hash",
        expected_hash,
    )
    if history is None:
        raise TransitionError("evidence_corrupt")
    event = conn.parse_json(history["event"])
    if (
        current_state_hash(event) != history["event_hash"]
        or event["revision"] != history["revision"]
        or event["bank_id"] != row["bank_id"]
        or event["transition_id"] != str(row["transition_id"])
        or event["provider_lineage"] != str(row["provider_lineage"])
        or event["bank_generation"] != str(row["bank_generation"])
        or event["request_hash"] != row["request_hash"]
        or event["actor_hash"] != row["actor_hash"]
        or event["attempt_id"] != str(executor.attempt_id)
        or event["fence_token"] != str(executor.fence_token)
        or event["generation"] != executor.generation
    ):
        raise TransitionError("evidence_corrupt")
