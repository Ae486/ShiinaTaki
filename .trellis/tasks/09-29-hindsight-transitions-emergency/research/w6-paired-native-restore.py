"""Explicit owned D91 Native drill; inert by default, no Core/model startup or automatic retry."""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import importlib
import json
import re
import sys
import uuid
from pathlib import Path
from urllib.parse import urlparse


def inside(root: Path, path: Path) -> Path:
    resolved = path.resolve(strict=True)
    if not resolved.is_relative_to(root) or resolved == root:
        raise ValueError("W6_RESTORE_PATH_NOT_OWNED")
    return resolved


def digest(value: object) -> str:
    return hashlib.sha256(json.dumps(value, separators=(",", ":"), ensure_ascii=True).encode()).hexdigest()


async def inventory(conn, schema: str, tables: list[str]) -> dict:
    output = {}
    async with conn.transaction(isolation="repeatable_read", readonly=True):
        for table in tables:
            rows = await conn.fetch(f'SELECT to_jsonb(r)::text AS body FROM "{schema}"."{table}" r ORDER BY body')
            # Full row bytes, including bytea, are hashed without emitting original data.
            values = [row["body"] for row in rows]
            output[table] = {"count": len(values), "hash": digest(values)}
    return output


async def triggers(conn, schema: str) -> list:
    rows = await conn.fetch(
        """SELECT c.relname AS table_name,t.tgname AS name,t.tgenabled::text AS mode
           FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
           JOIN pg_namespace n ON n.oid=c.relnamespace
           WHERE n.nspname=$1 AND NOT t.tgisinternal ORDER BY c.relname,t.tgname""",
        schema,
    )
    result = [dict(row) for row in rows]
    # A missing trigger is not an enabled barrier. Derive the table inventory from
    # the shipped migration and pin every additional admission/history guard.
    migration = importlib.import_module("hindsight_api.alembic.versions.e30a9d7f6c21_add_transition_publication_fences")
    required = {(table, "guard_transition_bank_write") for table in migration._BANK_TABLES}
    required.update((table, "guard_transition_association_write") for table in migration._ASSOCIATIONS)
    required.update(
        {
            ("replication_bank_state", "guard_transition_replication_state"),
            ("replication_logical_changes", "guard_transition_replication_journal"),
            ("async_operations", "zz_guard_transition_queue_admission"),
            ("memory_transition_bank_origins", "guard_transition_bank_origin"),
            ("memory_transition_history", "guard_transition_history"),
            ("memory_transition_initializations", "guard_transition_initialization_history"),
            ("memory_transition_deltas", "guard_transition_delta_history"),
        }
    )
    actual = {(row["table_name"], row["name"]): row["mode"] for row in result}
    if not required.issubset(actual):
        raise ValueError("W6_RESTORE_MISSING_WRITER_GUARD")
    # R fires only for replication-role writes; ordinary Core writers require O/A.
    if any(mode not in ("O", "A") for mode in actual.values()):
        raise ValueError("W6_RESTORE_DISABLED_WRITER_GUARD")
    return result


async def run(plan: dict, root: Path) -> dict:
    import asyncpg
    from hindsight_api.admin.cli import BACKUP_TABLES, _backup, _restore
    from hindsight_api.admin.taki_backup import TakiBackupRequest, read_backup_proof
    from hindsight_api.migrations import run_migrations

    source_schema = plan["sourceSchema"]
    if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]{0,62}", source_schema):
        raise ValueError("W6_RESTORE_INVALID_SCHEMA")
    url = inside(root, Path(plan["databaseUrlFile"])).read_text(encoding="utf-8").strip()
    if urlparse(url).hostname not in ("127.0.0.1", "localhost", "::1"):
        raise ValueError("W6_RESTORE_LOOPBACK_REQUIRED")
    request = TakiBackupRequest.model_validate_json(
        inside(root, Path(plan["nativeRequestPath"])).read_text(encoding="utf-8")
    )
    conn = await asyncpg.connect(url)
    result = {"completed": False, "backupId": request.backup_id}
    try:
        # Verify the actual server's data path. Never start/mutate the preserved W5/W6 input.
        inside(root, Path(await conn.fetchval("SHOW data_directory")))
        active = await conn.fetchval(
            "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() "
            "AND pid<>pg_backend_pid() AND backend_type='client backend'"
        )
        if active:
            raise ValueError("W6_RESTORE_SOURCE_NOT_STOPPED")
        before = await inventory(conn, source_schema, BACKUP_TABLES)
        source_guards = await triggers(conn, source_schema)
        archive = root / "native.zip"
        if archive.exists():
            raise ValueError("W6_RESTORE_ARCHIVE_ALREADY_EXISTS")
        manifest = await _backup(url, archive, source_schema, taki_request=request)
        if set(manifest["tables"]) != set(BACKUP_TABLES):
            raise ValueError("W6_RESTORE_INCOMPLETE_HISTORY")
        if (
            await inventory(conn, source_schema, BACKUP_TABLES) != before
            or await triggers(conn, source_schema) != source_guards
        ):
            raise ValueError("W6_RESTORE_SOURCE_CHANGED")
        target = "w6_restore_" + uuid.uuid4().hex
        await conn.execute(f'CREATE SCHEMA "{target}"')
        result["targetSchema"] = target
        await asyncio.to_thread(run_migrations, url, schema=target)
        modes = await triggers(conn, target)
        await _restore(url, archive, target)
        after = await inventory(conn, target, BACKUP_TABLES)
        if after != before or await triggers(conn, target) != modes:
            raise ValueError("W6_RESTORE_FULL_READBACK_MISMATCH")
        # Read current proof from restored tables, not from the archive's assertion alone.
        async with conn.transaction(isolation="repeatable_read", readonly=True):
            proof = await read_backup_proof(conn, target, request)
        if proof != manifest["taki"]["proof"]:
            raise ValueError("W6_RESTORE_PROOF_MISMATCH")
        if await inventory(conn, source_schema, BACKUP_TABLES) != before:
            raise ValueError("W6_RESTORE_SOURCE_CHANGED")
        raw = archive.read_bytes()
        result.update(
            completed=True,
            sourceSchema=source_schema,
            tableCount=len(before),
            tables=after,
            fullHistoryHash=digest(after),
            triggerModesHash=digest(modes),
            native={**proof, "zipSha256": hashlib.sha256(raw).hexdigest(), "zipBytes": len(raw)},
            sourceUnchanged=True,
            coreStarted=False,
            modelStarted=False,
        )
        return result
    finally:
        await conn.close()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-owned-restore", action="store_true")
    parser.add_argument("--plan", type=Path)
    args = parser.parse_args()
    if not args.run_owned_restore:
        print(json.dumps({"executed": False, "completed": False}))
        return 0
    if args.plan is None:
        parser.error("--plan is required")
    plan = json.loads(args.plan.read_text(encoding="utf-8"))
    root = Path(plan["ownedRoot"]).resolve(strict=True)
    allowed = Path(__file__).resolve().parents[4] / ".trellis" / ".runtime" / "stage4-w6-restore"
    if not root.is_relative_to(allowed) or root == allowed or plan.get("coreStopped") is not True:
        raise ValueError("W6_RESTORE_EXPLICIT_OWNED_COPY_REQUIRED")
    # One attempt only. Failed state and partial archives remain available for independent review.
    with (root / "restore-started.json").open("x", encoding="utf-8") as marker:
        json.dump({"version": 1, "planHash": digest(plan)}, marker)
    result = {"executed": True, "completed": False}
    try:
        result.update(asyncio.run(run(plan, root)))
    except Exception as error:
        code = str(error)
        result["error"] = code if re.fullmatch(r"W6_[A-Z_]+", code) else "W6_RESTORE_FAILED"
    finally:
        with (root / "native-restore-result.json").open("x", encoding="utf-8") as output:
            json.dump(result, output, indent=2)
            output.write("\n")
    print(json.dumps({"completed": result["completed"], "error": result.get("error")}))
    return 0 if result["completed"] else 1


if __name__ == "__main__":
    sys.exit(main())
