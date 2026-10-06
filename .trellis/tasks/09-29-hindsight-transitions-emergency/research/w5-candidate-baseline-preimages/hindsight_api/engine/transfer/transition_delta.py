"""One exact baseline-guarded native/application delta with immutable replay."""

from __future__ import annotations

import uuid
from typing import Any

from pydantic import ValidationError

from ..application_state.models import TakiApplicationNamespace
from ..application_state.store import ApplicationStateStore
from ..db_utils import acquire_with_retry
from ..memories import get_memories
from ..replication import BankLogicalPayload
from ..transition_execution import maintain_transition_executor
from ..transition_models import TransitionError
from ..transition_service import TransitionService
from ..transition_snapshot import assert_transition_baseline
from ..transition_storage import assert_transition_executor, lock_transition_bank, transition_status
from .current_state_rows import prepare_current_state_rows
from .current_state_schema import current_state_hash
from .transition_delta_application import _predecessors, write_transition_application_delta
from .transition_delta_models import TakiTransitionDeltaRequest, TakiTransitionDeltaResult, transition_delta_hash
from .transition_delta_preflight import preflight_transition_delta
from .transition_delta_rows import write_transition_native_delta


class TransitionDeltaService:
    def __init__(self, *, engine: Any, backend: Any, fq_table: Any, request_context: Any, actor_hash: str) -> None:
        self.engine, self.backend, self.fq_table = engine, backend, fq_table
        self.context = request_context
        self.owner = TransitionService(backend, fq_table, actor_hash)

    async def _existing(self, conn: Any, bank_id: str, transition_id: uuid.UUID) -> TakiTransitionDeltaResult | None:
        row = await conn.fetchrow(
            f"SELECT * FROM {self.fq_table('memory_transition_deltas')} WHERE bank_id=$1 AND transition_id=$2",
            bank_id,
            transition_id,
        )
        if row is None:
            return None
        try:
            request = TakiTransitionDeltaRequest.model_validate(conn.parse_json(row["request"]))
            result = TakiTransitionDeltaResult.model_validate(conn.parse_json(row["result"]))
            if (
                request.executor.transition_id != transition_id
                or result.transition_id != transition_id
                or result.bank_id != bank_id
                or request.operation_id != row["operation_id"]
                or result.operation_id != row["operation_id"]
                or request.request_hash != row["request_hash"]
                or result.request_hash != row["request_hash"]
                or request.request_hash != transition_delta_hash(bank_id, request)
                or result.local_manifest_hash != request.local_manifest_hash
                or result.baseline_proof_hash != request.baseline_proof_hash
                or result.unused_scope_hash != (request.unused_scope.proof_hash if request.unused_scope else None)
                or result.result_hash != current_state_hash(result.model_dump(mode="json", exclude={"result_hash"}))
            ):
                raise TransitionError("evidence_corrupt")
            return result
        except (ValidationError, ValueError, TypeError, KeyError) as exc:
            raise TransitionError("evidence_corrupt") from exc

    async def lookup(self, bank_id: str, transition_id: uuid.UUID) -> TakiTransitionDeltaResult | None:
        async with acquire_with_retry(self.backend) as conn, conn.transaction(isolation="repeatable_read"):
            await self.owner._read(conn, bank_id, transition_id)
            return await self._existing(conn, bank_id, transition_id)

    async def _admit(
        self, conn: Any, bank_id: str, request: TakiTransitionDeltaRequest
    ) -> TakiTransitionDeltaResult | None:
        view = await lock_transition_bank(conn, self.fq_table, bank_id)
        row = await self.owner._read(conn, bank_id, request.executor.transition_id)
        existing = await self._existing(conn, bank_id, request.executor.transition_id)
        if existing is not None:
            if existing.request_hash != request.request_hash or existing.operation_id != request.operation_id:
                raise TransitionError("request_conflict")
            return existing
        await assert_transition_executor(conn, row, request.executor)
        status = await transition_status(conn, self.fq_table, row)
        if status.phase != "fenced" or status.request.direction != "reenter-hindsight":
            raise TransitionError("phase_conflict")
        if (
            status.request.baseline_transition_id != request.baseline_transition_id
            or status.request.baseline_proof_hash != request.baseline_proof_hash
            or status.request.unused_scope != request.unused_scope
            or view.state.provider_lineage != status.request.provider_lineage
            or view.state.bank_generation != status.request.bank_generation
            or view.state.deleted_at is not None
        ):
            raise TransitionError("baseline_mismatch")
        if request.unused_scope is not None:
            from ..transition_unused_scope import assert_unused_scope

            await assert_unused_scope(conn, self.fq_table, bank_id, request.unused_scope)
            return None
        baseline_row = await self.owner._read(conn, bank_id, request.baseline_transition_id)
        baseline = await transition_status(conn, self.fq_table, baseline_row)
        if (
            baseline.proof is None
            or baseline.proof.proof_hash != request.baseline_proof_hash
            or baseline.phase != "retired"
        ):
            raise TransitionError("baseline_mismatch")
        await assert_transition_baseline(conn, self.fq_table, bank_id, baseline.proof)
        return None

    async def apply(self, bank_id: str, request: TakiTransitionDeltaRequest) -> TakiTransitionDeltaResult:
        if request.request_hash != transition_delta_hash(bank_id, request):
            raise TransitionError("invalid_request_hash", 422)
        if not get_memories().writes_memory_rows_in_sql or not getattr(
            self.backend.ops, "supports_taki_replication", False
        ):
            raise TransitionError("unsupported_storage", 503)
        async with maintain_transition_executor(self.owner, bank_id, request.executor):
            async with acquire_with_retry(self.backend) as conn, conn.transaction():
                prior = await self._admit(conn, bank_id, request)
                if prior is not None:
                    return prior
                plan = await preflight_transition_delta(conn, self.fq_table, bank_id, request)
                owner = await self.owner._read(conn, bank_id, request.executor.transition_id)
                namespace = TakiApplicationNamespace(
                    provider_lineage=owner["provider_lineage"], bank_generation=owner["bank_generation"]
                )
                await _predecessors(ApplicationStateStore(conn, self.fq_table, bank_id, namespace), request)
            if request.rows.bank is not None:
                bank_payload = plan.before[("bank", bank_id)].payload
                if not isinstance(bank_payload, BankLogicalPayload):
                    raise TransitionError("descriptor_mismatch")
                before = bank_payload.config
                after = request.rows.bank.payload.config
                updates = {
                    key: after.get(key) for key in before.keys() | after.keys() if before.get(key) != after.get(key)
                }
                if updates:
                    await self.engine._validate_bank_config_updates(
                        bank_id, updates, request_context=self.context, bank_exists=True
                    )
            config = await self.engine._config_resolver.resolve_full_config(bank_id, self.context)
            prepared = await prepare_current_state_rows(
                request=request.rows,
                embeddings_model=self.engine.embeddings,
                format_date_fn=self.engine._format_readable_date,
            )
            self.engine.entity_resolver.discard_pending_stats()
            try:
                async with acquire_with_retry(self.backend) as conn, conn.transaction():
                    prior = await self._admit(conn, bank_id, request)
                    if prior is not None:
                        return prior
                    plan = await preflight_transition_delta(conn, self.fq_table, bank_id, request)
                    before_cursor = await conn.fetchval(
                        f"SELECT current_cursor FROM {self.fq_table('replication_bank_state')} WHERE bank_id=$1",
                        bank_id,
                    )
                    mappings = await write_transition_native_delta(
                        conn=conn,
                        fq_table=self.fq_table,
                        bank_id=bank_id,
                        request=request,
                        plan=plan,
                        prepared=prepared,
                        ops=self.backend.ops,
                        entity_resolver=self.engine.entity_resolver,
                        config=config,
                    )
                    store = ApplicationStateStore(conn, self.fq_table, bank_id, namespace)
                    artifacts = await write_transition_application_delta(store, request, plan)
                    state = await store.require_state()
                    result = TakiTransitionDeltaResult(
                        operation_id=request.operation_id,
                        transition_id=request.executor.transition_id,
                        bank_id=bank_id,
                        provider_lineage=namespace.provider_lineage,
                        bank_generation=namespace.bank_generation,
                        request_hash=request.request_hash,
                        baseline_proof_hash=request.baseline_proof_hash,
                        unused_scope_hash=request.unused_scope.proof_hash if request.unused_scope else None,
                        local_manifest_hash=request.local_manifest_hash,
                        native_before_cursor=before_cursor,
                        native_through_cursor=state.checkpoint.native_cursor,
                        application_through_cursor=state.checkpoint.state_cursor,
                        mappings=mappings,
                        artifacts=artifacts,
                        result_hash="0" * 64,
                    )
                    result.result_hash = current_state_hash(result.model_dump(mode="json", exclude={"result_hash"}))
                    await conn.execute(
                        f"INSERT INTO {self.fq_table('memory_transition_deltas')} "
                        "(bank_id,transition_id,operation_id,request_hash,request,result) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb)",
                        bank_id,
                        request.executor.transition_id,
                        request.operation_id,
                        request.request_hash,
                        request.model_dump_json(),
                        result.model_dump_json(),
                    )
                return result
            finally:
                # Per-transaction entity/link rows are already durable. Pending
                # co-occurrence statistics are a native rebuildable cache; do
                # not leak a refused delta's side effects through a later call.
                self.engine.entity_resolver.discard_pending_stats()
