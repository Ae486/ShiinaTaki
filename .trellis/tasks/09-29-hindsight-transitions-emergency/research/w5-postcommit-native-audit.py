"""Read only post-COMMIT owner/history metadata through the existing stopped-pair audit.

Reuse its source verification, credential custody, completed-work checks and normal
PostgreSQL shutdown. No engine, HTTP service, model, payload or actor hash is needed.
"""
from __future__ import annotations

import importlib.util
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("w5_preservation_audit", HERE / "w5-return-recovery-audit.py")
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)
original_audit = audit.audit_native


async def postcommit_metadata(password: str) -> dict:
    import asyncpg

    result = await original_audit(password)
    conn = await asyncpg.connect(host="127.0.0.1", port=audit.owner.PG_PORT,
                                 user="taki_real", password=password, database="taki_real")
    try:
        await conn.execute("SET default_transaction_read_only=on")
        assert Path(await conn.fetchval("SHOW data_directory")).resolve() == (audit.owner.ROOT / "data").resolve()
        rows = await conn.fetch("""
            SELECT bank_id, transition_id::text, phase, revision, generation, attempt_id::text,
                   lease_expires_at::text, proof->>'proof_hash' AS proof_hash,
                   outcome IS NOT NULL AS has_outcome,
                   outcome->>'disposition' AS outcome_disposition,
                   outcome->'request'->>'disposition' AS outcome_request_disposition
            FROM memory_transition_requests ORDER BY bank_id, transition_id
        """)
        history = await conn.fetch("""
            SELECT bank_id, transition_id::text, revision, event->>'phase' AS phase,
                   event->>'generation' AS generation, event->>'attempt_id' AS attempt_id,
                   event->>'acquired_at' AS acquired_at, event->>'fenced_at' AS fenced_at,
                   event->>'lease_expires_at' AS lease_expires_at,
                   event->'proof'->>'proof_hash' AS proof_hash
            FROM memory_transition_history ORDER BY bank_id, transition_id, revision
        """)
        result["postcommitOwners"] = [dict(row) for row in rows]
        result["postcommitHistory"] = [dict(row) for row in history]
        return result
    finally:
        await conn.close()


if __name__ == "__main__":
    # The imported main retains its full failure-safe start/audit/stop procedure.
    audit.audit_native = postcommit_metadata
    audit.main()
