"""PARENT-RUN ONLY: stopped owned pair, PG-only metadata, no HTTP/engine/model or logical writes.

Reuse the prior audit's credential custody, source-preservation checks and failure-safe
PG start/stop. The diagnosing child must not execute this script against the real pair.
"""
from __future__ import annotations

import importlib.util
from pathlib import Path
import time
import uuid


HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("w5_candidate_preservation_audit", HERE / "w5-return-recovery-audit.py")
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)
original_audit = audit.audit_native
original_core = audit.audit_core
TRANSITION = uuid.UUID("6d27eb9b-6bbd-4b56-8ef4-0fda9c5eec53")
DELTA_OPERATION = uuid.UUID("6497dfc9-e287-4cb1-96b5-1020ea1eabc4")
DELTA_HASH = "946b0a8228df74206a91ea4154e34d6592082e5afae2c069a71846e8e301b8d7"
SOURCE_DB = "5f12a7385d6b1fa97bcd98fc1a529a891660f76fa053792ea213519109b5ceb3"


def pinned_core() -> dict:
    result = original_core()
    assert result["sha256"] == SOURCE_DB, "CANDIDATE_AUDIT_SOURCE_CHANGED"
    return result


async def candidate_metadata(password: str) -> dict:
    import asyncpg
    from hindsight_api.engine.transfer.current_state_schema import current_state_hash
    from hindsight_api.engine.transfer.transition_delta_models import (
        TakiTransitionDeltaRequest, TakiTransitionDeltaResult, transition_delta_hash,
    )
    import json

    result = await original_audit(password)
    conn = await asyncpg.connect(host="127.0.0.1", port=audit.owner.PG_PORT,
                                 user="taki_real", password=password, database="taki_real")
    try:
        await conn.execute("SET default_transaction_read_only=on")
        await conn.execute("SET statement_timeout='30s'")
        assert Path(await conn.fetchval("SHOW data_directory")).resolve() == (audit.owner.ROOT / "data").resolve()
        async with conn.transaction(isolation="repeatable_read", readonly=True):
            result["candidateTransition"] = str(TRANSITION)
            result["readOnly"] = await conn.fetchval("SHOW transaction_read_only")
            owners = await conn.fetch("""
                SELECT bank_id, transition_id::text, phase, revision, generation, attempt_id::text,
                       lease_expires_at::text, request->>'request_hash' AS request_hash,
                       request->>'baseline_transition_id' AS baseline_transition_id,
                       proof->>'proof_hash' AS proof_hash, outcome IS NOT NULL AS has_outcome
                FROM memory_transition_requests WHERE transition_id=$1 ORDER BY bank_id
            """, TRANSITION)
            result["candidateOwners"] = [dict(row) for row in owners]
            history = await conn.fetch("""
                SELECT bank_id, revision, event->>'phase' AS phase,
                       event->>'generation' AS generation, event->>'attempt_id' AS attempt_id,
                       event->>'acquired_at' AS acquired_at, event->>'fenced_at' AS fenced_at,
                       event->>'lease_expires_at' AS lease_expires_at,
                       event->'proof'->>'proof_hash' AS proof_hash
                FROM memory_transition_history WHERE transition_id=$1 ORDER BY bank_id,revision
            """, TRANSITION)
            result["candidateHistory"] = [dict(row) for row in history]
            started = time.perf_counter()
            rows = await conn.fetch("""
                SELECT bank_id,transition_id,operation_id,request_hash,request::text,result::text
                FROM memory_transition_deltas WHERE transition_id=$1 OR operation_id=$2 ORDER BY bank_id
            """, TRANSITION, DELTA_OPERATION)
            result["deltaSelectMilliseconds"] = (time.perf_counter() - started) * 1000
            deltas = []
            for row in rows:
                request = TakiTransitionDeltaRequest.model_validate(json.loads(row["request"]))
                value = TakiTransitionDeltaResult.model_validate(json.loads(row["result"]))
                valid = (row["transition_id"] == TRANSITION == request.executor.transition_id == value.transition_id
                         and row["operation_id"] == DELTA_OPERATION == request.operation_id == value.operation_id
                         and row["request_hash"] == DELTA_HASH == request.request_hash == value.request_hash
                         and request.request_hash == transition_delta_hash(row["bank_id"], request)
                         and value.bank_id == row["bank_id"]
                         and value.local_manifest_hash == request.local_manifest_hash
                         and value.baseline_proof_hash == request.baseline_proof_hash
                         and value.result_hash == current_state_hash(value.model_dump(mode="json", exclude={"result_hash"})))
                deltas.append({"bankId": row["bank_id"], "transitionId": str(row["transition_id"]),
                    "operationId": str(row["operation_id"]), "requestHash": row["request_hash"],
                    "matchesExactCorePreparation": valid, "resultHash": value.result_hash,
                    "nativeBeforeCursor": value.native_before_cursor, "nativeThroughCursor": value.native_through_cursor,
                    "applicationThroughCursor": value.application_through_cursor,
                    "mappings": len(value.mappings), "artifacts": len(value.artifacts)})
            result["candidateDeltas"] = deltas
            plans = await conn.fetch("""
                SELECT bank_id,verification_id::text,state,candidate_hash,required_set_hash
                FROM memory_transition_maintenance WHERE verification_id=$1 ORDER BY bank_id
            """, TRANSITION)
            result["candidateMaintenance"] = [dict(row) for row in plans]
            result["candidateStepCount"] = await conn.fetchval(
                "SELECT count(*) FROM memory_transition_steps WHERE verification_id=$1", TRANSITION)
            result["candidateActionCount"] = await conn.fetchval(
                "SELECT count(*) FROM memory_transition_actions WHERE verification_id=$1", TRANSITION)
        return result
    finally:
        await conn.close()


if __name__ == "__main__":
    audit.audit_core = pinned_core
    audit.audit_native = candidate_metadata
    audit.main()
