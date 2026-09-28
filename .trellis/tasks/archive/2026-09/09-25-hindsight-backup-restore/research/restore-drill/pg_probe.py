"""Read-only native row census for the restore drill: counts, receipts, async operations and cursors as one JSON document.

INPUT:  argv[1] = PostgreSQL port of a drill-owned pg0 instance, argv[2] = database user (= password = database)
OUTPUT: stdout JSON; every read runs in one READ ONLY REPEATABLE READ transaction so the census is one consistent snapshot
POS:    09-25-hindsight-backup-restore W6 drill only; connects to 127.0.0.1 only and never writes
"""

from __future__ import annotations

import asyncio
import json
import sys
from typing import Any

import asyncpg

QUERIES: dict[str, str] = {
    "lineage": "SELECT provider_lineage::text AS lineage FROM replication_provider_lineage",
    "banks": "SELECT bank_id FROM banks ORDER BY bank_id",
    "bankState": """SELECT bank_id, bank_generation::text AS generation, current_cursor, minimum_available_cursor,
                           deleted_at IS NOT NULL AS deleted FROM replication_bank_state ORDER BY bank_id""",
    "applicationBanks": """SELECT bank_id, bank_generation::text AS generation, native_cursor, state_cursor,
                                  deleted_at IS NOT NULL AS deleted FROM memory_application_banks ORDER BY bank_id""",
    "documents": "SELECT bank_id, count(*) AS n FROM documents GROUP BY bank_id ORDER BY bank_id",
    "memoryUnits": "SELECT bank_id, count(*) AS n FROM memory_units GROUP BY bank_id ORDER BY bank_id",
    "memoryUnitTexts": "SELECT bank_id, left(text, 120) AS text FROM memory_units ORDER BY bank_id, text",
    "nativeReceipts": """SELECT bank_id, bank_generation::text AS generation, operation_kind, operation_id::text AS operation_id,
                                state->>'status' AS status, result IS NOT NULL AS has_result
                         FROM memory_native_operation_receipts ORDER BY created_at, operation_id""",
    "mutationReceipts": "SELECT bank_id, count(*) AS n FROM memory_mutation_receipts GROUP BY bank_id ORDER BY bank_id",
    "applicationOperations": """SELECT bank_id, bank_generation::text AS generation, operation_id::text AS operation_id
                                FROM memory_application_operations ORDER BY bank_id, operation_id""",
    "asyncOperations": """SELECT operation_id::text AS operation_id, bank_id, operation_type, status, worker_id,
                                 retry_count FROM async_operations ORDER BY created_at, operation_id""",
    "changesPerBank": "SELECT bank_id, count(*) AS n, max(cursor) AS max_cursor FROM replication_logical_changes GROUP BY bank_id ORDER BY bank_id",
}


def plain(value: Any) -> Any:
    return value if isinstance(value, (str, int, float, bool)) or value is None else str(value)


async def census(port: int, user: str) -> dict[str, Any]:
    conn = await asyncpg.connect(host="127.0.0.1", port=port, user=user, password=user, database=user)
    out: dict[str, Any] = {}
    try:
        async with conn.transaction(isolation="repeatable_read", readonly=True):
            for name, sql in QUERIES.items():
                try:
                    async with conn.transaction():  # savepoint: one failing read does not poison the snapshot
                        out[name] = [{key: plain(value) for key, value in row.items()} for row in await conn.fetch(sql)]
                except asyncpg.PostgresError as error:
                    out[name] = {"error": f"{type(error).__name__}: {error}"}
    finally:
        await conn.close()
    return out


if __name__ == "__main__":
    print(json.dumps(asyncio.run(census(int(sys.argv[1]), sys.argv[2]))))
