"""Durable transition acquire, drain, executor recovery and explicit resolution.

The authenticated coordinator owns the Core decision. Native never guesses it
from a timeout: lookup is read-only, and expired execution leaves the Bank held.
"""

from __future__ import annotations

import uuid
from collections.abc import Callable
from datetime import timedelta
from typing import Any

from .db_utils import acquire_with_retry
from .transfer.current_state_schema import current_state_hash
from .transition_models import (
    TRANSITION_EXECUTOR_TTL_SECONDS,
    TakiTransitionAcquireRequest,
    TakiTransitionClaimRequest,
    TakiTransitionExecutor,
    TakiTransitionOutcome,
    TakiTransitionOutcomeRequest,
    TakiTransitionStatus,
    TransitionError,
    transition_acquire_hash,
)
from .transition_storage import (
    append_transition_history,
    assert_transition_executor,
    lock_transition_bank,
    read_transition_row,
    require_transition_schema,
    transition_status,
)


class TransitionService:
    """Constructed only after the engine authenticates the actor and capability."""

    def __init__(self, backend: Any, fq_table: Callable[[str], str], actor_hash: str) -> None:
        self.backend = backend
        self.fq_table = fq_table
        self.actor_hash = actor_hash

    async def _read(self, conn: Any, bank_id: str, transition_id: uuid.UUID) -> Any:
        return await read_transition_row(conn, self.fq_table, bank_id, transition_id, self.actor_hash)

    async def acquire(self, bank_id: str, request: TakiTransitionAcquireRequest) -> TakiTransitionStatus:
        if transition_acquire_hash(bank_id, request) != request.request_hash:
            raise TransitionError("invalid_request_hash", 422)
        async with acquire_with_retry(self.backend) as conn, conn.transaction():
            await require_transition_schema(conn, self.fq_table)
            view = await lock_transition_bank(conn, self.fq_table, bank_id)
            existing = await conn.fetchrow(
                f"SELECT * FROM {self.fq_table('memory_transition_requests')} WHERE bank_id=$1 AND transition_id=$2",
                bank_id,
                request.transition_id,
            )
            if existing is not None:
                existing = await self._read(conn, bank_id, request.transition_id)
                if existing["request_hash"] != request.request_hash:
                    raise TransitionError("request_conflict")
                return await transition_status(conn, self.fq_table, existing)
            if (
                view.state.provider_lineage != request.provider_lineage
                or view.state.bank_generation != request.bank_generation
            ):
                raise TransitionError("generation_mismatch")
            if view.state.deleted_at is not None or not await conn.fetchval(
                f"SELECT 1 FROM {self.fq_table('banks')} WHERE bank_id=$1",
                bank_id,
            ):
                raise TransitionError("bank_not_found", 404)
            if view.occupied:
                # An actual first-activation native pass owns its finite lease.
                # Repeated transitions must not steal that separate executor.
                raise TransitionError("bank_owned")
            pointer = await conn.fetchrow(
                f"SELECT * FROM {self.fq_table('memory_transition_fences')} WHERE bank_id=$1", bank_id
            )
            previous = None
            if pointer["transition_id"] is not None:
                previous = await self._read(conn, bank_id, pointer["transition_id"])
            if request.direction == "reenter-hindsight":
                await self._check_reentry(conn, bank_id, request, previous)
            elif previous is not None and previous["phase"] not in {"active", "aborted"}:
                raise TransitionError("bank_owned")
            now = await conn.fetchval("SELECT clock_timestamp()")
            row = await conn.fetchrow(
                f"INSERT INTO {self.fq_table('memory_transition_requests')} "
                "(bank_id,transition_id,provider_lineage,bank_generation,actor_hash,request_hash,request,phase,"
                "generation,attempt_id,fence_token,lease_expires_at,acquired_at) "
                "VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,'draining',1,$8,$9,$10,$11) RETURNING *",
                bank_id,
                request.transition_id,
                request.provider_lineage,
                request.bank_generation,
                self.actor_hash,
                request.request_hash,
                request.model_dump_json(),
                request.attempt_id,
                uuid.uuid4(),
                now + timedelta(seconds=TRANSITION_EXECUTOR_TTL_SECONDS),
                now,
            )
            await conn.execute(
                f"UPDATE {self.fq_table('memory_transition_fences')} SET transition_id=$2 WHERE bank_id=$1",
                bank_id,
                request.transition_id,
            )
            await conn.execute(
                f"INSERT INTO {self.fq_table('memory_transition_work')}(bank_id,transition_id,operation_id) "
                f"SELECT bank_id,$2,operation_id FROM {self.fq_table('async_operations')} "
                "WHERE bank_id=$1 AND status IN ('pending','processing')",
                bank_id,
                request.transition_id,
            )
            await append_transition_history(conn, self.fq_table, row)
            return await transition_status(conn, self.fq_table, row)

    async def _check_reentry(
        self, conn: Any, bank_id: str, request: TakiTransitionAcquireRequest, previous: Any
    ) -> None:
        if request.unused_scope is not None:
            from .transition_unused_scope import assert_unused_scope

            await self.assert_unused_history(conn, bank_id, request.unused_scope.proof_hash)
            await assert_unused_scope(conn, self.fq_table, bank_id, request.unused_scope)
            return
        if (
            previous is None
            or previous["phase"] != "retired"
            or previous["transition_id"] != request.baseline_transition_id
        ):
            raise TransitionError("baseline_required")
        status = await transition_status(conn, self.fq_table, previous)
        if status.proof is None or status.proof.proof_hash != request.baseline_proof_hash:
            raise TransitionError("baseline_mismatch")
        # The live snapshot check is supplied by the paired baseline producer;
        # no caller-supplied hash can substitute for that database read.
        from .transition_snapshot import assert_transition_baseline

        await assert_transition_baseline(conn, self.fq_table, bank_id, status.proof)

    async def assert_unused_history(self, conn: Any, bank_id: str, proof_hash: str) -> None:
        for row in await conn.fetch(
            f"SELECT * FROM {self.fq_table('memory_transition_requests')} WHERE bank_id=$1", bank_id
        ):
            await self._read(conn, bank_id, row["transition_id"])
            status = await transition_status(conn, self.fq_table, row)
            if (
                status.outcome is None
                or status.outcome.resolution != "unused_baseline_held"
                or status.outcome.restored_baseline_hash != proof_hash
                or status.request.unused_scope is None
                or status.request.unused_scope.proof_hash != proof_hash
            ):
                raise TransitionError("unused_scope_unproven")

    async def lookup(self, bank_id: str, transition_id: uuid.UUID) -> TakiTransitionStatus:
        async with acquire_with_retry(self.backend) as conn, conn.transaction(isolation="repeatable_read"):
            await require_transition_schema(conn, self.fq_table)
            return await transition_status(conn, self.fq_table, await self._read(conn, bank_id, transition_id))

    async def claim(
        self, bank_id: str, transition_id: uuid.UUID, request: TakiTransitionClaimRequest
    ) -> TakiTransitionStatus:
        async with acquire_with_retry(self.backend) as conn, conn.transaction():
            await lock_transition_bank(conn, self.fq_table, bank_id)
            row = await self._read(conn, bank_id, transition_id)
            if row["attempt_id"] == request.attempt_id and row["revision"] == request.expected_revision + 1:
                previous = await conn.fetchval(
                    f"SELECT event FROM {self.fq_table('memory_transition_history')} "
                    "WHERE bank_id=$1 AND transition_id=$2 AND revision=$3",
                    bank_id,
                    transition_id,
                    request.expected_revision,
                )
                event = conn.parse_json(previous) if previous is not None else None
                # A phase update may also advance revision by one. Only the
                # actual generation takeover can replay a successful claim.
                if (
                    event is not None
                    and event["attempt_id"] != str(request.attempt_id)
                    and event["generation"] + 1 == row["generation"]
                    and row["outcome"] is None
                ):
                    return await transition_status(conn, self.fq_table, row)
            if row["revision"] != request.expected_revision or row["outcome"] is not None:
                raise TransitionError("revision_conflict")
            now = await conn.fetchval("SELECT clock_timestamp()")
            if row["lease_expires_at"] > now:
                raise TransitionError("bank_owned")
            row = await conn.fetchrow(
                f"UPDATE {self.fq_table('memory_transition_requests')} SET generation=generation+1,revision=revision+1,"
                "attempt_id=$3,fence_token=$4,lease_expires_at=$5 WHERE bank_id=$1 AND transition_id=$2 RETURNING *",
                bank_id,
                transition_id,
                request.attempt_id,
                uuid.uuid4(),
                now + timedelta(seconds=TRANSITION_EXECUTOR_TTL_SECONDS),
            )
            await append_transition_history(conn, self.fq_table, row)
            return await transition_status(conn, self.fq_table, row)

    async def renew(self, bank_id: str, executor: TakiTransitionExecutor) -> TakiTransitionStatus:
        async with acquire_with_retry(self.backend) as conn, conn.transaction():
            await lock_transition_bank(conn, self.fq_table, bank_id)
            row = await self._read(conn, bank_id, executor.transition_id)
            await assert_transition_executor(conn, row, executor)
            row = await conn.fetchrow(
                f"UPDATE {self.fq_table('memory_transition_requests')} "
                "SET lease_expires_at=clock_timestamp()+$3::interval "
                "WHERE bank_id=$1 AND transition_id=$2 RETURNING *",
                bank_id,
                executor.transition_id,
                timedelta(seconds=TRANSITION_EXECUTOR_TTL_SECONDS),
            )
            return await transition_status(conn, self.fq_table, row)

    async def fence(self, bank_id: str, executor: TakiTransitionExecutor) -> TakiTransitionStatus:
        async with acquire_with_retry(self.backend) as conn, conn.transaction():
            await lock_transition_bank(conn, self.fq_table, bank_id)
            row = await self._read(conn, bank_id, executor.transition_id)
            await assert_transition_executor(conn, row, executor)
            if row["phase"] in {"fenced", "proven"}:
                return await transition_status(conn, self.fq_table, row)
            if row["phase"] != "draining":
                raise TransitionError("phase_conflict")
            # A lost process cannot keep execution alive. Its expired writer ID
            # is durably revoked before the source is sealed; a late result may
            # never publish even if a later transition reactivates this Bank.
            await conn.execute(
                f"UPDATE {self.fq_table('memory_transition_writers')} SET state='abandoned',finished_at=clock_timestamp() "
                "WHERE bank_id=$1 AND state='running' AND lease_expires_at<=clock_timestamp()",
                bank_id,
            )
            status = await transition_status(conn, self.fq_table, row)
            if status.active_writers or status.accepted_operations:
                raise TransitionError("accepted_work_unresolved")
            row = await conn.fetchrow(
                f"UPDATE {self.fq_table('memory_transition_requests')} "
                "SET phase='fenced',revision=revision+1,fenced_at=clock_timestamp() "
                "WHERE bank_id=$1 AND transition_id=$2 RETURNING *",
                bank_id,
                executor.transition_id,
            )
            await conn.execute(
                f"UPDATE {self.fq_table('memory_transition_fences')} SET generation=generation+1 WHERE bank_id=$1",
                bank_id,
            )
            await append_transition_history(conn, self.fq_table, row)
            return await transition_status(conn, self.fq_table, row)

    async def resolve(self, bank_id: str, request: TakiTransitionOutcomeRequest) -> TakiTransitionStatus:
        async with acquire_with_retry(self.backend) as conn, conn.transaction():
            await lock_transition_bank(conn, self.fq_table, bank_id)
            row = await self._read(conn, bank_id, request.executor.transition_id)
            status = await transition_status(conn, self.fq_table, row)
            if status.outcome is not None:
                if status.outcome.request != request:
                    raise TransitionError("decision_conflict")
                return status
            await assert_transition_executor(conn, row, request.executor)
            resolution = "committed"
            restored_baseline_hash = None
            restore_pointer = None
            if request.disposition == "abort" and status.request.direction == "reenter-hindsight":
                has_effect = await conn.fetchval(
                    f"SELECT EXISTS(SELECT 1 FROM {self.fq_table('memory_transition_deltas')} "
                    "WHERE bank_id=$1 AND transition_id=$2) OR EXISTS(SELECT 1 FROM "
                    f"{self.fq_table('memory_transition_maintenance')} WHERE bank_id=$1 AND verification_id=$2)",
                    bank_id,
                    request.executor.transition_id,
                )
                if has_effect:
                    # The source is still Local, but this target may contain
                    # committed staged effects. Do not make its executor
                    # unrecoverable by manufacturing a terminal cancellation.
                    raise TransitionError("staged_effects_require_recovery")
                if status.request.unused_scope is not None:
                    from .transition_unused_scope import assert_unused_scope

                    await assert_unused_scope(conn, self.fq_table, bank_id, status.request.unused_scope)
                    phase, resolution = "quarantined", "unused_baseline_held"
                    restored_baseline_hash = status.request.unused_scope.proof_hash
                else:
                    from .transition_snapshot import assert_transition_baseline

                    previous = await self._read(conn, bank_id, status.request.baseline_transition_id)
                    baseline = await transition_status(conn, self.fq_table, previous)
                    if (
                        baseline.phase != "retired"
                        or baseline.proof is None
                        or baseline.proof.proof_hash != status.request.baseline_proof_hash
                    ):
                        raise TransitionError("baseline_mismatch")
                    await assert_transition_baseline(conn, self.fq_table, bank_id, baseline.proof)
                    phase, resolution = "aborted", "retired_baseline_restored"
                    restore_pointer = baseline.request.transition_id
                    restored_baseline_hash = baseline.proof.proof_hash
            elif request.disposition == "abort" and row["phase"] in {"draining", "fenced"}:
                if await conn.fetchval(
                    f"SELECT EXISTS(SELECT 1 FROM {self.fq_table('memory_transition_maintenance')} "
                    "WHERE bank_id=$1 AND verification_id=$2)",
                    bank_id,
                    request.executor.transition_id,
                ):
                    raise TransitionError("native_maintenance_incomplete")
                phase, resolution = "aborted", "source_resumed"
            else:
                if status.proof is None or row["phase"] != "proven":
                    raise TransitionError("proof_required")
                if request.proof_hash != status.proof.proof_hash:
                    raise TransitionError("proof_mismatch")
                if request.disposition == "abort":
                    phase, resolution = "aborted", "source_resumed"
                else:
                    expected = "retire" if status.request.direction == "return-local" else "activate"
                    if request.disposition != expected:
                        raise TransitionError("decision_conflict")
                    phase = "retired" if expected == "retire" else "active"
            now = await conn.fetchval("SELECT clock_timestamp()")
            outcome = TakiTransitionOutcome(
                request=request,
                bank_id=bank_id,
                provider_lineage=status.request.provider_lineage,
                bank_generation=status.request.bank_generation,
                phase=phase,
                resolution=resolution,
                restored_baseline_hash=restored_baseline_hash,
                recorded_at=now.isoformat(),
                outcome_hash="0" * 64,
            )
            outcome.outcome_hash = current_state_hash(outcome.model_dump(mode="json", exclude={"outcome_hash"}))
            row = await conn.fetchrow(
                f"UPDATE {self.fq_table('memory_transition_requests')} SET phase=$3,"
                "revision=revision+1,outcome=$4::jsonb WHERE bank_id=$1 AND transition_id=$2 RETURNING *",
                bank_id,
                request.executor.transition_id,
                phase,
                outcome.model_dump_json(),
            )
            await append_transition_history(conn, self.fq_table, row)
            if restore_pointer is not None:
                await conn.execute(
                    f"UPDATE {self.fq_table('memory_transition_fences')} SET transition_id=$2 WHERE bank_id=$1",
                    bank_id,
                    restore_pointer,
                )
            return await transition_status(conn, self.fq_table, row)
