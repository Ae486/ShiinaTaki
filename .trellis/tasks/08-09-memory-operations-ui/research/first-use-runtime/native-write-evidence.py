"""Read original retain effects from the journey's disposable Native PG; never write or replay."""
import asyncio
import json
import sys
import uuid

import asyncpg


async def main():
    cfg = json.load(sys.stdin)
    conn = await asyncpg.connect(host="127.0.0.1", port=cfg["pgPort"], user="taki_smoke",
                                 password="taki_smoke", database="taki_smoke", timeout=10, command_timeout=15)
    try:
        async with conn.transaction(isolation="repeatable_read", readonly=True):
            documents = await conn.fetch(
                "SELECT id, bank_id FROM public.documents WHERE bank_id=$1 AND original_text=$2 ORDER BY id",
                cfg["bankId"], cfg["content"])
            facts = await conn.fetch(
                "SELECT id::text, document_id, bank_id FROM public.memory_units "
                "WHERE bank_id=$1 AND text=$2 AND fact_type <> 'observation' ORDER BY id",
                cfg["bankId"], cfg["content"])
            operations = await conn.fetch(
                "SELECT operation_id::text, bank_id, operation_kind, provider_lineage::text, bank_generation::text, "
                "request_hash, state->>'status' AS status, result->>'result_hash' AS result_hash "
                "FROM public.memory_native_operation_receipts "
                "WHERE operation_id=$1", uuid.UUID(cfg["operationId"]))
        print(json.dumps({"documents": [dict(row) for row in documents], "facts": [dict(row) for row in facts],
                          "operations": [dict(row) for row in operations]}))
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
